/**
 * Pawtropolis Tech — migrations/038_add_critical_indexes.ts
 * WHAT: Add critical indexes flagged by database health check.
 * WHY: Performance optimization for common query patterns.
 *
 * SAFETY:
 *  - Idempotent: uses CREATE INDEX IF NOT EXISTS
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate038AddCriticalIndexes(db: Database): void {
  logger.info("[migration 038] Starting: add critical indexes");

  // For application queries filtered by guild + status, sorted by created_at
  // Used heavily in /review queue, application search, and stale alert checks
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_application_guild_status_created
    ON application(guild_id, status, created_at)
  `).run();

  // For modmail ticket lookups by guild and status
  // Common query: "find all open tickets in this guild"
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_modmail_ticket_guild_status
    ON modmail_ticket(guild_id, status)
  `).run();

  recordMigration(db, "038", "add_critical_indexes");
  logger.info("[migration 038] Complete");
}
