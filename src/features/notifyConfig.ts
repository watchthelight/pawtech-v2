/**
 * Pawtropolis Tech — src/features/notifyConfig.ts
 * WHAT: Guild notification configuration accessor helpers
 * WHY: Centralize reads/writes for forum post notification settings
 * FLOWS:
 *  - getNotifyConfig() reads from guild_config table
 *  - setNotifyConfig() updates guild_config and logs action
 * DOCS:
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

export interface NotifyConfig {
  forum_channel_id?: string | null;
  notify_role_id?: string | null;
  notify_mode?: "post" | "channel";
  notification_channel_id?: string | null;
  notify_cooldown_seconds?: number;
  notify_max_per_hour?: number;
}

/**
 * WHAT: Get notification config for guild
 * WHY: Read current settings from DB
 *
 * @param guildId - Guild snowflake
 * @returns Notification config with defaults
 */
export function getNotifyConfig(guildId: string): NotifyConfig {
  try {
    const row = db
      .prepare(
        `
      SELECT
        forum_channel_id,
        notify_role_id,
        notify_mode,
        notification_channel_id,
        notify_cooldown_seconds,
        notify_max_per_hour
      FROM guild_config
      WHERE guild_id = ?
    `
      )
      .get(guildId) as NotifyConfig | undefined;

    // Hardcoded defaults for main guild (896070888594759740)
    const MAIN_GUILD_ID = "896070888594759740";
    const isMainGuild = guildId === MAIN_GUILD_ID;

    if (!row) {
      // Return hardcoded defaults for main guild, empty defaults for others
      return isMainGuild
        ? {
            forum_channel_id: "1193455312326377592",
            notify_role_id: "1397856960862486598",
            notify_mode: "post",
            notification_channel_id: "1425945053192257566",
            notify_cooldown_seconds: 5,
            notify_max_per_hour: 10,
          }
        : {
            notify_mode: "post",
            notify_cooldown_seconds: 5,
            notify_max_per_hour: 10,
          };
    }

    // Apply hardcoded defaults for main guild if values are NULL
    return {
      forum_channel_id: row.forum_channel_id ?? (isMainGuild ? "1193455312326377592" : null),
      notify_role_id: row.notify_role_id ?? (isMainGuild ? "1397856960862486598" : null),
      notify_mode: (row.notify_mode as "post" | "channel") || "post",
      notification_channel_id: row.notification_channel_id ?? (isMainGuild ? "1425945053192257566" : null),
      notify_cooldown_seconds: row.notify_cooldown_seconds || 5,
      notify_max_per_hour: row.notify_max_per_hour || 10,
    };
  } catch (err) {
    logger.error({ err, guildId }, "[notifyConfig] failed to get config");
    // Return hardcoded defaults for main guild on error
    const MAIN_GUILD_ID = "896070888594759740";
    return guildId === MAIN_GUILD_ID
      ? {
          forum_channel_id: "1193455312326377592",
          notify_role_id: "1397856960862486598",
          notify_mode: "post",
          notification_channel_id: "1425945053192257566",
          notify_cooldown_seconds: 5,
          notify_max_per_hour: 10,
        }
      : {
          notify_mode: "post",
          notify_cooldown_seconds: 5,
          notify_max_per_hour: 10,
        };
  }
}

/**
 * WHAT: Set notification config for guild
 * WHY: Update settings in DB
 *
 * @param guildId - Guild snowflake
 * @param config - Partial config to update
 * @returns Previous config for audit logging
 */
export function setNotifyConfig(guildId: string, config: Partial<NotifyConfig>): NotifyConfig {
  const oldConfig = getNotifyConfig(guildId);

  try {
    // Ensure guild_config row exists
    db.prepare(
      `
      INSERT INTO guild_config (guild_id)
      VALUES (?)
      ON CONFLICT(guild_id) DO NOTHING
    `
    ).run(guildId);

    // Build UPDATE statement dynamically based on provided fields
    const updates: string[] = [];
    const values: any[] = [];

    if (config.forum_channel_id !== undefined) {
      updates.push("forum_channel_id = ?");
      values.push(config.forum_channel_id);
    }
    if (config.notify_role_id !== undefined) {
      updates.push("notify_role_id = ?");
      values.push(config.notify_role_id);
    }
    if (config.notify_mode !== undefined) {
      updates.push("notify_mode = ?");
      values.push(config.notify_mode);
    }
    if (config.notification_channel_id !== undefined) {
      updates.push("notification_channel_id = ?");
      values.push(config.notification_channel_id);
    }
    if (config.notify_cooldown_seconds !== undefined) {
      updates.push("notify_cooldown_seconds = ?");
      values.push(config.notify_cooldown_seconds);
    }
    if (config.notify_max_per_hour !== undefined) {
      updates.push("notify_max_per_hour = ?");
      values.push(config.notify_max_per_hour);
    }

    if (updates.length > 0) {
      values.push(guildId);
      db.prepare(
        `
        UPDATE guild_config
        SET ${updates.join(", ")}
        WHERE guild_id = ?
      `
      ).run(...values);
    }

    logger.info({ guildId, config }, "[notifyConfig] updated config");
  } catch (err) {
    logger.error({ err, guildId, config }, "[notifyConfig] failed to set config");
    throw err;
  }

  return oldConfig;
}

/**
 * WHAT: Get all guilds with notification configured
 * WHY: Admin overview / debugging
 *
 * @returns Array of guild IDs with notify_role_id set
 */
export function getConfiguredGuilds(): string[] {
  try {
    const rows = db
      .prepare(
        `
      SELECT guild_id
      FROM guild_config
      WHERE notify_role_id IS NOT NULL
    `
      )
      .all() as { guild_id: string }[];

    return rows.map((r) => r.guild_id);
  } catch (err) {
    logger.error({ err }, "[notifyConfig] failed to get configured guilds");
    return [];
  }
}
