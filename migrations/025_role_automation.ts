/**
 * Pawtropolis Tech — migrations/025_role_automation.ts
 * WHAT: Creates tables for automated role assignment system
 * WHY: Supports level rewards, movie night tiers, and audit trail
 * TABLES:
 *  - role_tiers: configurable tier mappings (level, movie_night)
 *  - level_rewards: token/ticket roles granted at each level
 *  - movie_attendance: tracking VC participation per event
 *  - role_assignments: audit trail for all role changes
 *  - guild_movie_config: per-guild movie attendance settings
 * DOCS:
 *  - SQLite CREATE TABLE: https://sqlite.org/lang_createtable.html
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (uses IF NOT EXISTS)
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, indexExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/*
 * GOTCHA: This migration creates 5 tables and 7 indexes. If it fails partway through
 * and you're not in a transaction, you'll have a partial state. The helpers use
 * IF NOT EXISTS, so re-running should be fine, but you might want to verify the
 * schema manually if something blows up at 3am.
 */

/**
 * Migration: Create role automation tables
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate025RoleAutomation(db: Database): void {
  logger.info("[migration 025] Starting: role automation tables");

  // Ensure foreign keys are enabled
  enableForeignKeys(db);

  // Create role_tiers table
  if (!tableExists(db, "role_tiers")) {
    logger.info("[migration 025] Creating role_tiers table");
    /*
     * tier_type is a free-form string (e.g., "level", "movie_night") rather than
     * an ENUM because SQLite doesn't have ENUMs and we want flexibility for new
     * tier types without another migration. Validate in application code instead.
     */
    db.exec(`
      CREATE TABLE role_tiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        tier_type TEXT NOT NULL,
        tier_name TEXT NOT NULL,
        role_id TEXT NOT NULL,
        threshold INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(guild_id, tier_type, tier_name)
      )
    `);
    logger.info("[migration 025] role_tiers table created");
  } else {
    logger.info("[migration 025] role_tiers table already exists, skipping");
  }

  // Create level_rewards table
  // WHY: Stores role_name denormalized because Discord roles can be deleted/renamed
  // and we still want the historical record to show what the role was called when granted.
  if (!tableExists(db, "level_rewards")) {
    logger.info("[migration 025] Creating level_rewards table");
    db.exec(`
      CREATE TABLE level_rewards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        level INTEGER NOT NULL,
        role_id TEXT NOT NULL,
        role_name TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(guild_id, level, role_id)
      )
    `);
    logger.info("[migration 025] level_rewards table created");
  } else {
    logger.info("[migration 025] level_rewards table already exists, skipping");
  }

  // Create movie_attendance table
  if (!tableExists(db, "movie_attendance")) {
    logger.info("[migration 025] Creating movie_attendance table");
    /*
     * We track both duration_minutes (total time) AND longest_session_minutes because
     * some people hop in and out of VC constantly. A user with 60 total minutes across
     * 20 sessions of 3 minutes each is not the same as someone who stayed for a full
     * hour. The longest_session helps detect this gaming behavior.
     *
     * qualified is INTEGER 0/1 because SQLite doesn't have a boolean type. Welcome to 1987.
     */
    db.exec(`
      CREATE TABLE movie_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        event_date TEXT NOT NULL,
        voice_channel_id TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        longest_session_minutes INTEGER NOT NULL,
        qualified INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(guild_id, user_id, event_date)
      )
    `);
    logger.info("[migration 025] movie_attendance table created");
  } else {
    logger.info("[migration 025] movie_attendance table already exists, skipping");
  }

  /*
   * This table is a full audit trail for every role change the bot makes.
   * Absolutely essential for debugging "why does this user have 47 roles now"
   * situations and for keeping mods off our backs when someone complains.
   */
  // Create role_assignments table
  if (!tableExists(db, "role_assignments")) {
    logger.info("[migration 025] Creating role_assignments table");
    // details is TEXT for JSON blob storage. It's ugly but flexible.
    db.exec(`
      CREATE TABLE role_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        role_name TEXT,
        action TEXT NOT NULL,
        reason TEXT,
        triggered_by TEXT,
        details TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    logger.info("[migration 025] role_assignments table created");
  } else {
    logger.info("[migration 025] role_assignments table already exists, skipping");
  }

  // Create guild_movie_config table
  // attendance_mode can be 'cumulative' (total across all events) or 'single' (per event).
  // Most guilds want cumulative but some run weekly competitions and want fresh counts.
  if (!tableExists(db, "guild_movie_config")) {
    logger.info("[migration 025] Creating guild_movie_config table");
    db.exec(`
      CREATE TABLE guild_movie_config (
        guild_id TEXT PRIMARY KEY,
        attendance_mode TEXT DEFAULT 'cumulative',
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    logger.info("[migration 025] guild_movie_config table created");
  } else {
    logger.info("[migration 025] guild_movie_config table already exists, skipping");
  }

  /*
   * INDEX PHILOSOPHY: We're indexing for the common query patterns.
   * All lookups are guild-scoped because Discord bots always filter by guild first.
   * If you're not filtering by guild_id, you're doing something wrong (or very creative).
   */
  // Create indexes
  if (!indexExists(db, "idx_role_tiers_guild")) {
    logger.info("[migration 025] Creating idx_role_tiers_guild index");
    db.exec(`CREATE INDEX idx_role_tiers_guild ON role_tiers(guild_id, tier_type)`);
  }

  if (!indexExists(db, "idx_level_rewards_guild")) {
    logger.info("[migration 025] Creating idx_level_rewards_guild index");
    db.exec(`CREATE INDEX idx_level_rewards_guild ON level_rewards(guild_id, level)`);
  }

  if (!indexExists(db, "idx_movie_attendance_guild_user")) {
    logger.info("[migration 025] Creating idx_movie_attendance_guild_user index");
    db.exec(`CREATE INDEX idx_movie_attendance_guild_user ON movie_attendance(guild_id, user_id)`);
  }

  if (!indexExists(db, "idx_movie_attendance_date")) {
    logger.info("[migration 025] Creating idx_movie_attendance_date index");
    db.exec(`CREATE INDEX idx_movie_attendance_date ON movie_attendance(event_date)`);
  }

  if (!indexExists(db, "idx_role_assignments_user")) {
    logger.info("[migration 025] Creating idx_role_assignments_user index");
    db.exec(`CREATE INDEX idx_role_assignments_user ON role_assignments(guild_id, user_id)`);
  }

  // Time-based index for "show me what happened in the last hour" queries.
  if (!indexExists(db, "idx_role_assignments_time")) {
    logger.info("[migration 025] Creating idx_role_assignments_time index");
    db.exec(`CREATE INDEX idx_role_assignments_time ON role_assignments(created_at)`);
  }

  // Useful for answering "who all has this role according to our records"
  // Rare query pattern, but when you need it, you really need it.
  if (!indexExists(db, "idx_role_assignments_role")) {
    logger.info("[migration 025] Creating idx_role_assignments_role index");
    db.exec(`CREATE INDEX idx_role_assignments_role ON role_assignments(role_id)`);
  }

  // Record migration
  recordMigration(db, "025", "role_automation");

  logger.info("[migration 025] ✅ Complete");
}
