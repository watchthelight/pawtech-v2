/**
 * Pawtropolis Tech — migrations/018_add_ping_dev_on_app.ts
 * WHAT: Add ping_dev_on_app column to guild_config table
 * WHY: Allow guilds to toggle Bot Dev role pings on new applications
 * HOW: ALTER TABLE to add boolean column with default TRUE
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
 * Migration: Add ping_dev_on_app to guild_config
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate018AddPingDevOnApp(db: Database): void {
  logger.info("[migration 018] Starting: add ping_dev_on_app to guild_config");

  // Ensure foreign keys are enabled
  enableForeignKeys(db);

  // Check if guild_config table exists
  if (!tableExists(db, "guild_config")) {
    logger.info(
      "[migration 018] guild_config table does not exist yet, skipping (will be created by ensure.ts)"
    );
    recordMigration(db, "018", "add_ping_dev_on_app");
    return;
  }

  // Add ping_dev_on_app column (defaults to true/1)
  if (!columnExists(db, "guild_config", "ping_dev_on_app")) {
    logger.info("[migration 018] Adding ping_dev_on_app column");
    db.exec(`ALTER TABLE guild_config ADD COLUMN ping_dev_on_app INTEGER NOT NULL DEFAULT 1`);
    logger.info("[migration 018] ping_dev_on_app added");
  } else {
    logger.info("[migration 018] ping_dev_on_app already exists, skipping");
  }

  // Record migration
  recordMigration(db, "018", "add_ping_dev_on_app");

  logger.info("[migration 018] ✅ Complete");
}
