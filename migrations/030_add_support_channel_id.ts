/**
 * Pawtropolis Tech — migrations/030_add_support_channel_id.ts
 * WHAT: Add support_channel_id column to guild_config table
 * WHY: Allows per-guild configuration of support channel for level reward messages
 *      (Issue #057 - move hardcoded Discord link to config)
 * DOCS:
 *  - SQLite ALTER TABLE: https://sqlite.org/lang_altertable.html
 *  - PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (checks column existence)
 *  - Additive only: no data loss, no table recreation
 *  - Uses helper functions for consistency
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, tableExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/**
 * Migration: Add support_channel_id to guild_config
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate030AddSupportChannelId(db: Database): void {
  logger.info("[migration 030] Starting: add support_channel_id to guild_config");

  // Ensure foreign keys are enabled
  enableForeignKeys(db);

  // Check if guild_config table exists
  if (!tableExists(db, "guild_config")) {
    logger.info(
      "[migration 030] guild_config table does not exist yet, skipping (will be created by ensure.ts)"
    );
    recordMigration(db, "030", "add_support_channel_id");
    return;
  }

  // Add support_channel_id column if it doesn't exist
  if (!columnExists(db, "guild_config", "support_channel_id")) {
    logger.info("[migration 030] Adding support_channel_id column");
    db.exec(`ALTER TABLE guild_config ADD COLUMN support_channel_id TEXT`);
    logger.info("[migration 030] support_channel_id added");
  } else {
    logger.info("[migration 030] support_channel_id already exists, skipping");
  }

  // Record migration
  recordMigration(db, "030", "add_support_channel_id");

  logger.info("[migration 030] Complete");
}
