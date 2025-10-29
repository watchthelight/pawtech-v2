/**
 * Pawtropolis Tech — migrations/008_manual_flags.ts
 * WHAT: Adds manual flag support to user_activity table
 * WHY: Allow moderators to manually flag users with custom reasons
 * HOW: Add flagged_reason and manual_flag columns to user_activity
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (column existence checks)
 *  - Preserves existing user_activity data (ALTER TABLE ADD COLUMN)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, recordMigration, enableForeignKeys, getRowCount } from "./lib/helpers.js";

/**
 * Migration: Add manual flag support to user_activity
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate008ManualFlags(db: Database): void {
  logger.info("[migration 008] Starting: add manual flag support");

  // Ensure foreign keys are enabled
  enableForeignKeys(db);

  // ==============================================================
  // Step 1: Add flagged_reason column
  // ==============================================================

  if (!columnExists(db, "user_activity", "flagged_reason")) {
    logger.info("[migration 008] Adding flagged_reason column to user_activity");

    db.exec(`
      ALTER TABLE user_activity
      ADD COLUMN flagged_reason TEXT
    `);

    logger.info("[migration 008] flagged_reason column added");
  } else {
    logger.info("[migration 008] flagged_reason column already exists, skipping");
  }

  // ==============================================================
  // Step 2: Add manual_flag column
  // ==============================================================

  if (!columnExists(db, "user_activity", "manual_flag")) {
    logger.info("[migration 008] Adding manual_flag column to user_activity");

    db.exec(`
      ALTER TABLE user_activity
      ADD COLUMN manual_flag INTEGER DEFAULT 0
    `);

    logger.info("[migration 008] manual_flag column added (default: 0)");
  } else {
    logger.info("[migration 008] manual_flag column already exists, skipping");
  }

  // ==============================================================
  // Step 3: Add flagged_by column (moderator user ID)
  // ==============================================================

  if (!columnExists(db, "user_activity", "flagged_by")) {
    logger.info("[migration 008] Adding flagged_by column to user_activity");

    db.exec(`
      ALTER TABLE user_activity
      ADD COLUMN flagged_by TEXT
    `);

    logger.info("[migration 008] flagged_by column added");
  } else {
    logger.info("[migration 008] flagged_by column already exists, skipping");
  }

  // ==============================================================
  // Verification
  // ==============================================================

  const activityCount = getRowCount(db, "user_activity");

  logger.info({ count: activityCount }, "[migration 008] Verification: user_activity row count");

  // Record migration
  recordMigration(db, "008", "manual_flags");

  logger.info("[migration 008] ✅ Complete");
}
