/**
 * Migration 024: Add review_action index for app_id + created_at
 * WHAT: Creates composite index on review_action table
 * WHY: Speeds up review action history queries ordered by time
 * IMPACT: 2-5x speedup on review card history sections
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate024ReviewActionIndex(db: Database): void {
  logger.info("[migration 024] Starting: add review_action index");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_review_action_app_time
      ON review_action(app_id, created_at DESC);
  `);

  logger.info("[migration 024] Created idx_review_action_app_time");

  // Record migration
  recordMigration(db, "024", "review_action_index");

  logger.info("[migration 024] Complete");
}
