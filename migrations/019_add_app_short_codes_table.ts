/**
 * Pawtropolis Tech — migrations/019_add_app_short_codes_table.ts
 * WHAT: Add app_short_codes mapping table for O(1) short code lookups
 * WHY: Eliminate expensive full table scans when resolving HEX6 codes to application IDs
 * SCHEMA:
 *  - app_id: application.id (indexed + foreign key)
 *  - guild_id: guild snowflake (indexed for guild-scoped lookups)
 *  - code: HEX6 short code (UNIQUE for deterministic lookups)
 * PERFORMANCE:
 *  - Before: O(n) full scan of application table per lookup
 *  - After: O(1) indexed lookup via code column
 * DOCS:
 *  - SQLite CREATE TABLE: https://www.sqlite.org/lang_createtable.html
 *  - SQLite UNIQUE: https://www.sqlite.org/lang_createindex.html
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (checks table existence)
 *  - Additive only: no data loss
 *  - Foreign key to application.id ensures referential integrity
 *  - Use backfill script (scripts/backfill-app-mappings.mjs) to populate existing apps
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/**
 * Migration: Create app_short_codes mapping table
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate019AddAppShortCodesTable(db: Database): void {
  logger.info("[migration 019] Starting: create app_short_codes table");

  // Ensure foreign keys are enabled
  enableForeignKeys(db);

  // Check if table already exists (idempotent)
  if (tableExists(db, "app_short_codes")) {
    logger.info("[migration 019] app_short_codes table already exists, skipping");
    recordMigration(db, "019", "add_app_short_codes_table");
    return;
  }

  // Create app_short_codes table
  logger.info("[migration 019] Creating app_short_codes table");
  db.exec(`
    CREATE TABLE app_short_codes (
      app_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      code TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),

      PRIMARY KEY (app_id),
      UNIQUE (code),

      FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
    ) STRICT
  `);

  // Create indexes for fast lookups
  logger.info("[migration 019] Creating indexes on app_short_codes");

  // Index on code for O(1) lookups (covered by UNIQUE constraint above)
  // Index on guild_id for guild-scoped queries
  db.exec(`
    CREATE INDEX idx_app_short_codes_guild_code ON app_short_codes(guild_id, code)
  `);

  // Index on guild_id alone for backfill queries
  db.exec(`
    CREATE INDEX idx_app_short_codes_guild_id ON app_short_codes(guild_id)
  `);

  logger.info("[migration 019] Indexes created");

  // Record migration
  recordMigration(db, "019", "add_app_short_codes_table");

  logger.info("[migration 019] ✅ Complete");
  logger.info(
    "[migration 019] ⚠️  Run backfill script to populate existing applications: npm run backfill:app-mappings"
  );
}
