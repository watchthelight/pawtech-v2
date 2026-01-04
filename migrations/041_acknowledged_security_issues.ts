/**
 * Pawtropolis Tech — migrations/041_acknowledged_security_issues.ts
 * WHAT: Create acknowledged_security_issues table
 * WHY: Track staff acknowledgments of security audit warnings that are intentional
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
import { tableExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/*
 * CONTEXT: The /audit security command generates warnings about permission issues.
 * Some warnings are intentional (e.g., chat reviver role needs MentionEveryone).
 * This table lets staff acknowledge warnings so they don't keep appearing as new issues.
 *
 * The permission_hash field enables auto-reset: if someone changes the role/channel
 * permissions, the hash changes and the acknowledgment is invalidated, forcing re-review.
 */

/**
 * Migration: Create acknowledged_security_issues table
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate041AcknowledgedSecurityIssues(db: Database): void {
  logger.info("[migration 041] Starting: create acknowledged_security_issues table");

  enableForeignKeys(db);

  if (!tableExists(db, "acknowledged_security_issues")) {
    logger.info("[migration 041] Creating acknowledged_security_issues table");

    /*
     * issue_key is a stable identifier for the issue, unlike the ephemeral CRIT-001 IDs.
     * Format: "role:{roleId}:{checkType}" or "channel:{channelId}:{checkType}"
     * Examples: "role:123456789:admin", "channel:987654321:sensitive"
     *
     * permission_hash is a short hash of the relevant permissions at acknowledgment time.
     * If this changes between audits, the acknowledgment is considered stale.
     *
     * severity and title are snapshots for historical reference - the issue may
     * change severity in future code updates, but we want to show what was acknowledged.
     */
    db.exec(`
      CREATE TABLE acknowledged_security_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        issue_key TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        permission_hash TEXT NOT NULL,
        acknowledged_by TEXT NOT NULL,
        acknowledged_at INTEGER NOT NULL,
        reason TEXT,
        UNIQUE(guild_id, issue_key)
      )
    `);

    // Index for fast lookup by guild
    db.exec(`CREATE INDEX idx_ack_security_guild ON acknowledged_security_issues(guild_id)`);

    logger.info("[migration 041] acknowledged_security_issues table created");
  } else {
    logger.info("[migration 041] acknowledged_security_issues table already exists, skipping");
  }

  recordMigration(db, "041", "acknowledged_security_issues");

  logger.info("[migration 041] Complete");
}
