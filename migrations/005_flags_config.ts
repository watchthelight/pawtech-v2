/**
 * Pawtropolis Tech — migrations/005_flags_config.ts
 * WHAT: Adds flags configuration columns to guild_config and creates user_activity table.
 * WHY: Support Silent-Since-Join First-Message Flagger (PR8) for bot detection.
 * HOW: Add flags_channel_id and silent_first_msg_days to guild_config; create user_activity table.
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (IF NOT EXISTS, column existence checks)
 *  - Indexed on (guild_id, user_id) for efficient activity lookups
 *  - Preserves existing guild_config data (ALTER TABLE ADD COLUMN)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";

/**
 * Check if table exists
 */
function tableExists(db: Database, table: string): boolean {
  const result = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table);
  return !!result;
}

/**
 * Check if column exists in table
 */
function columnExists(db: Database, table: string, column: string): boolean {
  const result = db
    .prepare(`SELECT COUNT(*) as count FROM pragma_table_info(?) WHERE name=?`)
    .get(table, column) as { count: number };
  return result.count > 0;
}

/**
 * Migration: Add flags configuration to guild_config and create user_activity table
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate005FlagsConfig(db: Database): void {
  logger.info("[migration 005] Starting: add flags configuration and user activity tracking");

  // Ensure foreign keys are enabled
  db.pragma("foreign_keys = ON");

  // ==============================================================
  // Step 1: Add flags_channel_id to guild_config
  // ==============================================================

  if (!columnExists(db, "guild_config", "flags_channel_id")) {
    logger.info("[migration 005] Adding flags_channel_id column to guild_config");

    db.exec(`
      ALTER TABLE guild_config
      ADD COLUMN flags_channel_id TEXT
    `);

    logger.info("[migration 005] flags_channel_id column added");
  } else {
    logger.info("[migration 005] flags_channel_id column already exists, skipping");
  }

  // ==============================================================
  // Step 2: Add silent_first_msg_days to guild_config
  // ==============================================================

  if (!columnExists(db, "guild_config", "silent_first_msg_days")) {
    logger.info("[migration 005] Adding silent_first_msg_days column to guild_config");

    db.exec(`
      ALTER TABLE guild_config
      ADD COLUMN silent_first_msg_days INTEGER DEFAULT 90
    `);

    logger.info("[migration 005] silent_first_msg_days column added (default: 90 days)");
  } else {
    logger.info("[migration 005] silent_first_msg_days column already exists, skipping");
  }

  // ==============================================================
  // Step 3: Create user_activity table
  // ==============================================================

  if (!tableExists(db, "user_activity")) {
    logger.info("[migration 005] Creating user_activity table");

    db.exec(`
      CREATE TABLE user_activity (
        guild_id           TEXT NOT NULL,
        user_id            TEXT NOT NULL,
        joined_at          INTEGER NOT NULL,
        first_message_at   INTEGER,
        flagged_at         INTEGER,
        PRIMARY KEY (guild_id, user_id)
      )
    `);

    logger.info("[migration 005] user_activity table created");
  } else {
    logger.info("[migration 005] user_activity table already exists, skipping");
  }

  // ==============================================================
  // Step 4: Create index for efficient activity lookups
  // ==============================================================

  const indexName = "idx_user_activity_guild_user";

  const indexExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
    .get(indexName);

  if (!indexExists) {
    logger.info("[migration 005] Creating index on user_activity (guild_id, user_id)");

    db.exec(`
      CREATE INDEX ${indexName}
      ON user_activity(guild_id, user_id)
    `);

    logger.info(`[migration 005] Index ${indexName} created`);
  } else {
    logger.info(`[migration 005] Index ${indexName} already exists, skipping`);
  }

  // ==============================================================
  // Verification
  // ==============================================================

  const activityCount = db.prepare(`SELECT COUNT(*) as count FROM user_activity`).get() as {
    count: number;
  };

  logger.info(
    { count: activityCount.count },
    "[migration 005] Verification: user_activity row count"
  );

  // Record migration
  recordMigration(db, "005", "flags_config");

  logger.info("[migration 005] Migration completed successfully");
}

/**
 * Records migration in schema_migrations table
 */
function recordMigration(db: Database, version: string, name: string): void {
  // Ensure schema_migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Record migration (idempotent - ON CONFLICT DO NOTHING)
  db.prepare(
    `
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES (?, ?, strftime('%s', 'now'))
    ON CONFLICT(version) DO NOTHING
  `
  ).run(version, name);

  logger.info({ version, name }, "[migration] Recorded in schema_migrations");
}
