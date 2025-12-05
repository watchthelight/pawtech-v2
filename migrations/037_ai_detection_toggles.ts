/**
 * Pawtropolis Tech — migrations/037_ai_detection_toggles.ts
 * WHAT: Stores per-guild toggle state for AI detection APIs.
 * WHY: Allow admins to disable APIs that aren't working or aren't paid for.
 *
 * SAFETY:
 *  - Idempotent: checks for table existence before creating
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, recordMigration } from "./lib/helpers.js";

/**
 * Migration: Add AI detection toggles table
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate037AiDetectionToggles(db: Database): void {
  logger.info("[migration 037] Starting: AI detection toggles");

  if (!tableExists(db, "ai_detection_toggles")) {
    logger.info("[migration 037] Creating ai_detection_toggles table");
    db.exec(`
      CREATE TABLE ai_detection_toggles (
        guild_id TEXT NOT NULL,
        service TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (guild_id, service)
      )
    `);
    logger.info("[migration 037] ai_detection_toggles table created");
  } else {
    logger.info("[migration 037] ai_detection_toggles already exists, skipping");
  }

  recordMigration(db, "037", "ai_detection_toggles");
  logger.info("[migration 037] Complete");
}
