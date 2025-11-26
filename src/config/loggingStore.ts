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
import { nowUtc } from "../lib/time.js";
import { logger } from "../lib/logger.js";

// ============================================================================
// Cache Layer
// ============================================================================
// Simple TTL cache to avoid DB round-trips on every call. getLoggingChannelId
// is called frequently (every action log), so caching is important.

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 1000; // 1 minute TTL - balances freshness vs DB load
const loggingChannelCache = new Map<string, CacheEntry>();

/**
 * Get from cache if not expired
 */
function getCached(guildId: string): string | null | undefined {
  const entry = loggingChannelCache.get(guildId);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.value;
  }
  return undefined; // Cache miss or expired
}

/**
 * Set cache entry with TTL
 */
function setCache(guildId: string, value: string | null): void {
  loggingChannelCache.set(guildId, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Invalidate cache entry for a guild (call after writes)
 */
function invalidateCache(guildId: string): void {
  loggingChannelCache.delete(guildId);
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
    const row = db
      .prepare(`SELECT logging_channel_id FROM guild_config WHERE guild_id = ?`)
      .get(guildId) as { logging_channel_id: string | null } | undefined;

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
  // Invalidate cache BEFORE write to ensure stale reads are impossible
  // If DB write fails, cache will repopulate on next read
  invalidateCache(guildId);

  // Use ISO8601 timestamp to match guild_config.updated_at column (TEXT type)
  // Note: guild_config uses updated_at (TEXT), not updated_at_s (INTEGER) like action_log
  const now = new Date().toISOString();

  try {
    // UPSERT pattern: insert new row or update existing guild_config entry
    // ON CONFLICT ensures idempotent updates (safe to call multiple times)
    // This is called by /config set logging command (ManageGuild permission required)
    db.prepare(
      `
      INSERT INTO guild_config (guild_id, logging_channel_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        logging_channel_id = excluded.logging_channel_id,
        updated_at = excluded.updated_at
    `
    ).run(guildId, channelId, now);

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
