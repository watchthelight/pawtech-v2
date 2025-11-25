/**
 * Pawtropolis Tech — migrations/011_add_custom_status_column.ts
 * WHAT: Add custom_status column to bot_status table
 * WHY: Support both activity (Playing/Watching) and custom status (green text) separately
 * HOW: ALTER TABLE to add custom_status column
 *
 * SAFETY:
 *  - Idempotent: checks if column exists before adding
 *  - Preserves existing bot_status data (ALTER TABLE ADD COLUMN)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, enableForeignKeys } from "./lib/helpers.js";

/**
 * Migration: Add custom_status column to bot_status
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate011AddCustomStatusColumn(db: Database): void {
  logger.info("[migration 011] Starting: add custom_status column");

  // Enable foreign keys
  enableForeignKeys(db);

  // Check if custom_status column exists
  if (!columnExists(db, "bot_status", "custom_status")) {
    logger.info("[migration 011] Adding custom_status column to bot_status");
    db.prepare(`ALTER TABLE bot_status ADD COLUMN custom_status TEXT`).run();
    logger.info("[migration 011] ✓ Added custom_status column");
  } else {
    logger.info("[migration 011] custom_status column already exists, skipping");
  }

  // Note: SQLite doesn't support ALTER COLUMN to change nullability
  // Making activity_type and activity_text nullable requires recreating the table
  // For existing installations, NULL values will work fine
  // New installations will get the correct schema from statusStore.ensureBotStatusSchema()

  logger.info("[migration 011] ✅ Complete");
}
