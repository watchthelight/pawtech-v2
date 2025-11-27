/**
 * Migration 022: Add transcript index for app_id + ts
 * WHAT: Creates composite index on transcript table
 * WHY: Speeds up transcript retrieval by app_id with timestamp ordering
 * IMPACT: 10-100x speedup on transcript retrieval
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";

export function migrate022TranscriptIndex(db: Database): void {
  logger.info("[migration 022] Starting: add transcript index");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_transcript_app_ts ON transcript(app_id, ts);
  `);

  logger.info("[migration 022] Created idx_transcript_app_ts");
  logger.info("[migration 022] Complete");
}
