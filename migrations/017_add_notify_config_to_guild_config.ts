/**
 * Pawtropolis Tech — migrations/017_add_notify_config_to_guild_config.ts
 * WHAT: Add forum post notification config columns to guild_config table
 * WHY: Support in-thread role pings and rate limiting for forum posts
 * COLUMNS:
 *  - forum_channel_id: which forum channel to watch (NULL = any forum)
 *  - notify_role_id: role to ping (NULL = disabled)
 *  - notify_mode: 'post' (in-thread) or 'channel' (separate channel)
 *  - notification_channel_id: target channel if mode=channel
 *  - notify_cooldown_seconds: minimum seconds between pings (default 5)
 *  - notify_max_per_hour: max pings per hour (default 10)
 * DOCS:
 *  - SQLite ALTER TABLE: https://www.sqlite.org/lang_altertable.html
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (checks column existence)
 *  - Additive only: no data loss
 *  - Uses helper functions for consistency
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, tableExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/**
 * Migration: Add notification config columns to guild_config
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate017AddNotifyConfigToGuildConfig(db: Database): void {
  logger.info("[migration 017] Starting: add notify config columns to guild_config");

  // Ensure foreign keys are enabled
  enableForeignKeys(db);

  // Check if guild_config table exists
  if (!tableExists(db, "guild_config")) {
    logger.info(
      "[migration 017] guild_config table does not exist yet, skipping (will be created by ensure.ts)"
    );
    recordMigration(db, "017", "add_notify_config_to_guild_config");
    return;
  }

  // Add forum_channel_id
  if (!columnExists(db, "guild_config", "forum_channel_id")) {
    logger.info("[migration 017] Adding forum_channel_id column");
    db.exec(`ALTER TABLE guild_config ADD COLUMN forum_channel_id TEXT`);
    logger.info("[migration 017] forum_channel_id added");
  } else {
    logger.info("[migration 017] forum_channel_id already exists, skipping");
  }

  // Add notify_role_id
  if (!columnExists(db, "guild_config", "notify_role_id")) {
    logger.info("[migration 017] Adding notify_role_id column");
    db.exec(`ALTER TABLE guild_config ADD COLUMN notify_role_id TEXT`);
    logger.info("[migration 017] notify_role_id added");
  } else {
    logger.info("[migration 017] notify_role_id already exists, skipping");
  }

  // Add notify_mode
  if (!columnExists(db, "guild_config", "notify_mode")) {
    logger.info("[migration 017] Adding notify_mode column");
    db.exec(`ALTER TABLE guild_config ADD COLUMN notify_mode TEXT DEFAULT 'post'`);
    logger.info("[migration 017] notify_mode added");
  } else {
    logger.info("[migration 017] notify_mode already exists, skipping");
  }

  // Add notification_channel_id
  if (!columnExists(db, "guild_config", "notification_channel_id")) {
    logger.info("[migration 017] Adding notification_channel_id column");
    db.exec(`ALTER TABLE guild_config ADD COLUMN notification_channel_id TEXT`);
    logger.info("[migration 017] notification_channel_id added");
  } else {
    logger.info("[migration 017] notification_channel_id already exists, skipping");
  }

  // Add notify_cooldown_seconds
  if (!columnExists(db, "guild_config", "notify_cooldown_seconds")) {
    logger.info("[migration 017] Adding notify_cooldown_seconds column");
    db.exec(`ALTER TABLE guild_config ADD COLUMN notify_cooldown_seconds INTEGER DEFAULT 5`);
    logger.info("[migration 017] notify_cooldown_seconds added");
  } else {
    logger.info("[migration 017] notify_cooldown_seconds already exists, skipping");
  }

  // Add notify_max_per_hour
  if (!columnExists(db, "guild_config", "notify_max_per_hour")) {
    logger.info("[migration 017] Adding notify_max_per_hour column");
    db.exec(`ALTER TABLE guild_config ADD COLUMN notify_max_per_hour INTEGER DEFAULT 10`);
    logger.info("[migration 017] notify_max_per_hour added");
  } else {
    logger.info("[migration 017] notify_max_per_hour already exists, skipping");
  }

  // Record migration
  recordMigration(db, "017", "add_notify_config_to_guild_config");

  logger.info("[migration 017] ✅ Complete");
}
