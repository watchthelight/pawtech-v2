/**
 * Pawtropolis Tech — src/features/appLookup.ts
 * WHAT: Deterministic application resolution by code, message ID, or app ID
 * WHY: Centralize lookup logic to avoid partial scans and race conditions
 * FLOWS:
 *  - findAppByCodeOrMessage() - Primary lookup method
 *  - findAppByShortCode() - Resolve HEX6 code to app
 *  - normalizeCode() - Clean and validate input codes
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { shortCode } from "../lib/ids.js";
import { logger } from "../lib/logger.js";

/** Internal type for application row from database */
type AppRow = {
  id: string;
  user_id: string;
  guild_id: string;
  status: string;
  submitted_at?: number;
  updated_at?: number;
};

/**
 * normalizeCode
 * WHAT: Clean and validate a short code input
 * WHY: Accept user input in various formats (lowercase, with prefixes, etc.)
 * PARAMS:
 *  - raw: User-provided code string
 * RETURNS: Uppercase, 6-char hex string or empty if invalid
 */
export function normalizeCode(raw: string): string {
  // Accept various input formats: "abc123", "ABC123", "abc-123", "#ABC123"
  // Strip everything except hex chars and uppercase for consistent matching.
  // We slice to 6 chars because that's our short code length. Longer inputs
  // (like full UUIDs pasted by accident) get truncated - this is intentional
  // since we fall back to full ID lookup anyway if short code fails.
  const cleaned = String(raw || "")
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "");
  return cleaned.slice(0, 6);
}

/**
 * findAppByShortCode
 * WHAT: Resolve a HEX6 short code to an application record
 * WHY: Provide O(1) lookup via app_short_codes table with fallback to full scan
 * PARAMS:
  *  - guildId: Guild ID to scope search
 *  - code: HEX6 short code (normalized)
 * RETURNS: Application record or null
 */
export function findAppByShortCode(guildId: string, code: string) {
  const normalized = normalizeCode(code);
  if (normalized.length !== 6) {
    logger.debug({ code, normalized }, "[appLookup] invalid short code length");
    return null;
  }

  // Try mapping table first (O(1) lookup)
  // We check for table existence each time rather than caching because:
  // 1. The table might be created by a migration mid-session
  // 2. This check is fast (sqlite_master is always indexed)
  const hasMapping = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_short_codes'")
    .get();

  if (hasMapping) {
    const row = db
      .prepare("SELECT app_id FROM app_short_codes WHERE guild_id=? AND code=? LIMIT 1")
      .get(guildId, normalized) as { app_id: string } | undefined;

    if (row && row.app_id) {
      const app = db.prepare("SELECT * FROM application WHERE id=?").get(row.app_id);
      logger.debug({ code: normalized, appId: row.app_id }, "[appLookup] found via mapping table");
      return app;
    }
  }

  // Fallback: Full-scan all applications in guild (expensive but safe)
  // This O(n) scan happens when: mapping table doesn't exist, or code isn't in mapping table
  // (e.g., app created before mapping sync ran). In production, this should be rare after
  // initial migration, but we keep it for robustness.
  logger.debug({ code: normalized }, "[appLookup] mapping table miss, falling back to full scan");

  const rows = db
    .prepare(
      "SELECT id, user_id, guild_id, status, submitted_at, updated_at FROM application WHERE guild_id=?"
    )
    .all(guildId) as AppRow[];

  for (const r of rows) {
    try {
      if (shortCode(r.id) === normalized) {
        logger.debug({ code: normalized, appId: r.id }, "[appLookup] found via full scan");
        return r;
      }
    } catch (e) {
      logger.warn({ err: e, appId: r.id }, "[appLookup] shortCode generation failed");
    }
  }

  logger.debug({ code: normalized }, "[appLookup] no application found");
  return null;
}

/**
 * findAppByCodeOrMessage
 * WHAT: Primary lookup method - resolve app by message ID, short code, or full app ID
 * WHY: Single entry point for all app resolution needs
 * PARAMS:
 *  - guildId: Guild ID to scope search
 *  - code: Optional HEX6 short code or full app ID
 *  - messageId: Optional review card message ID
 * RETURNS: Application record or null
 */
export function findAppByCodeOrMessage({
  guildId,
  code,
  messageId,
}: {
  guildId: string;
  code?: string;
  messageId?: string;
}) {
  // Resolution priority: messageId > short code > full app ID
  // messageId is most reliable because it's a direct FK from review_card,
  // while short codes can theoretically collide (6 hex chars = 16M values,
  // but we scope by guild so collisions are extremely unlikely in practice).

  // Priority 1: Resolve by message ID (most reliable)
  if (messageId) {
    const rc = db
      .prepare("SELECT app_id FROM review_card WHERE message_id = ? LIMIT 1")
      .get(messageId) as { app_id: string } | undefined;

    if (rc && rc.app_id) {
      const app = db.prepare("SELECT * FROM application WHERE id = ?").get(rc.app_id);
      if (app) {
        logger.debug({ messageId, appId: rc.app_id }, "[appLookup] found via message ID");
        return app;
      }
    }
  }

  // Priority 2: Resolve by code (short code or full app ID)
  if (code) {
    // Try as short code first
    let app = findAppByShortCode(guildId, code);
    if (app) return app;

    // Try as full app ID
    const fullIdApp = db.prepare("SELECT * FROM application WHERE id = ? LIMIT 1").get(code) as AppRow | undefined;
    if (fullIdApp && fullIdApp.guild_id === guildId) {
      logger.debug({ code, appId: fullIdApp.id }, "[appLookup] found via full app ID");
      return fullIdApp;
    }
  }

  logger.debug({ guildId, code, messageId }, "[appLookup] no application found");
  return null;
}

/**
 * syncShortCodeMappings
 * WHAT: Backfill or sync app_short_codes table
 * WHY: Ensure O(1) lookups are available for all applications
 * RETURNS: Number of mappings created
 */
export function syncShortCodeMappings(guildId?: string): number {
  // Backfill short code mappings for existing applications.
  // Called on startup and can be triggered manually via CLI.
  // Uses INSERT OR IGNORE so it's idempotent - safe to run multiple times.

  // Check if mapping table exists
  const hasMapping = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_short_codes'")
    .get();

  if (!hasMapping) {
    logger.warn("[appLookup] app_short_codes table does not exist, skipping sync");
    return 0;
  }

  const query = guildId
    ? "SELECT id, guild_id FROM application WHERE guild_id = ?"
    : "SELECT id, guild_id FROM application";

  const apps = (guildId
    ? db.prepare(query).all(guildId)
    : db.prepare(query).all()) as Array<{ id: string; guild_id: string }>;

  let created = 0;

  // Using a prepared statement in a loop is fine here - better-sqlite3 caches
  // the statement, and we need the per-row result to count new inserts.
  const insert = db.prepare(
    "INSERT OR IGNORE INTO app_short_codes (app_id, guild_id, code) VALUES (?, ?, ?)"
  );

  for (const app of apps) {
    try {
      const code = shortCode(app.id);
      const result = insert.run(app.id, app.guild_id, code);
      if (result.changes > 0) created++;
    } catch (e) {
      logger.warn({ err: e, appId: app.id }, "[appLookup] failed to create mapping");
    }
  }

  logger.info({ created, total: apps.length }, "[appLookup] synced short code mappings");
  return created;
}
