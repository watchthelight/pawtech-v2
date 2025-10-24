/**
 * Pawtropolis Tech — migrations/2025-10-20_review_action_free_text.ts
 * WHAT: Migrates review_action table to support free-text actions and Unix epoch timestamps.
 * WHY: Unblocks new/future actions without schema edits; ensures uniform audit with created_at.
 * HOW: Copy-swap migration; drops legacy CHECK constraint; backfills created_at from TEXT to INTEGER.
 * DOCS:
 *  - SQLite table recreation: https://sqlite.org/lang_altertable.html
 *  - PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
 *  - SQLite indexes: https://sqlite.org/lang_createindex.html
 *
 * SAFETY:
 *  - Uses db.transaction for atomicity (all or nothing)
 *  - Checksums row count before/after migration
 *  - Uses prepared statements only (no raw SQL string concat)
 *  - Backfills created_at using COALESCE + strftime for determinism
 *
 * MIGRATION STEPS:
 *  1. Detect current table shape via PRAGMA
 *  2. If legacy CHECK exists → perform copy-swap in single transaction
 *  3. Create review_action_new with no CHECK constraint, INTEGER created_at
 *  4. Copy rows with COALESCE(created_at, strftime('%s','now')) to backfill
 *  5. Drop old index, drop old table, rename new table
 *  6. Recreate index: idx_review_action_app_time(app_id, created_at DESC)
 *  7. Log checksum (row count before/after)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";

/**
 * Runs the migration to remove CHECK constraint and convert created_at to INTEGER.
 * Idempotent: safe to call multiple times.
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrateReviewActionFreeText(db: Database): void {
  try {
    // Check if table exists
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='review_action'`)
      .get();

    if (!tableExists) {
      logger.info("[migrate] review_action table does not exist, skipping migration");
      return;
    }

    // Introspect current schema via PRAGMA
    const cols = db.prepare(`PRAGMA table_info(review_action)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;

    const createdAtCol = cols.find((c) => c.name === "created_at");

    // Check if created_at is already INTEGER (migration already applied)
    if (createdAtCol && createdAtCol.type === "INTEGER") {
      logger.info("[migrate] review_action.created_at already INTEGER, skipping migration");
      return;
    }

    // Check if CHECK constraint exists by attempting probe insert
    // (We can't directly query CHECK constraints in SQLite)
    const hasCheckConstraint = (() => {
      try {
        const tx = db.transaction(() => {
          db.prepare(
            `
            INSERT INTO review_action (app_id, moderator_id, action, reason, meta)
            VALUES ('__probe__', '__probe__', '__unknown_action__', NULL, NULL)
          `
          ).run();
          throw new Error("rollback"); // Force rollback
        });
        tx();
        return false; // Insert would succeed → no CHECK
      } catch (e: any) {
        return /CHECK constraint failed/.test(String(e?.message ?? ""));
      }
    })();

    if (!hasCheckConstraint && createdAtCol?.type === "TEXT") {
      // Only convert created_at type (no CHECK to remove)
      logger.info("[migrate] review_action has no CHECK, converting created_at to INTEGER");
      performCreatedAtConversion(db);
      return;
    }

    if (!hasCheckConstraint) {
      logger.info("[migrate] review_action already migrated (no CHECK, created_at is INTEGER)");
      return;
    }

    // Perform full migration: remove CHECK + convert created_at
    logger.info("[migrate] review_action CHECK constraint detected, starting copy-swap migration");
    performFullMigration(db);
  } catch (err) {
    logger.error({ err }, "[migrate] failed to migrate review_action table");
    throw err;
  }
}

/**
 * Performs the full copy-swap migration inside a single transaction.
 * Removes CHECK constraint and converts created_at from TEXT to INTEGER.
 */
function performFullMigration(db: Database): void {
  const migrate = db.transaction(() => {
    // Count rows before migration (checksum)
    const countBefore = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
      count: number;
    };
    logger.info(`[migrate] review_action row count before: ${countBefore.count}`);

    // Drop existing indexes (will recreate after table swap)
    db.prepare(`DROP INDEX IF EXISTS idx_review_action_app_time`).run();
    db.prepare(`DROP INDEX IF EXISTS idx_review_app`).run();
    db.prepare(`DROP INDEX IF EXISTS idx_review_moderator`).run();

    // Create new table with no CHECK constraint and INTEGER created_at
    db.prepare(
      `
      CREATE TABLE review_action_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id        TEXT NOT NULL,
        moderator_id  TEXT NOT NULL,
        action        TEXT NOT NULL,
        reason        TEXT,
        message_link  TEXT,
        meta          TEXT,
        created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
      )
    `
    ).run();

    // Copy rows with created_at conversion:
    // - If created_at is TEXT (ISO8601), convert to Unix seconds
    // - If NULL, use current time via strftime
    db.prepare(
      `
      INSERT INTO review_action_new (id, app_id, moderator_id, action, reason, message_link, meta, created_at)
      SELECT
        id,
        app_id,
        moderator_id,
        action,
        reason,
        message_link,
        meta,
        COALESCE(
          CASE
            WHEN created_at IS NOT NULL AND created_at != ''
            THEN strftime('%s', created_at)
            ELSE NULL
          END,
          strftime('%s', 'now')
        ) as created_at
      FROM review_action
    `
    ).run();

    // Verify row count matches (data integrity check)
    const countAfter = db.prepare(`SELECT COUNT(*) as count FROM review_action_new`).get() as {
      count: number;
    };
    logger.info(`[migrate] review_action_new row count after copy: ${countAfter.count}`);

    if (countBefore.count !== countAfter.count) {
      throw new Error(
        `[migrate] row count mismatch: before=${countBefore.count}, after=${countAfter.count}`
      );
    }

    // Drop old table and rename new table
    db.prepare(`DROP TABLE review_action`).run();
    db.prepare(`ALTER TABLE review_action_new RENAME TO review_action`).run();

    // Recreate index with DESC sort for efficient recent-action queries
    db.prepare(
      `
      CREATE INDEX IF NOT EXISTS idx_review_action_app_time
      ON review_action(app_id, created_at DESC)
    `
    ).run();

    // Recreate moderator index for analytics queries
    db.prepare(
      `
      CREATE INDEX IF NOT EXISTS idx_review_moderator
      ON review_action(moderator_id)
    `
    ).run();

    logger.info(
      `[migrate] review_action migration completed successfully (${countAfter.count} rows)`
    );
  });

  migrate(); // Execute transaction
}

/**
 * Converts created_at from TEXT to INTEGER when no CHECK constraint exists.
 * Simpler path for cases where CHECK was already removed manually.
 */
function performCreatedAtConversion(db: Database): void {
  const migrate = db.transaction(() => {
    const countBefore = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
      count: number;
    };
    logger.info(
      `[migrate] review_action row count before created_at conversion: ${countBefore.count}`
    );

    db.prepare(`DROP INDEX IF EXISTS idx_review_action_app_time`).run();
    db.prepare(`DROP INDEX IF EXISTS idx_review_app`).run();

    db.prepare(
      `
      CREATE TABLE review_action_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id        TEXT NOT NULL,
        moderator_id  TEXT NOT NULL,
        action        TEXT NOT NULL,
        reason        TEXT,
        message_link  TEXT,
        meta          TEXT,
        created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
      )
    `
    ).run();

    db.prepare(
      `
      INSERT INTO review_action_new (id, app_id, moderator_id, action, reason, message_link, meta, created_at)
      SELECT
        id, app_id, moderator_id, action, reason, message_link, meta,
        COALESCE(
          CASE
            WHEN created_at IS NOT NULL AND created_at != ''
            THEN strftime('%s', created_at)
            ELSE NULL
          END,
          strftime('%s', 'now')
        ) as created_at
      FROM review_action
    `
    ).run();

    const countAfter = db.prepare(`SELECT COUNT(*) as count FROM review_action_new`).get() as {
      count: number;
    };
    if (countBefore.count !== countAfter.count) {
      throw new Error(`Row count mismatch: before=${countBefore.count}, after=${countAfter.count}`);
    }

    db.prepare(`DROP TABLE review_action`).run();
    db.prepare(`ALTER TABLE review_action_new RENAME TO review_action`).run();

    db.prepare(
      `
      CREATE INDEX IF NOT EXISTS idx_review_action_app_time
      ON review_action(app_id, created_at DESC)
    `
    ).run();

    logger.info(`[migrate] created_at conversion completed (${countAfter.count} rows)`);
  });

  migrate();
}
