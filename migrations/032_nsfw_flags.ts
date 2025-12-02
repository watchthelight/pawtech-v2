/**
 * Pawtropolis Tech — migrations/032_nsfw_flags.ts
 * WHAT: Create nsfw_flags table for /audit nsfw command
 * WHY: Track NSFW avatar flags from the audit command
 * DOCS:
 *  - SQLite CREATE TABLE: https://sqlite.org/lang_createtable.html
 *  - SQLite CREATE INDEX: https://sqlite.org/lang_createindex.html
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (uses IF NOT EXISTS)
 *  - Additive only: no data loss
 *  - Uses helper functions for consistency
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/**
 * Migration: Create nsfw_flags table
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate032NsfwFlags(db: Database): void {
  logger.info("[migration 032] Starting: create nsfw_flags table");

  // Ensure foreign keys are enabled
  enableForeignKeys(db);

  // Create table if it doesn't exist
  if (!tableExists(db, "nsfw_flags")) {
    logger.info("[migration 032] Creating nsfw_flags table");

    db.exec(`
      CREATE TABLE nsfw_flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        avatar_url TEXT NOT NULL,
        nsfw_score REAL NOT NULL,
        reason TEXT NOT NULL,
        flagged_by TEXT NOT NULL,
        flagged_at TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed INTEGER NOT NULL DEFAULT 0,
        UNIQUE(guild_id, user_id)
      )
    `);

    // Create indices
    logger.info("[migration 032] Creating indices");
    db.exec(`CREATE INDEX idx_nsfw_flags_guild ON nsfw_flags(guild_id)`);
    db.exec(`CREATE INDEX idx_nsfw_flags_pending ON nsfw_flags(guild_id, reviewed)`);

    logger.info("[migration 032] nsfw_flags table created successfully");
  } else {
    logger.info("[migration 032] nsfw_flags table already exists, skipping");
  }

  // Record migration
  recordMigration(db, "032", "nsfw_flags");

  logger.info("[migration 032] Complete");
}
