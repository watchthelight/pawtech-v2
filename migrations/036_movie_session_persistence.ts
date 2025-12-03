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

/*
 * THE BACKSTORY: We learned the hard way that keeping movie attendance only in
 * memory is a recipe for sadness. Bot crashes during a 3-hour movie night? All
 * that attendance data? Gone. Poof. Angry users in the mod queue at midnight.
 *
 * This migration adds disk persistence so we can recover from crashes mid-event.
 * Also adds audit columns because someone WILL complain that they "definitely
 * watched the whole movie" when they clearly didn't, and we need receipts.
 */

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
  // Only one active event per guild at a time (hence guild_id as PK).
  // If you need concurrent events, you'll need a schema change. You probably don't.
  if (!tableExists(db, "active_movie_events")) {
    logger.info("[migration 036] Creating active_movie_events table");
    // created_at is in milliseconds (note the * 1000) for JS Date compatibility.
    // Inconsistent with other tables that use seconds, but changing it would break things.
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
  /*
   * This is the hot path for crash recovery. On startup, we check this table
   * for active sessions and restore the in-memory state.
   *
   * current_session_start is NULL when the user isn't in VC, has a timestamp
   * when they are. On recovery, if it's non-NULL and the user is still in VC,
   * we resume timing from last_persisted_at (not current_session_start) to
   * avoid counting the crash window as attendance.
   */
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

  /*
   * AUDIT COLUMNS: These let mods manually adjust attendance and leave a paper trail.
   * adjustment_type: 'automatic' (normal) or 'manual' (mod override)
   * adjusted_by: user ID of the mod who made the change
   * adjustment_reason: why they did it, for when they forget in 6 months
   *
   * SQLite ALTER TABLE can only add columns with constant defaults, hence
   * the nullable columns for adjusted_by and adjustment_reason.
   */
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
