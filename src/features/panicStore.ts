// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/features/panicStore.ts
 * WHAT: Panic state for role automation emergency shutoff (persisted to DB)
 * WHY: Instant kill switch for role rewards during testing/emergencies
 *      State survives bot restarts (was in-memory only before)
 * FLOWS:
 *  - /panic → setPanicMode(guildId, true) → all role automation stops
 *  - /panic off → setPanicMode(guildId, false) → resume normal operation
 *  - loadPanicState() → called on startup to restore state from DB
 */

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

// ============================================================================
// Prepared Statements (cached at module load for performance)
// ============================================================================

const loadPanicGuildsStmt = db.prepare(
  `SELECT guild_id, panic_mode FROM guild_config WHERE panic_mode = 1`
);

const enablePanicStmt = db.prepare(
  `INSERT INTO guild_config (guild_id, panic_mode, panic_enabled_at, panic_enabled_by, updated_at_s)
   VALUES (?, 1, ?, ?, ?)
   ON CONFLICT(guild_id) DO UPDATE SET
     panic_mode = 1,
     panic_enabled_at = excluded.panic_enabled_at,
     panic_enabled_by = excluded.panic_enabled_by,
     updated_at_s = excluded.updated_at_s`
);

const disablePanicStmt = db.prepare(
  `INSERT INTO guild_config (guild_id, panic_mode, panic_enabled_at, panic_enabled_by, updated_at_s)
   VALUES (?, 0, NULL, NULL, ?)
   ON CONFLICT(guild_id) DO UPDATE SET
     panic_mode = 0,
     panic_enabled_at = NULL,
     panic_enabled_by = NULL,
     updated_at_s = excluded.updated_at_s`
);

const getPanicDetailsStmt = db.prepare(
  `SELECT panic_mode, panic_enabled_at, panic_enabled_by
   FROM guild_config WHERE guild_id = ?`
);

// In-memory cache for instant response. isPanicMode() is called on every
// role assignment, so we can't afford DB round-trips. Cache is authoritative
// for reads; DB is source of truth for persistence across restarts.
const panicCache = new Map<string, boolean>();

interface PanicRow {
  panic_mode: number;
  panic_enabled_at: number | null;
  panic_enabled_by: string | null;
}

/**
 * Load panic state from database into memory cache.
 * MUST be called once on bot startup, before any role automation runs.
 * If this fails, we default to "panic off" which could be dangerous if
 * panic was actually on - but better than blocking startup entirely.
 */
export function loadPanicState(): void {
  try {
    // Only load guilds that ARE in panic mode. Default state (no row or
    // panic_mode=0) means panic is off, so we don't need to cache those.
    const rows = loadPanicGuildsStmt.all() as Array<{ guild_id: string; panic_mode: number }>;

    for (const row of rows) {
      panicCache.set(row.guild_id, true);
    }

    if (rows.length > 0) {
      // Log at WARN because panic mode is an abnormal state worth noting
      logger.warn(
        { guilds: rows.map((r) => r.guild_id) },
        `[panic] Restored panic mode for ${rows.length} guild(s) from database`
      );
    } else {
      logger.info("[panic] No guilds in panic mode");
    }
  } catch (err) {
    // Log but don't throw. Failing to load panic state shouldn't prevent
    // bot from starting - worst case, panic mode doesn't work this session.
    logger.error({ err }, "[panic] Failed to load panic state from database");
  }
}

/**
 * Check if panic mode is active for a guild. HOT PATH - called on every
 * role assignment. This is why we use in-memory cache, not DB lookup.
 * O(1) Map lookup, no async, no I/O.
 */
export function isPanicMode(guildId: string): boolean {
  return panicCache.get(guildId) ?? false;
}

/**
 * Set panic mode for a guild
 * Persists to database and updates in-memory cache
 */
export function setPanicMode(
  guildId: string,
  enabled: boolean,
  enabledBy?: string
): void {
  // Update cache FIRST, then persist. This ordering ensures panic takes
  // effect immediately even if DB write is slow. If DB fails, panic still
  // works for this session (just won't survive restart).
  panicCache.set(guildId, enabled);

  try {
    const nowS = Math.floor(Date.now() / 1000);

    if (enabled) {
      // Upsert: enable panic mode
      enablePanicStmt.run(guildId, nowS, enabledBy ?? null, nowS);
    } else {
      // Upsert: disable panic mode
      disablePanicStmt.run(guildId, nowS);
    }

    logger.warn(
      {
        evt: enabled ? "panic_enabled" : "panic_disabled",
        guildId,
        enabledBy,
      },
      `Role automation panic mode ${enabled ? "ENABLED" : "disabled"}`
    );
  } catch (err) {
    // Don't throw. Cache is already updated, so panic works for this session.
    // The risk: if bot restarts before successful DB write, panic state is lost.
    // Acceptable tradeoff for keeping the /panic command responsive.
    logger.error(
      { err, guildId, enabled },
      "[panic] Failed to persist panic state to database - state will not survive restart"
    );
  }
}

/**
 * Get all guilds currently in panic mode
 */
export function getPanicGuilds(): string[] {
  return Array.from(panicCache.entries())
    .filter(([_, enabled]) => enabled)
    .map(([guildId]) => guildId);
}

/**
 * Clear panic cache entry for a guild (called on guildDelete).
 * WHAT: Removes in-memory cache entry when bot leaves a guild
 * WHY: Prevents memory leak from accumulating entries for departed guilds
 * NOTE: Does NOT delete DB row - that data may be useful if bot rejoins
 */
export function clearPanicCache(guildId: string): void {
  const existed = panicCache.delete(guildId);
  if (existed) {
    logger.debug({ guildId }, "[panic] Cleared cache entry for departed guild");
  }
}

/**
 * Get panic mode details for a guild (for /panic status display).
 * Unlike isPanicMode(), this reads from DB to get the full audit trail
 * (who enabled it, when). Acceptable to be slightly slower since status
 * checks are infrequent.
 */
export function getPanicDetails(guildId: string): {
  enabled: boolean;
  enabledAt: Date | null;
  enabledBy: string | null;
} | null {
  try {
    const row = getPanicDetailsStmt.get(guildId) as PanicRow | undefined;

    if (!row) {
      // No config row = guild never configured = panic off
      return { enabled: false, enabledAt: null, enabledBy: null };
    }

    return {
      enabled: row.panic_mode === 1,
      // panic_enabled_at is Unix seconds, need to convert to Date
      enabledAt: row.panic_enabled_at ? new Date(row.panic_enabled_at * 1000) : null,
      enabledBy: row.panic_enabled_by,
    };
  } catch (err) {
    // Fall back to cache for enabled status, but we lose the "who/when" details
    logger.error({ err, guildId }, "[panic] Failed to get panic details");
    return {
      enabled: panicCache.get(guildId) ?? false,
      enabledAt: null,
      enabledBy: null,
    };
  }
}
