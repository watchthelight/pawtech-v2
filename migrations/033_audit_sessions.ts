/**
 * Pawtropolis Tech — migrations/033_audit_sessions.ts
 * WHAT: Create audit_sessions and audit_scanned_users tables
 * WHY: Track audit progress to enable resuming interrupted audits
 * DOCS:
 *  - SQLite CREATE TABLE: https://sqlite.org/lang_createtable.html
 *  - SQLite CREATE INDEX: https://sqlite.org/lang_createindex.html
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (uses IF NOT EXISTS)
 *  - Additive only: no data loss
 *  - Uses helper functions for consistency
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/*
 * CONTEXT: Auditing member avatars for NSFW content can take a while on large guilds.
 * We've had cases where the bot crashed mid-audit (OOM, cloud hiccups, someone tripped
 * over a cable in the datacenter). This migration adds persistence so we can resume
 * instead of starting over and burning Google Vision API credits twice.
 */

/**
 * Migration: Create audit session tracking tables
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate033AuditSessions(db: Database): void {
  logger.info("[migration 033] Starting: create audit session tables");

  // Ensure foreign keys are enabled
  enableForeignKeys(db);

  // Create audit_sessions table
  if (!tableExists(db, "audit_sessions")) {
    logger.info("[migration 033] Creating audit_sessions table");

    /*
     * api_calls tracks Vision API usage for cost monitoring. It's not strictly
     * necessary for resumption logic, but when the monthly bill arrives, you'll
     * want to know why it's $400 instead of $40.
     *
     * channel_id is where progress updates go. Required because the person who
     * started the audit will definitely close Discord and then ask "is it done yet?"
     */
    db.exec(`
      CREATE TABLE audit_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        audit_type TEXT NOT NULL,
        scope TEXT,
        status TEXT NOT NULL DEFAULT 'in_progress',
        started_by TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        total_to_scan INTEGER NOT NULL DEFAULT 0,
        scanned_count INTEGER NOT NULL DEFAULT 0,
        flagged_count INTEGER NOT NULL DEFAULT 0,
        api_calls INTEGER NOT NULL DEFAULT 0,
        channel_id TEXT NOT NULL
      )
    `);

    // Index for finding active sessions
    db.exec(`CREATE INDEX idx_audit_sessions_active ON audit_sessions(guild_id, audit_type, status)`);

    logger.info("[migration 033] audit_sessions table created");
  } else {
    logger.info("[migration 033] audit_sessions table already exists, skipping");
  }

  // Create audit_scanned_users table
  /*
   * DESIGN CHOICE: We only store user_id, not the scan result. The result lives
   * in nsfw_flags table. This table's only job is answering "did we already scan
   * this person in this session?" to avoid duplicate API calls on resume.
   *
   * ON DELETE CASCADE means when we purge old audit sessions, the scanned user
   * records go with them. Less orphaned data to haunt us.
   */
  if (!tableExists(db, "audit_scanned_users")) {
    logger.info("[migration 033] Creating audit_scanned_users table");

    db.exec(`
      CREATE TABLE audit_scanned_users (
        session_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, user_id),
        FOREIGN KEY (session_id) REFERENCES audit_sessions(id) ON DELETE CASCADE
      )
    `);

    // Index for fast lookup. Technically redundant with the PK, but SQLite doesn't
    // always use composite PK indexes efficiently for single-column lookups.
    db.exec(`CREATE INDEX idx_audit_scanned_session ON audit_scanned_users(session_id)`);

    logger.info("[migration 033] audit_scanned_users table created");
  } else {
    logger.info("[migration 033] audit_scanned_users table already exists, skipping");
  }

  // Record migration
  recordMigration(db, "033", "audit_sessions");

  logger.info("[migration 033] Complete");
}
