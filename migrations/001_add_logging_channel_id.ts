/**
 * Pawtropolis Tech — migrations/001_add_logging_channel_id.ts
 * WHAT: Adds logging_channel_id column to guild_config table and backfills from env.
 * WHY: Enables per-guild logging channel configuration for pretty-card audit logs.
 * HOW: ALTER TABLE to add column, backfill from LOGGING_CHANNEL env var if set.
 * DOCS:
 *  - SQLite ALTER TABLE: https://sqlite.org/lang_altertable.html
 *  - PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (checks column existence)
 *  - Additive only: no data loss, no table recreation
 *  - Uses PRAGMA foreign_keys=ON for referential integrity
 *  - Logs backfill summary for audit trail
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, tableExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/**
 * Migration: Add logging_channel_id to guild_config
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate001AddLoggingChannelId(db: Database): void {
  logger.info("[migration 001] Starting: add logging_channel_id to guild_config");

  // Ensure foreign keys are enabled (best practice for migrations)
  enableForeignKeys(db);

  // Check if guild_config table exists
  // NOTE: This migration should only add the column to existing table
  // If table doesn't exist, it will be created by ensureActionLogSchema in ensure.ts
  if (!tableExists(db, "guild_config")) {
    logger.info(
      "[migration 001] guild_config table does not exist yet, skipping (will be created by ensure.ts)"
    );

    // Record migration as applied (idempotent - safe to skip if table created later)
    recordMigration(db, "001", "add_logging_channel_id");
    return;
  }

  // Check if logging_channel_id column already exists
  if (columnExists(db, "guild_config", "logging_channel_id")) {
    logger.info("[migration 001] logging_channel_id column already exists, skipping");

    // Ensure migration is recorded (idempotent)
    recordMigration(db, "001", "add_logging_channel_id");
    return;
  }

  // Add the column
  logger.info("[migration 001] Adding logging_channel_id column to guild_config");
  db.exec(`ALTER TABLE guild_config ADD COLUMN logging_channel_id TEXT`);
  logger.info("[migration 001] Column added successfully");

  // Backfill from environment variable if set
  const loggingChannel = process.env.LOGGING_CHANNEL;
  if (loggingChannel) {
    logger.info(
      { loggingChannel },
      "[migration 001] LOGGING_CHANNEL env var detected, backfilling guild_config rows"
    );

    const result = db
      .prepare(
        `
        UPDATE guild_config
        SET logging_channel_id = ?
        WHERE logging_channel_id IS NULL
      `
      )
      .run(loggingChannel);

    logger.info(
      { rowsUpdated: result.changes, channelId: loggingChannel },
      "[migration 001] Backfilled logging_channel_id from LOGGING_CHANNEL env var"
    );
  } else {
    logger.info("[migration 001] No LOGGING_CHANNEL env var set, skipping backfill");
  }

  // Record migration
  recordMigration(db, "001", "add_logging_channel_id");

  logger.info("[migration 001] ✅ Complete");
}
