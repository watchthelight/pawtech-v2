/**
 * Pawtropolis Tech — migrations/012_add_db_backups_table.ts
 * WHAT: Create db_backups metadata table for tracking backup candidates
 * WHY: Enable safe, auditable database recovery with backup validation & metadata
 * HOW: CREATE TABLE db_backups if not exists with integrity check metadata
 *
 * SAFETY:
 *  - Idempotent: CREATE TABLE IF NOT EXISTS
 *  - Additive: no changes to existing tables
 *  - Indexed: created_at and checksum for efficient queries
 *
 * BACKFILL:
 *  - After running migration, populate table via: npm run db:scan-backups
 *  - See scripts/scan-db-backups.ts
 *
 * ROLLBACK:
 *  - To remove: DROP TABLE db_backups;
 *  - Warning: loses backup metadata history (safe - backups themselves untouched)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { enableForeignKeys, tableExists } from "./lib/helpers.js";

/**
 * Migration: Create db_backups metadata table
 *
 * Schema:
 *   id: INTEGER PRIMARY KEY
 *   path: TEXT UNIQUE - absolute or relative path to backup file
 *   created_at: INTEGER - file mtime (epoch seconds)
 *   size_bytes: INTEGER - file size in bytes
 *   integrity_result: TEXT - output from PRAGMA integrity_check (ok/errors)
 *   row_count: INTEGER - sum of row counts from sampled tables
 *   checksum: TEXT - SHA256 hash of backup file
 *   verified_at: INTEGER NULL - last validation timestamp (epoch seconds)
 *   notes: TEXT NULL - human notes (e.g., "pre-restore backup from 2025-10-30")
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate012AddDbBackupsTable(db: Database): void {
  logger.info("[migration 012] Starting: create db_backups table");

  enableForeignKeys(db);

  if (!tableExists(db, "db_backups")) {
    logger.info("[migration 012] Creating db_backups table");

    db.prepare(
      `CREATE TABLE db_backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        integrity_result TEXT,
        row_count INTEGER,
        checksum TEXT,
        verified_at INTEGER,
        notes TEXT
      )`
    ).run();

    // Indexes for common queries
    db.prepare(`CREATE INDEX idx_db_backups_created_at ON db_backups(created_at DESC)`).run();
    db.prepare(`CREATE INDEX idx_db_backups_checksum ON db_backups(checksum)`).run();

    logger.info("[migration 012] ✓ Created db_backups table with indexes");
  } else {
    logger.info("[migration 012] db_backups table already exists, skipping");
  }

  logger.info("[migration 012] ✅ Complete");
  logger.info("[migration 012] 💡 Run `npm run db:scan-backups` to populate metadata");
}
