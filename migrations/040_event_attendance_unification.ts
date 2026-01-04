/**
 * Pawtropolis Tech — migrations/040_event_attendance_unification.ts
 * WHAT: Extends event attendance system to support game nights alongside movie nights
 * WHY: Unified event tracking with percentage-based qualification for game nights
 * TABLES MODIFIED:
 *  - movie_attendance: adds event_type, event_start_time, event_end_time
 *  - active_movie_events: adds event_type
 *  - active_movie_sessions: adds event_type
 * TABLES CREATED:
 *  - guild_game_config: per-guild game night settings
 * DOCS:
 *  - SQLite ALTER TABLE: https://sqlite.org/lang_altertable.html
 *
 * SAFETY:
 *  - Idempotent: checks for table/column existence before creating
 *  - Backward compatible: defaults preserve existing movie night behavior
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, columnExists, indexExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/*
 * THE PLAN: We're extending the movie night system to be a generic "event" system.
 * Game nights work differently from movie nights:
 *  - Movie nights: fixed minute threshold (e.g., 30 min)
 *  - Game nights: percentage of event duration (e.g., 50% of total runtime)
 *
 * This means game nights need to know the event start and end times to calculate
 * the percentage at finalization. Movie nights don't need this, but having the
 * data available for both doesn't hurt and might be useful for analytics.
 */

/**
 * Migration: Add event type support and game night configuration
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate040EventAttendanceUnification(db: Database): void {
  logger.info("[migration 040] Starting: event attendance unification");

  enableForeignKeys(db);

  // Add event_type column to movie_attendance
  // Default 'movie' ensures all existing records are correctly tagged
  if (!columnExists(db, "movie_attendance", "event_type")) {
    logger.info("[migration 040] Adding event_type column to movie_attendance");
    db.exec(`
      ALTER TABLE movie_attendance
      ADD COLUMN event_type TEXT DEFAULT 'movie'
    `);
    logger.info("[migration 040] event_type column added to movie_attendance");
  }

  // Add event_start_time to movie_attendance
  // Used for game night percentage calculation: user_minutes / (end - start)
  if (!columnExists(db, "movie_attendance", "event_start_time")) {
    logger.info("[migration 040] Adding event_start_time column to movie_attendance");
    db.exec(`
      ALTER TABLE movie_attendance
      ADD COLUMN event_start_time INTEGER
    `);
    logger.info("[migration 040] event_start_time column added");
  }

  // Add event_end_time to movie_attendance
  if (!columnExists(db, "movie_attendance", "event_end_time")) {
    logger.info("[migration 040] Adding event_end_time column to movie_attendance");
    db.exec(`
      ALTER TABLE movie_attendance
      ADD COLUMN event_end_time INTEGER
    `);
    logger.info("[migration 040] event_end_time column added");
  }

  // Add event_type to active_movie_events (for tracking which type of event is active)
  if (!columnExists(db, "active_movie_events", "event_type")) {
    logger.info("[migration 040] Adding event_type column to active_movie_events");
    db.exec(`
      ALTER TABLE active_movie_events
      ADD COLUMN event_type TEXT DEFAULT 'movie'
    `);
    logger.info("[migration 040] event_type column added to active_movie_events");
  }

  // Add event_type to active_movie_sessions (for crash recovery context)
  if (!columnExists(db, "active_movie_sessions", "event_type")) {
    logger.info("[migration 040] Adding event_type column to active_movie_sessions");
    db.exec(`
      ALTER TABLE active_movie_sessions
      ADD COLUMN event_type TEXT DEFAULT 'movie'
    `);
    logger.info("[migration 040] event_type column added to active_movie_sessions");
  }

  /*
   * GAME NIGHT CONFIG: Unlike movie nights which use a fixed minute threshold,
   * game nights use a percentage of total event duration.
   *
   * qualification_percentage: Default 50% - user must attend >50% of the event
   * attendance_mode: 'cumulative' (total time) or 'continuous' (longest session)
   *
   * This is separate from guild_movie_config because the settings are fundamentally
   * different (percentage vs. minutes) and we don't want to complicate the movie
   * night config with game-specific fields.
   */
  if (!tableExists(db, "guild_game_config")) {
    logger.info("[migration 040] Creating guild_game_config table");
    db.exec(`
      CREATE TABLE guild_game_config (
        guild_id TEXT PRIMARY KEY,
        qualification_percentage INTEGER DEFAULT 50,
        attendance_mode TEXT DEFAULT 'cumulative',
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    logger.info("[migration 040] guild_game_config table created");
  } else {
    logger.info("[migration 040] guild_game_config already exists, skipping");
  }

  // Index for event_type queries - useful for filtering by event type in stats
  if (!indexExists(db, "idx_movie_attendance_event_type")) {
    logger.info("[migration 040] Creating idx_movie_attendance_event_type index");
    db.exec(`
      CREATE INDEX idx_movie_attendance_event_type
      ON movie_attendance(guild_id, event_type, event_date)
    `);
    logger.info("[migration 040] idx_movie_attendance_event_type index created");
  }

  recordMigration(db, "040", "event_attendance_unification");
  logger.info("[migration 040] Complete");
}
