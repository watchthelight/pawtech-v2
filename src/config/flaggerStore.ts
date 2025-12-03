/**
 * Pawtropolis Tech — src/config/flaggerStore.ts
 * WHAT: Per-guild flags configuration with env fallback (Silent-Since-Join First-Message Flagger).
 * WHY: Allows guilds to override default flags channel and silent days threshold from env vars.
 * FLOWS:
 *  - getFlaggerConfig(guildId) → { channelId, silentDays }
 *  - setFlagsChannelId(guildId, channelId) → upserts guild_config
 *  - setSilentFirstMsgDays(guildId, days) → upserts guild_config
 * DOCS:
 *  - better-sqlite3 prepared statements: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - PR8 specification: docs/context/10_Roadmap_Open_Issues_and_Tasks.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { LRUCache } from "../lib/lruCache.js";

// ============================================================================
// Prepared Statements (cached at module load for performance)
// ============================================================================
// These run on module load, which means a broken DB path will crash the bot
// before it even says hello. This is intentional. Fail fast, fail loud.

const getFlaggerConfigStmt = db.prepare(
  `SELECT flags_channel_id, silent_first_msg_days FROM guild_config WHERE guild_id = ?`
);

const upsertFlagsChannelStmt = db.prepare(
  `INSERT INTO guild_config (guild_id, flags_channel_id, updated_at_s)
   VALUES (?, ?, ?)
   ON CONFLICT(guild_id) DO UPDATE SET
     flags_channel_id = excluded.flags_channel_id,
     updated_at_s = excluded.updated_at_s`
);

const upsertSilentDaysStmt = db.prepare(
  `INSERT INTO guild_config (guild_id, silent_first_msg_days, updated_at_s)
   VALUES (?, ?, ?)
   ON CONFLICT(guild_id) DO UPDATE SET
     silent_first_msg_days = excluded.silent_first_msg_days,
     updated_at_s = excluded.updated_at_s`
);

// GOTCHA: channelId being null is valid (feature disabled), but silentDays
// is never null - it defaults to 7. This asymmetry will bite someone someday.
export interface FlaggerConfig {
  channelId: string | null;
  silentDays: number;
}

// ============================================================================
// Cache Layer
// ============================================================================
// LRU cache with TTL and bounded size to prevent unbounded memory growth.
// getFlaggerConfig is called on every message (for first-message detection), so caching is critical.

const CACHE_TTL_MS = 60 * 1000; // 1 minute TTL - balances freshness vs DB load
const CACHE_MAX_SIZE = 1000; // Max guilds to cache - prevents unbounded memory growth
const flaggerConfigCache = new LRUCache<string, FlaggerConfig>(CACHE_MAX_SIZE, CACHE_TTL_MS);
// Fun fact: this cache can hold configs for guilds the bot isn't even in.
// The guildDelete handler cleans up, but if you're debugging memory, start here.

/**
 * Get from cache if not expired
 */
function getCached(guildId: string): FlaggerConfig | undefined {
  return flaggerConfigCache.get(guildId);
}

/**
 * Set cache entry with TTL
 */
function setCache(guildId: string, value: FlaggerConfig): void {
  flaggerConfigCache.set(guildId, value);
}

/**
 * Invalidate cache entry for a guild (call after writes)
 */
function invalidateCache(guildId: string): void {
  flaggerConfigCache.delete(guildId);
}

/**
 * Clear flagger cache entry for a guild (called on guildDelete).
 * WHAT: Removes in-memory cache entry when bot leaves a guild
 * WHY: Prevents memory leak from accumulating entries for departed guilds
 * NOTE: Does NOT delete DB row - that data may be useful if bot rejoins
 */
export function clearFlaggerCache(guildId: string): void {
  const existed = flaggerConfigCache.delete(guildId);
  if (existed) {
    logger.debug({ guildId }, "[flagger] Cleared cache entry for departed guild");
  }
}

/**
 * WHAT: Get flagger configuration for a guild (channel + threshold).
 * WHY: Supports per-guild override with fallback to process.env.
 *
 * Resolution priority:
 *  1. Database (guild_config.flags_channel_id, guild_config.silent_first_msg_days)
 *  2. Environment variables (FLAGGED_REPORT_CHANNEL_ID, SILENT_FIRST_MSG_DAYS)
 *  3. Defaults (channelId: null, silentDays: 7)
 *
 * @param guildId - Discord guild ID
 * @returns FlaggerConfig with channelId (string | null) and silentDays (number)
 * @example
 * const config = getFlaggerConfig('123456789');
 * if (config.channelId) {
 *   const channel = await guild.channels.fetch(config.channelId);
 * }
 * console.log(`Silent threshold: ${config.silentDays} days`);
 */
export function getFlaggerConfig(guildId: string): FlaggerConfig {
  // Check cache first
  const cached = getCached(guildId);
  if (cached !== undefined) {
    return cached;
  }

  let channelId: string | null = null;
  let silentDays: number = 7; // Default threshold (7 days)

  try {
    // First, check for guild-specific override in guild_config table
    // This allows individual guilds to set their own flags channel via /config set flags.channel
    const row = getFlaggerConfigStmt.get(guildId) as
      | { flags_channel_id: string | null; silent_first_msg_days: number | null }
      | undefined;

    if (row) {
      // Guild-specific channel override (DB > ENV)
      if (row.flags_channel_id) {
        channelId = row.flags_channel_id;
      }

      // Guild-specific threshold override (DB > ENV)
      if (row.silent_first_msg_days !== null && row.silent_first_msg_days !== undefined) {
        silentDays = row.silent_first_msg_days;
      }
    }
  } catch (err) {
    // Gracefully handle missing table/column (pre-migration databases)
    // This prevents crashes during startup before migration 005 runs
    logger.warn({ err, guildId }, "[flagger] Failed to query guild_config, falling back to env");
  }

  // Fallback to env variables (applies to all guilds without override)
  // Set FLAGGED_REPORT_CHANNEL_ID and SILENT_FIRST_MSG_DAYS in .env to configure defaults
  if (!channelId) {
    const envChannel = process.env.FLAGGED_REPORT_CHANNEL_ID;
    if (envChannel) {
      channelId = envChannel;
    }
  }

  // Only use env fallback for silentDays if DB didn't provide a value.
  // We already checked DB above, so just check if we still have the default value
  // and if the env var is set. This avoids a redundant DB query.
  // GOTCHA: This logic assumes 7 is the default. If you change the default above,
  // update this check or env fallback will silently break. Been there.
  // WHY not use undefined as a sentinel? Because TypeScript + SQLite nulls are pain.
  const envDays = process.env.SILENT_FIRST_MSG_DAYS;
  if (envDays && !isNaN(Number(envDays)) && silentDays === 7) {
    // silentDays === 7 means DB either didn't have a row or had null for this field
    // (since we initialized to 7 and only changed it if DB had a non-null value)
    silentDays = Number(envDays);
  }

  const result = { channelId, silentDays };

  // Cache the result
  setCache(guildId, result);
  return result;
}

/**
 * WHAT: Set flags channel ID for a guild (upsert).
 * WHY: Allows per-guild override via /config set flags.channel command.
 *
 * @param guildId - Discord guild ID
 * @param channelId - Discord channel ID
 * @example
 * setFlagsChannelId('123456789', '987654321');
 */
export function setFlagsChannelId(guildId: string, channelId: string): void {
  // Use Unix epoch timestamp (INTEGER) to match standardized guild_config.updated_at_s column
  // This aligns with action_log.created_at_s and panicStore patterns for consistency
  const nowS = Math.floor(Date.now() / 1000);

  try {
    // UPSERT pattern: insert new row or update existing guild_config entry
    // ON CONFLICT ensures idempotent updates (safe to call multiple times)
    // This is called by /config set flags.channel command (ManageGuild permission required)
    upsertFlagsChannelStmt.run(guildId, channelId, nowS);

    // Invalidate cache AFTER successful write to prevent serving stale data
    // This ensures any subsequent reads get the fresh value from DB
    invalidateCache(guildId);

    logger.info({ guildId, channelId }, "[flagger] flags_channel_id updated");
  } catch (err: unknown) {
    // If the column doesn't exist, this means the migration hasn't run yet
    // Provide a helpful error message
    const error = err as Error;
    if (error?.message?.includes("has no column named flags_channel_id")) {
      logger.error(
        { err, guildId, channelId },
        "[flagger] guild_config table missing flags_channel_id column - database migration may not have run. Run: tsx scripts/migrate.ts"
      );
      throw new Error(
        "Database schema is outdated. Please run migrations (tsx scripts/migrate.ts), then try again."
      );
    }
    // Re-throw other errors
    throw err;
  }
}

/**
 * WHAT: Set silent first message threshold (days) for a guild (upsert).
 * WHY: Allows per-guild override via /config set flags.silent_days command.
 *
 * @param guildId - Discord guild ID
 * @param days - Threshold in days (7-365)
 * @example
 * setSilentFirstMsgDays('123456789', 120);
 */
export function setSilentFirstMsgDays(guildId: string, days: number): void {
  // Validate range
  // Why 7 minimum? Because flagging someone who joined yesterday for "not talking"
  // is a bit aggressive. Give people time to find the snacks channel.
  // Why 365 max? If they haven't talked in a year, they're not lurking, they're gone.
  if (days < 7 || days > 365) {
    throw new Error("Silent days threshold must be between 7 and 365 days");
  }

  // Use Unix epoch timestamp (INTEGER) to match standardized guild_config.updated_at_s column
  // This aligns with action_log.created_at_s and panicStore patterns for consistency
  const nowS = Math.floor(Date.now() / 1000);

  try {
    // UPSERT pattern: insert new row or update existing guild_config entry
    upsertSilentDaysStmt.run(guildId, days, nowS);

    // Invalidate cache AFTER successful write to prevent serving stale data
    invalidateCache(guildId);

    logger.info({ guildId, days }, "[flagger] silent_first_msg_days updated");
  } catch (err: unknown) {
    // If the column doesn't exist, this means the migration hasn't run yet
    const error = err as Error;
    if (error?.message?.includes("has no column named silent_first_msg_days")) {
      logger.error(
        { err, guildId, days },
        "[flagger] guild_config table missing silent_first_msg_days column - database migration may not have run. Run: tsx scripts/migrate.ts"
      );
      throw new Error(
        "Database schema is outdated. Please run migrations (tsx scripts/migrate.ts), then try again."
      );
    }
    // Re-throw other errors
    throw err;
  }
}
