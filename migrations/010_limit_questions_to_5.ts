/**
 * Pawtropolis Tech — migrations/010_limit_questions_to_5.ts
 * WHAT: Limits gate questions to q_index 0..4 (5 questions max) by adding CHECK constraint.
 * WHY: Reduces complexity and aligns with updated UI that shows only 5 questions.
 * HOW: Delete rows with q_index >= 5, rebuild table with CHECK constraint.
 * DOCS:
 *  - SQLite CHECK constraints: https://sqlite.org/lang_createtable.html#check_constraints
 *  - Table rebuild pattern: https://sqlite.org/lang_altertable.html
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (checks constraint existence)
 *  - Data preservation: copies all valid rows (q_index 0..4)
 *  - Foreign keys preserved: maintains ON DELETE CASCADE relationship
 *  - Logs row counts for audit trail
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
 * Check if table has a CHECK constraint limiting q_index to 0..4
 */
function hasQuestionLimitConstraint(db: Database): boolean {
  const ddlRow = db
    .prepare(`SELECT sql FROM sqlite_schema WHERE type='table' AND name='guild_question'`)
    .get() as { sql: string } | undefined;

  if (!ddlRow?.sql) return false;

  // Check if the constraint exists and limits to 0..4
  return /q_index\s+BETWEEN\s+0\s+AND\s+4/i.test(ddlRow.sql);
}

/**
 * Migration: Limit guild questions to 5 (q_index 0..4)
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate010LimitQuestionsTo5(db: Database): void {
  logger.info("[migration 010] Starting: limit guild_question to q_index 0..4");

  // Ensure foreign keys are enabled
  db.pragma("foreign_keys = ON");

  // Check if guild_question table exists
  if (!tableExists(db, "guild_question")) {
    logger.info(
      "[migration 010] guild_question table does not exist yet, skipping (will be created by setup)"
    );
    recordMigration(db, "010", "limit_questions_to_5");
    return;
  }

  // Check if constraint already exists
  if (hasQuestionLimitConstraint(db)) {
    logger.info("[migration 010] guild_question already has q_index 0..4 constraint, skipping");
    recordMigration(db, "010", "limit_questions_to_5");
    return;
  }

  logger.info("[migration 010] Applying q_index 0..4 constraint to guild_question");

  // Count rows before migration
  const countBefore = db.prepare(`SELECT COUNT(*) as count FROM guild_question`).get() as {
    count: number;
  };
  logger.info({ count: countBefore.count }, "[migration 010] Row count before migration");

  // Count rows that will be deleted (q_index >= 5)
  const countToDelete = db
    .prepare(`SELECT COUNT(*) as count FROM guild_question WHERE q_index >= 5`)
    .get() as { count: number };
  if (countToDelete.count > 0) {
    logger.warn(
      { count: countToDelete.count },
      "[migration 010] Deleting questions with q_index >= 5"
    );
  }

  // Delete rows with q_index >= 5
  db.prepare(`DELETE FROM guild_question WHERE q_index >= 5`).run();

  // Rebuild table with CHECK constraint
  // NOTE: We need to disable foreign keys temporarily to rebuild the table
  db.pragma("foreign_keys = OFF");

  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_question_new (
      guild_id TEXT NOT NULL,
      q_index  INTEGER NOT NULL CHECK (q_index BETWEEN 0 AND 4),
      prompt   TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
      PRIMARY KEY (guild_id, q_index),
      FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id) ON DELETE CASCADE
    );

    INSERT INTO guild_question_new (guild_id, q_index, prompt, required)
      SELECT guild_id, q_index, prompt, required
      FROM guild_question
      WHERE q_index BETWEEN 0 AND 4;

    DROP TABLE guild_question;

    ALTER TABLE guild_question_new RENAME TO guild_question;
  `);

  db.pragma("foreign_keys = ON");

  // Count rows after migration
  const countAfter = db.prepare(`SELECT COUNT(*) as count FROM guild_question`).get() as {
    count: number;
  };
  logger.info(
    { count: countAfter.count, deleted: countBefore.count - countAfter.count },
    "[migration 010] Row count after migration"
  );

  // Verify constraint is in place
  if (!hasQuestionLimitConstraint(db)) {
    throw new Error("[migration 010] Failed to apply q_index constraint");
  }

  // Record migration
  recordMigration(db, "010", "limit_questions_to_5");

  logger.info("[migration 010] Migration completed successfully");
}

/**
 * Records migration in schema_migrations table
 * Creates table if it doesn't exist
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
