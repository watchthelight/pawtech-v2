/**
 * Migration 026: Sync Marker Table
 *
 * Creates a singleton table to track database freshness for intelligent
 * local/remote switching. The action_count provides a monotonic counter
 * that reliably indicates which database has more recent changes.
 */
import type Database from "better-sqlite3";

export function migrate026SyncMarker(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_marker (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_modified_at INTEGER NOT NULL,
      last_modified_by TEXT NOT NULL,
      action_count INTEGER NOT NULL DEFAULT 0,
      last_action_type TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO sync_marker (id, last_modified_at, last_modified_by, action_count)
    VALUES (1, strftime('%s', 'now'), 'unknown', 0);
  `);
}
