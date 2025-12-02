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

    // Index for fast lookup
    db.exec(`CREATE INDEX idx_audit_scanned_session ON audit_scanned_users(session_id)`);

    logger.info("[migration 033] audit_scanned_users table created");
  } else {
    logger.info("[migration 033] audit_scanned_users table already exists, skipping");
  }

  // Record migration
  recordMigration(db, "033", "audit_sessions");

  logger.info("[migration 033] Complete");
}
