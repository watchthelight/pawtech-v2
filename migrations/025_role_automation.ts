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

  // Create role_assignments table
  if (!tableExists(db, "role_assignments")) {
    logger.info("[migration 025] Creating role_assignments table");
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

  if (!indexExists(db, "idx_role_assignments_time")) {
    logger.info("[migration 025] Creating idx_role_assignments_time index");
    db.exec(`CREATE INDEX idx_role_assignments_time ON role_assignments(created_at)`);
  }

  if (!indexExists(db, "idx_role_assignments_role")) {
    logger.info("[migration 025] Creating idx_role_assignments_role index");
    db.exec(`CREATE INDEX idx_role_assignments_role ON role_assignments(role_id)`);
  }

  // Record migration
  recordMigration(db, "025", "role_automation");

  logger.info("[migration 025] ✅ Complete");
}
