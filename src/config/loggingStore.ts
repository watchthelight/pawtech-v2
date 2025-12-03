/**
 * Pawtropolis Tech — src/config/loggingStore.ts
 * WHAT: Per-guild logging channel configuration with env fallback.
 * WHY: Allows guilds to override default logging channel from LOGGING_CHANNEL env var.
 * FLOWS:
 *  - getLoggingChannelId(guildId) → channelId or null
 *  - setLoggingChannelId(guildId, channelId) → upserts guild_config
 * DOCS:
 *  - better-sqlite3 prepared statements: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { LRUCache } from "../lib/lruCache.js";

// ============================================================================
// Prepared Statements (cached at module load for performance)
// ============================================================================

// WHY a separate SELECT statement when we could just use getConfig()?
// Performance. This is called on every action log, and getConfig() returns
// the entire row. We only need one column. Micro-optimization? Maybe.
// But it adds up when you're logging dozens of actions per minute.
const getLoggingChannelStmt = db.prepare(
  `SELECT logging_channel_id FROM guild_config WHERE guild_id = ?`
);

const upsertLoggingChannelStmt = db.prepare(
  `INSERT INTO guild_config (guild_id, logging_channel_id, updated_at_s)
   VALUES (?, ?, ?)
   ON CONFLICT(guild_id) DO UPDATE SET
     logging_channel_id = excluded.logging_channel_id,
     updated_at_s = excluded.updated_at_s`
);

// ============================================================================
// Cache Layer
// ============================================================================
// LRU cache with TTL and bounded size to prevent unbounded memory growth.
// getLoggingChannelId is called frequently (every action log), so caching is important.

const CACHE_TTL_MS = 60 * 1000; // 1 minute TTL - balances freshness vs DB load
const CACHE_MAX_SIZE = 1000; // Max guilds to cache - prevents unbounded memory growth

// Note: LRUCache stores values directly, but we need to distinguish between
// "not cached" (undefined) and "cached null" (null). We use a wrapper type.
// This is the billion dollar mistake in action: null vs undefined vs "not present."
// Welcome to JavaScript.
// If you're thinking "just use a Map with has()"... we do. LRU has delete on expiry.
type CachedValue = { value: string | null };
const loggingChannelCache = new LRUCache<string, CachedValue>(CACHE_MAX_SIZE, CACHE_TTL_MS);

/**
 * Get from cache if not expired
 */
function getCached(guildId: string): string | null | undefined {
  const entry = loggingChannelCache.get(guildId);
  if (entry !== undefined) {
    return entry.value;
  }
  return undefined; // Cache miss or expired
}

/**
 * Set cache entry with TTL
 */
function setCache(guildId: string, value: string | null): void {
  loggingChannelCache.set(guildId, { value });
}

/**
 * Invalidate cache entry for a guild (call after writes)
 */
function invalidateCache(guildId: string): void {
  loggingChannelCache.delete(guildId);
}

/**
 * Clear logging cache entry for a guild (called on guildDelete).
 * WHAT: Removes in-memory cache entry when bot leaves a guild
 * WHY: Prevents memory leak from accumulating entries for departed guilds
 * NOTE: Does NOT delete DB row - that data may be useful if bot rejoins
 */
export function clearLoggingCache(guildId: string): void {
  const existed = loggingChannelCache.delete(guildId);
  if (existed) {
    logger.debug({ guildId }, "[logging] Cleared cache entry for departed guild");
  }
}

/**
 * WHAT: Get logging channel ID for a guild.
 * WHY: Supports per-guild override with fallback to process.env.LOGGING_CHANNEL.
 *
 * @param guildId - Discord guild ID
 * @returns Channel ID (string) or null if not configured
 * @example
 * const channelId = getLoggingChannelId('123456789');
 * if (channelId) {
 *   const channel = await guild.channels.fetch(channelId);
 * }
 */
export function getLoggingChannelId(guildId: string): string | null {
  // Check cache first
  const cached = getCached(guildId);
  if (cached !== undefined) {
    return cached;
  }

  let result: string | null = null;

  try {
    // First, check for guild-specific override in guild_config table
    // This allows individual guilds to set their own logging channel via /config set logging
    const row = getLoggingChannelStmt.get(guildId) as { logging_channel_id: string | null } | undefined;

    if (row?.logging_channel_id) {
      result = row.logging_channel_id;
      setCache(guildId, result);
      return result;
    }
  } catch (err) {
    // Gracefully handle missing table/column (pre-migration databases)
    // This prevents crashes during startup before ensureActionLogSchema runs
    logger.warn({ err, guildId }, "[config] Failed to query guild_config, falling back to env");
  }

  // Fallback to env variable (applies to all guilds without override)
  // Set LOGGING_CHANNEL in .env to configure default logging destination
  // GOTCHA: Empty string in .env counts as "set" to node but falsy to JS.
  // The || null handles both undefined AND empty string cases.
  const envChannel = process.env.LOGGING_CHANNEL;
  result = envChannel || null;

  // Cache the result (including null/env fallback)
  setCache(guildId, result);
  return result;
}

/**
 * WHAT: Set logging channel ID for a guild (upsert).
 * WHY: Allows per-guild override via /config set-logging command.
 *
 * @param guildId - Discord guild ID
 * @param channelId - Discord channel ID
 * @example
 * setLoggingChannelId('123456789', '987654321');
 */
export function setLoggingChannelId(guildId: string, channelId: string): void {
  // Use Unix epoch timestamp (INTEGER) to match standardized guild_config.updated_at_s column
  // This aligns with action_log.created_at_s and panicStore patterns for consistency
  const nowS = Math.floor(Date.now() / 1000);

  try {
    // UPSERT pattern: insert new row or update existing guild_config entry
    // ON CONFLICT ensures idempotent updates (safe to call multiple times)
    // This is called by /config set logging command (ManageGuild permission required)
    upsertLoggingChannelStmt.run(guildId, channelId, nowS);

    // Invalidate cache AFTER successful write to prevent serving stale data
    // This ensures any subsequent reads get the fresh value from DB
    // Order matters here: invalidate AFTER the write succeeds, not before.
    // Otherwise a read during the write window gets the old value and caches it.
    invalidateCache(guildId);

    logger.info({ guildId, channelId }, "[config] logging_channel_id updated");
  } catch (err: unknown) {
    // If the column doesn't exist, this means the migration hasn't run yet
    // Provide a helpful error message
    const error = err as Error;
    if (error?.message?.includes("has no column named logging_channel_id")) {
      logger.error(
        { err, guildId, channelId },
        "[config] guild_config table missing logging_channel_id column - database migration may not have run. Restart the bot to apply migrations."
      );
      throw new Error(
        "Database schema is outdated. Please restart the bot to apply pending migrations, then try again."
      );
    }
    // Re-throw other errors
    throw err;
  }
}
