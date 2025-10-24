/**
 * Pawtropolis Tech — migrations/001_add_logging_channel_id.ts
 * WHAT: Adds logging_channel_id column to guild_config table and backfills from env.
 * WHY: Enables per-guild logging channel configuration for pretty-card audit logs.
 * HOW: ALTER TABLE to add column, backfill from LOGGING_CHANNEL env var if set.
 * DOCS:
 *  - SQLite ALTER TABLE: https://sqlite.org/lang_altertable.html
 *  - PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (checks column existence)
 *  - Additive only: no data loss, no table recreation
 *  - Uses PRAGMA foreign_keys=ON for referential integrity
 *  - Logs backfill summary for audit trail
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";

/**
 * Check if a table has a specific column
 */
function hasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

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
 * Migration: Add logging_channel_id to guild_config
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate001AddLoggingChannelId(db: Database): void {
  logger.info("[migration 001] Starting: add logging_channel_id to guild_config");

  // Ensure foreign keys are enabled (best practice for migrations)
  db.pragma("foreign_keys = ON");

  // Check if guild_config table exists
  // NOTE: This migration should only add the column to existing table
  // If table doesn't exist, it will be created by ensureActionLogSchema in ensure.ts
  if (!tableExists(db, "guild_config")) {
    logger.info(
      "[migration 001] guild_config table does not exist yet, skipping (will be created by ensure.ts)"
    );

    // Record migration as applied (idempotent - safe to skip if table created later)
    recordMigration(db, "001", "add_logging_channel_id");
    return;
  }

  // Check if logging_channel_id column already exists
  if (hasColumn(db, "guild_config", "logging_channel_id")) {
    logger.info("[migration 001] logging_channel_id column already exists, skipping");

    // Ensure migration is recorded (idempotent)
    recordMigration(db, "001", "add_logging_channel_id");
    return;
  }

  // Add the column
  logger.info("[migration 001] Adding logging_channel_id column to guild_config");
  db.exec(`ALTER TABLE guild_config ADD COLUMN logging_channel_id TEXT`);
  logger.info("[migration 001] Column added successfully");

  // Backfill from environment variable if set
  const loggingChannel = process.env.LOGGING_CHANNEL;
  if (loggingChannel) {
    logger.info(
      { loggingChannel },
      "[migration 001] LOGGING_CHANNEL env var detected, backfilling guild_config rows"
    );

    const result = db
      .prepare(
        `
        UPDATE guild_config
        SET logging_channel_id = ?
        WHERE logging_channel_id IS NULL
      `
      )
      .run(loggingChannel);

    logger.info(
      { rowsUpdated: result.changes, channelId: loggingChannel },
      "[migration 001] Backfilled logging_channel_id from LOGGING_CHANNEL env var"
    );
  } else {
    logger.info("[migration 001] No LOGGING_CHANNEL env var set, skipping backfill");
  }

  // Record migration
  recordMigration(db, "001", "add_logging_channel_id");

  logger.info("[migration 001] Migration completed successfully");
}

/**
 * Records migration in schema_migrations table
 * Creates table if it doesn't exist, migrates legacy schema if needed
 */
function recordMigration(db: Database, version: string, name: string): void {
  // Check if schema_migrations table exists
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)
    .get();

  if (!tableExists) {
    // Create new table with proper schema
    db.exec(`
      CREATE TABLE schema_migrations (
        version     TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        applied_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `);
  } else {
    // Check if table has old schema (filename column instead of version/name)
    const cols = db.prepare(`PRAGMA table_info(schema_migrations)`).all() as Array<{
      name: string;
    }>;
    const hasFilenameCol = cols.some((c) => c.name === "filename");
    const hasVersionCol = cols.some((c) => c.name === "version");

    if (hasFilenameCol && !hasVersionCol) {
      // Legacy schema detected - migrate to new schema
      logger.info("[migration] Migrating legacy schema_migrations table to new schema");

      // Rename old table
      db.exec(`ALTER TABLE schema_migrations RENAME TO schema_migrations_old`);

      // Create new table
      db.exec(`
        CREATE TABLE schema_migrations (
          version     TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          applied_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )
      `);

      // Copy old data (extract version from filename like "2025-10-20_review_action_free_text.ts")
      db.exec(`
        INSERT INTO schema_migrations (version, name, applied_at)
        SELECT
          substr(filename, 1, instr(filename, '_') - 1) as version,
          substr(filename, instr(filename, '_') + 1, length(filename) - instr(filename, '_') - 3) as name,
          strftime('%s', applied_at) as applied_at
        FROM schema_migrations_old
      `);

      // Drop old table
      db.exec(`DROP TABLE schema_migrations_old`);

      logger.info("[migration] Legacy schema_migrations table migrated successfully");
    }
  }

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
