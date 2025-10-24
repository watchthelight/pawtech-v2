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

/**
 * Check if table exists
 */
function tableExists(db: Database, table: string): boolean {
  const result = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table);
  return !!result;
}

/**
 * Migration: Create mod_metrics table
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate002CreateModMetrics(db: Database): void {
  logger.info("[migration 002] Starting: create mod_metrics table");

  // Ensure foreign keys are enabled
  db.pragma("foreign_keys = ON");

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
  const count = db.prepare(`SELECT COUNT(*) as count FROM mod_metrics`).get() as { count: number };
  logger.info({ count: count.count }, "[migration 002] Verification: mod_metrics row count");

  // Record migration
  recordMigration(db, "002", "create_mod_metrics");

  logger.info("[migration 002] Migration completed successfully");
}

/**
 * Records migration in schema_migrations table
 */
function recordMigration(db: Database, version: string, name: string): void {
  // Ensure schema_migrations table exists (should exist from migration 001)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Record migration (idempotent - ON CONFLICT DO NOTHING)
  db.prepare(
    `
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES (?, ?, strftime('%s', 'now'))
    ON CONFLICT(version) DO NOTHING
  `
  ).run(version, name);

  logger.info({ version, name }, "[migration] Recorded in schema_migrations");
}
