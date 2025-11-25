/**
 * Pawtropolis Tech — migrations/004_metrics_epoch_and_joins.ts
 * WHAT: Creates metrics_epoch table and ensures action_log indexes for member_join tracking.
 * WHY: Support metrics reset without deleting historical data; track join→submit ratios.
 * HOW: Store per-guild metrics epoch; add composite index for efficient join/submit queries.
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (IF NOT EXISTS)
 *  - Indexed on (guild_id, action, created_at_s) for efficient join/submit queries
 *  - metrics_epoch allows resetting metrics without deleting historical action_log data
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
 * Check if index exists
 */
function indexExists(db: Database, index: string): boolean {
  const result = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
    .get(index);
  return !!result;
}

/**
 * Migration: Create metrics_epoch table and join tracking indexes
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate004MetricsEpochAndJoins(db: Database): void {
  logger.info("[migration 004] Starting: create metrics_epoch table and join tracking");

  // Ensure foreign keys are enabled
  db.pragma("foreign_keys = ON");

  // Create metrics_epoch table
  if (!tableExists(db, "metrics_epoch")) {
    logger.info("[migration 004] Creating metrics_epoch table");

    db.exec(`
      CREATE TABLE metrics_epoch (
        guild_id   TEXT PRIMARY KEY,
        start_at   TEXT NOT NULL
      )
    `);

    logger.info("[migration 004] metrics_epoch table created");
  } else {
    logger.info("[migration 004] metrics_epoch table already exists, skipping");
  }

  // Create composite index for efficient join/submit queries
  const indexName = "idx_action_log_guild_action_time";

  if (!indexExists(db, indexName)) {
    logger.info(
      "[migration 004] Creating composite index on action_log (guild_id, action, created_at_s)"
    );

    db.exec(`
      CREATE INDEX ${indexName}
      ON action_log(guild_id, action, created_at_s)
    `);

    logger.info(`[migration 004] Index ${indexName} created`);
  } else {
    logger.info(`[migration 004] Index ${indexName} already exists, skipping`);
  }

  // Verification
  const epochCount = db.prepare(`SELECT COUNT(*) as count FROM metrics_epoch`).get() as {
    count: number;
  };
  logger.info({ count: epochCount.count }, "[migration 004] Verification: metrics_epoch row count");

  // Record migration
  recordMigration(db, "004", "metrics_epoch_and_joins");

  logger.info("[migration 004] Migration completed successfully");
}

/**
 * Records migration in schema_migrations table
 */
function recordMigration(db: Database, version: string, name: string): void {
  // Ensure schema_migrations table exists
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
