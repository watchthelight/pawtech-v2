/**
 * Migration 027: Standardize Guild Config Timestamps
 *
 * WHAT: Backfills updated_at_s (INTEGER/Unix epoch) from updated_at (TEXT/ISO8601).
 * WHY: Standardizes timestamp format across all stores - INTEGER is more performant
 *      and consistent with action_log.created_at_s pattern already in use.
 * HOW: Converts existing TEXT timestamps to INTEGER Unix epoch, sets current time
 *      for rows missing both timestamp columns.
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (only updates NULL updated_at_s)
 *  - Non-destructive: does not remove updated_at column (that's Phase 3, post-soak)
 *  - Logs backfill summary for audit trail
 *
 * DOCS:
 *  - SQLite strftime: https://www.sqlite.org/lang_datefunc.html
 *  - Issue #11: /docs/roadmap/011-standardize-timestamp-formats.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, columnExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/**
 * Migration: Standardize guild_config timestamps to INTEGER (Unix epoch)
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate027StandardizeGuildConfigTimestamps(db: Database): void {
  logger.info("[migration 027] Starting: standardize guild_config timestamps");

  // Ensure foreign keys are enabled (best practice for migrations)
  enableForeignKeys(db);

  // Check if guild_config table exists
  if (!tableExists(db, "guild_config")) {
    logger.info(
      "[migration 027] guild_config table does not exist yet, skipping (will be created by ensure.ts)"
    );
    recordMigration(db, "027", "standardize_guild_config_timestamps");
    return;
  }

  // Check if updated_at_s column exists (it should, created by ensurePanicModeColumn)
  if (!columnExists(db, "guild_config", "updated_at_s")) {
    logger.info("[migration 027] Adding updated_at_s column to guild_config");
    db.exec(`ALTER TABLE guild_config ADD COLUMN updated_at_s INTEGER`);
  }

  // Count rows that need backfill
  const needsBackfillFromText = db
    .prepare(
      `SELECT COUNT(*) as count FROM guild_config
       WHERE updated_at_s IS NULL AND updated_at IS NOT NULL`
    )
    .get() as { count: number };

  const needsBackfillDefault = db
    .prepare(
      `SELECT COUNT(*) as count FROM guild_config
       WHERE updated_at_s IS NULL AND (updated_at IS NULL OR updated_at = '')`
    )
    .get() as { count: number };

  logger.info(
    {
      fromTextTimestamp: needsBackfillFromText.count,
      fromDefault: needsBackfillDefault.count,
    },
    "[migration 027] Rows needing backfill"
  );

  // Phase 1, Step 2: Backfill updated_at_s from updated_at (TEXT -> INTEGER)
  if (needsBackfillFromText.count > 0) {
    const result = db
      .prepare(
        `UPDATE guild_config
         SET updated_at_s = CAST(strftime('%s', updated_at) AS INTEGER)
         WHERE updated_at_s IS NULL AND updated_at IS NOT NULL`
      )
      .run();

    logger.info(
      { rowsUpdated: result.changes },
      "[migration 027] Backfilled updated_at_s from updated_at TEXT column"
    );
  }

  // Phase 1, Step 3: Set default value for rows with neither timestamp
  if (needsBackfillDefault.count > 0) {
    const result = db
      .prepare(
        `UPDATE guild_config
         SET updated_at_s = CAST(strftime('%s', 'now') AS INTEGER)
         WHERE updated_at_s IS NULL`
      )
      .run();

    logger.info(
      { rowsUpdated: result.changes },
      "[migration 027] Set default timestamp for rows missing both timestamp columns"
    );
  }

  // Verify: count remaining NULL updated_at_s
  const remainingNull = db
    .prepare(`SELECT COUNT(*) as count FROM guild_config WHERE updated_at_s IS NULL`)
    .get() as { count: number };

  if (remainingNull.count > 0) {
    logger.warn(
      { remainingNull: remainingNull.count },
      "[migration 027] Warning: some rows still have NULL updated_at_s"
    );
  } else {
    logger.info("[migration 027] All guild_config rows now have updated_at_s populated");
  }

  // Record migration
  recordMigration(db, "027", "standardize_guild_config_timestamps");

  logger.info("[migration 027] Complete: guild_config timestamps standardized");
}
