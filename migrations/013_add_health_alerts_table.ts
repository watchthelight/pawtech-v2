/**
 * Pawtropolis Tech — migrations/013_add_health_alerts_table.ts
 * WHAT: Create health_alerts table for ops health monitoring and alerting
 * WHY: Enable automated health checks with alert lifecycle (trigger, ack, resolve) + audit trail
 * HOW: CREATE TABLE health_alerts if not exists with timestamps and metadata
 *
 * SAFETY:
 *  - Idempotent: CREATE TABLE IF NOT EXISTS
 *  - Additive: no changes to existing tables
 *  - Indexed: triggered_at, alert_type, severity for efficient queries
 *
 * BACKFILL:
 *  - No backfill required - table starts empty and is populated by health checks
 *
 * ROLLBACK:
 *  - To remove: DROP TABLE health_alerts;
 *  - Warning: loses alert history (safe - logs remain in action_log)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { enableForeignKeys, tableExists, recordMigration } from "./lib/helpers.js";

/**
 * Migration: Create health_alerts table
 *
 * Schema:
 *   id: INTEGER PRIMARY KEY
 *   alert_type: TEXT - type of alert (queue_backlog, p95_high, ws_ping_high, pm2_stopped, db_integrity_fail)
 *   severity: TEXT - severity level (warn, critical)
 *   triggered_at: INTEGER - initial alert timestamp (epoch seconds)
 *   last_seen_at: INTEGER - most recent occurrence timestamp (epoch seconds)
 *   acknowledged_by: INTEGER NULL - Discord user ID who acknowledged
 *   acknowledged_at: INTEGER NULL - acknowledgement timestamp (epoch seconds)
 *   resolved_by: INTEGER NULL - Discord user ID who resolved
 *   resolved_at: INTEGER NULL - resolution timestamp (epoch seconds)
 *   meta: TEXT NULL - JSON metadata (threshold values, actual values, etc.)
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate013AddHealthAlertsTable(db: Database): void {
  logger.info("[migration 013] Starting: create health_alerts table");

  enableForeignKeys(db);

  if (!tableExists(db, "health_alerts")) {
    logger.info("[migration 013] Creating health_alerts table");

    db.prepare(
      `CREATE TABLE health_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        triggered_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        acknowledged_by TEXT,
        acknowledged_at INTEGER,
        resolved_by TEXT,
        resolved_at INTEGER,
        meta TEXT
      )`
    ).run();

    // Indexes for common queries
    db.prepare(`CREATE INDEX idx_health_alerts_triggered_at ON health_alerts(triggered_at DESC)`).run();
    db.prepare(`CREATE INDEX idx_health_alerts_type ON health_alerts(alert_type)`).run();
    db.prepare(`CREATE INDEX idx_health_alerts_severity ON health_alerts(severity)`).run();
    db.prepare(
      `CREATE INDEX idx_health_alerts_active ON health_alerts(resolved_at) WHERE resolved_at IS NULL`
    ).run();

    logger.info("[migration 013] ✓ Created health_alerts table with indexes");
  } else {
    logger.info("[migration 013] health_alerts table already exists, skipping");
  }

  // Record migration
  recordMigration(db, "013", "add_health_alerts_table");

  logger.info("[migration 013] ✅ Complete");
  logger.info("[migration 013] 💡 Health alerts will be populated automatically by scheduler");
}
