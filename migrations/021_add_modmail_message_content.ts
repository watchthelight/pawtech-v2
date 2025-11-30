/**
 * Migration 021: Add content column to modmail_message table
 * WHAT: Adds a content column to persist message text for transcripts
 * WHY: The in-memory transcriptBuffers Map is lost on bot restart, causing
 *      "No transcript content" errors even when messages were exchanged
 * FIX: Store message content in database so it survives restarts
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate021AddModmailMessageContent(db: Database): void {
  logger.info("[migration 021] Starting: add content column to modmail_message");

  // Check if column already exists
  const columns = db.prepare("PRAGMA table_info(modmail_message)").all() as Array<{ name: string }>;
  const hasContent = columns.some((col) => col.name === "content");

  if (hasContent) {
    logger.info("[migration 021] content column already exists, skipping");
    // Record migration
    recordMigration(db, "021", "add_modmail_message_content");
    logger.info("[migration 021] ✅ Complete");
    return;
  }

  // Add content column (nullable TEXT for backwards compatibility)
  db.exec(`
    ALTER TABLE modmail_message ADD COLUMN content TEXT;
  `);

  logger.info("[migration 021] Added content column to modmail_message");

  // Record migration
  recordMigration(db, "021", "add_modmail_message_content");

  logger.info("[migration 021] ✅ Complete");
  logger.info("[migration 021] 💡 Existing messages will have NULL content; new messages will be persisted");
}
