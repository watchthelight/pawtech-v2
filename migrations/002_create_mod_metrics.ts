/**
 * Pawtropolis Tech — migrations/002_create_mod_metrics.ts
 * WHAT: Creates mod_metrics table for computed moderator performance summaries.
 * WHY: Enables /modstats command and dashboard analytics without expensive real-time queries.
 * HOW: Persistent cache of per-moderator counts + response time percentiles.
 * DOCS:
 *  - SQLite CREATE TABLE: https://sqlite.org/lang_createtable.html
 *  - Percentile aggregation: computed in-memory, stored here
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (IF NOT EXISTS)
 *  - No foreign keys (moderator_id may not exist in users table)
 *  - Indexed by guild_id for fast leaderboard queries
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, recordMigration, enableForeignKeys, getRowCount } from "./lib/helpers.js";

/**
 * Migration: Create mod_metrics table
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate002CreateModMetrics(db: Database): void {
  logger.info("[migration 002] Starting: create mod_metrics table");

  // Ensure foreign keys are enabled
  enableForeignKeys(db);

  // Check if table already exists
  if (tableExists(db, "mod_metrics")) {
    logger.info("[migration 002] mod_metrics table already exists, skipping");
    recordMigration(db, "002", "create_mod_metrics");
    return;
  }

  // Create mod_metrics table
  logger.info("[migration 002] Creating mod_metrics table");

  db.exec(`
    CREATE TABLE mod_metrics (
      moderator_id        TEXT NOT NULL,
      guild_id            TEXT NOT NULL,
      total_claims        INTEGER NOT NULL DEFAULT 0,
      total_accepts       INTEGER NOT NULL DEFAULT 0,
      total_rejects       INTEGER NOT NULL DEFAULT 0,
      total_kicks         INTEGER NOT NULL DEFAULT 0,
      total_modmail_opens INTEGER NOT NULL DEFAULT 0,
      avg_response_time_s REAL DEFAULT NULL,
      p50_response_time_s REAL DEFAULT NULL,
      p95_response_time_s REAL DEFAULT NULL,
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (moderator_id, guild_id)
    )
  `);

  logger.info("[migration 002] mod_metrics table created");

  // Create index on guild_id for fast leaderboard queries
  logger.info("[migration 002] Creating index on guild_id");

  db.exec(`
    CREATE INDEX idx_mod_metrics_guild_id
    ON mod_metrics(guild_id, total_accepts DESC)
  `);

  logger.info("[migration 002] Index created");

  // Verification query - count rows (should be 0 initially)
  const count = getRowCount(db, "mod_metrics");
  logger.info({ count }, "[migration 002] Verification: mod_metrics row count");

  // Record migration
  recordMigration(db, "002", "create_mod_metrics");

  logger.info("[migration 002] ✅ Complete");
}
