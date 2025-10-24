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

export interface FlaggerConfig {
  channelId: string | null;
  silentDays: number;
}

/**
 * WHAT: Get flagger configuration for a guild (channel + threshold).
 * WHY: Supports per-guild override with fallback to process.env.
 *
 * Resolution priority:
 *  1. Database (guild_config.flags_channel_id, guild_config.silent_first_msg_days)
 *  2. Environment variables (FLAGGED_REPORT_CHANNEL_ID, SILENT_FIRST_MSG_DAYS)
 *  3. Defaults (channelId: null, silentDays: 90)
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
  let channelId: string | null = null;
  let silentDays: number = 90; // Default threshold

  try {
    // First, check for guild-specific override in guild_config table
    // This allows individual guilds to set their own flags channel via /config set flags.channel
    const row = db
      .prepare(
        `SELECT flags_channel_id, silent_first_msg_days FROM guild_config WHERE guild_id = ?`
      )
      .get(guildId) as
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
    logger.debug({ err, guildId }, "[flagger] Failed to query guild_config, falling back to env");
  }

  // Fallback to env variables (applies to all guilds without override)
  // Set FLAGGED_REPORT_CHANNEL_ID and SILENT_FIRST_MSG_DAYS in .env to configure defaults
  if (!channelId) {
    const envChannel = process.env.FLAGGED_REPORT_CHANNEL_ID;
    if (envChannel) {
      channelId = envChannel;
    }
  }

  const envDays = process.env.SILENT_FIRST_MSG_DAYS;
  if (envDays && !isNaN(Number(envDays))) {
    // Only override if DB didn't provide a value
    const row = db
      .prepare(`SELECT silent_first_msg_days FROM guild_config WHERE guild_id = ?`)
      .get(guildId) as { silent_first_msg_days: number | null } | undefined;

    if (!row || row.silent_first_msg_days === null) {
      silentDays = Number(envDays);
    }
  }

  return { channelId, silentDays };
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
  const now = new Date().toISOString();

  try {
    // UPSERT pattern: insert new row or update existing guild_config entry
    // ON CONFLICT ensures idempotent updates (safe to call multiple times)
    // This is called by /config set flags.channel command (ManageGuild permission required)
    db.prepare(
      `
      INSERT INTO guild_config (guild_id, flags_channel_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        flags_channel_id = excluded.flags_channel_id,
        updated_at = excluded.updated_at
    `
    ).run(guildId, channelId, now);

    logger.info({ guildId, channelId }, "[flagger] flags_channel_id updated");
  } catch (err: any) {
    // If the column doesn't exist, this means the migration hasn't run yet
    // Provide a helpful error message
    if (err?.message?.includes("has no column named flags_channel_id")) {
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
  if (days < 7 || days > 365) {
    throw new Error("Silent days threshold must be between 7 and 365 days");
  }

  const now = new Date().toISOString();

  try {
    // UPSERT pattern: insert new row or update existing guild_config entry
    db.prepare(
      `
      INSERT INTO guild_config (guild_id, silent_first_msg_days, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        silent_first_msg_days = excluded.silent_first_msg_days,
        updated_at = excluded.updated_at
    `
    ).run(guildId, days, now);

    logger.info({ guildId, days }, "[flagger] silent_first_msg_days updated");
  } catch (err: any) {
    // If the column doesn't exist, this means the migration hasn't run yet
    if (err?.message?.includes("has no column named silent_first_msg_days")) {
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
