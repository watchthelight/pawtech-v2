/**
 * Pawtropolis Tech — migrations/035_drop_unused_tables.ts
 * WHAT: Drop unused database tables that have 0 rows and no code references
 * WHY: Clean up dead code - tables never implemented or superseded
 * TABLES:
 *  - ping_log: Legacy ping tracking (unused)
 *  - dm_bridge: Old DM bridging (superseded by modmail_bridge)
 *  - suggestion: Suggestion system (never implemented)
 *  - suggestion_vote: Suggestion voting (never implemented)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration, enableForeignKeys } from "./lib/helpers.js";

export function migrate035DropUnusedTables(db: Database): void {
  logger.info("[migration 035] Starting: drop unused tables");

  enableForeignKeys(db);

  // Tables to drop - all have 0 rows and no code references
  const tables = ["ping_log", "dm_bridge", "suggestion", "suggestion_vote"];

  for (const table of tables) {
    // Verify table is empty before dropping (safety check)
    try {
      const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
      if (count.count > 0) {
        throw new Error(`Table ${table} has ${count.count} rows - aborting drop`);
      }
    } catch (err: any) {
      // Table might not exist, which is fine
      if (!err.message?.includes("no such table")) {
        throw err;
      }
    }
  }

  // Drop tables in correct order (FK child first)
  db.prepare("DROP TABLE IF EXISTS suggestion_vote").run();
  db.prepare("DROP TABLE IF EXISTS suggestion").run();
  db.prepare("DROP TABLE IF EXISTS dm_bridge").run();
  db.prepare("DROP TABLE IF EXISTS ping_log").run();

  logger.info("[migration 035] Dropped unused tables: ping_log, dm_bridge, suggestion, suggestion_vote");

  recordMigration(db, "035", "drop_unused_tables");
  logger.info("[migration 035] Complete");
}
