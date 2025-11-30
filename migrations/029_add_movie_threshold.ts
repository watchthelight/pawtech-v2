/**
 * Pawtropolis Tech — migrations/029_add_movie_threshold.ts
 * WHAT: Adds configurable qualification threshold to guild_movie_config
 * WHY: Allows guilds to customize the movie night attendance threshold
 *      instead of using the hardcoded 30-minute value
 * DOCS:
 *  - SQLite ALTER TABLE: https://sqlite.org/lang_altertable.html
 *
 * SAFETY:
 *  - Idempotent: checks for column existence before adding
 *  - Backward compatible: defaults to 30 minutes (current behavior)
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/**
 * Migration: Add qualification_threshold_minutes to guild_movie_config
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate029AddMovieThreshold(db: Database): void {
  logger.info("[migration 029] Starting: add movie qualification threshold");

  enableForeignKeys(db);

  // Add column if it doesn't exist
  if (!columnExists(db, "guild_movie_config", "qualification_threshold_minutes")) {
    logger.info("[migration 029] Adding qualification_threshold_minutes column");
    db.exec(`
      ALTER TABLE guild_movie_config
      ADD COLUMN qualification_threshold_minutes INTEGER DEFAULT 30
    `);
    logger.info("[migration 029] qualification_threshold_minutes column added");
  } else {
    logger.info("[migration 029] qualification_threshold_minutes already exists, skipping");
  }

  recordMigration(db, "029", "add_movie_threshold");
  logger.info("[migration 029] Complete");
}
