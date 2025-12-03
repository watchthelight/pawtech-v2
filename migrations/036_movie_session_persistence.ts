/**
 * Pawtropolis Tech — migrations/036_movie_session_persistence.ts
 * WHAT: Adds tables for persisting movie night sessions and audit columns
 * WHY: Enables crash recovery and manual attendance adjustments
 * DOCS:
 *  - SQLite ALTER TABLE: https://sqlite.org/lang_altertable.html
 *
 * SAFETY:
 *  - Idempotent: checks for table/column existence before creating
 *  - Backward compatible: defaults preserve existing behavior
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, columnExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/**
 * Migration: Add movie session persistence and audit columns
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate036MovieSessionPersistence(db: Database): void {
  logger.info("[migration 036] Starting: movie session persistence");

  enableForeignKeys(db);

  // Create active_movie_events table for persisting event state
  if (!tableExists(db, "active_movie_events")) {
    logger.info("[migration 036] Creating active_movie_events table");
    db.exec(`
      CREATE TABLE active_movie_events (
        guild_id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        event_date TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      )
    `);
    logger.info("[migration 036] active_movie_events table created");
  } else {
    logger.info("[migration 036] active_movie_events already exists, skipping");
  }

  // Create active_movie_sessions table for persisting session data
  if (!tableExists(db, "active_movie_sessions")) {
    logger.info("[migration 036] Creating active_movie_sessions table");
    db.exec(`
      CREATE TABLE active_movie_sessions (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        event_date TEXT NOT NULL,
        current_session_start INTEGER,
        accumulated_minutes INTEGER DEFAULT 0,
        longest_session_minutes INTEGER DEFAULT 0,
        last_persisted_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id, event_date)
      )
    `);

    // Index for efficient recovery queries
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_active_movie_sessions_guild
      ON active_movie_sessions(guild_id, event_date)
    `);
    logger.info("[migration 036] active_movie_sessions table created");
  } else {
    logger.info("[migration 036] active_movie_sessions already exists, skipping");
  }

  // Add audit columns to movie_attendance
  if (!columnExists(db, "movie_attendance", "adjustment_type")) {
    logger.info("[migration 036] Adding adjustment_type column");
    db.exec(`
      ALTER TABLE movie_attendance
      ADD COLUMN adjustment_type TEXT DEFAULT 'automatic'
    `);
    logger.info("[migration 036] adjustment_type column added");
  }

  if (!columnExists(db, "movie_attendance", "adjusted_by")) {
    logger.info("[migration 036] Adding adjusted_by column");
    db.exec(`
      ALTER TABLE movie_attendance
      ADD COLUMN adjusted_by TEXT
    `);
    logger.info("[migration 036] adjusted_by column added");
  }

  if (!columnExists(db, "movie_attendance", "adjustment_reason")) {
    logger.info("[migration 036] Adding adjustment_reason column");
    db.exec(`
      ALTER TABLE movie_attendance
      ADD COLUMN adjustment_reason TEXT
    `);
    logger.info("[migration 036] adjustment_reason column added");
  }

  recordMigration(db, "036", "movie_session_persistence");
  logger.info("[migration 036] Complete");
}
