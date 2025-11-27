/**
 * Pawtropolis Tech -- src/lib/syncMarker.ts
 * WHAT: Sync marker tracking for intelligent local/remote database switching.
 * WHY: Provides reliable freshness detection using monotonic action counter.
 * FLOWS:
 *  - touchSyncMarker(): Called on key database mutations to update marker
 *  - getSyncMarker(): Retrieves current marker for comparison
 * DOCS:
 *  - Used by start.cmd --switch to determine which database is fresher
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { BOT_LOCATION } from "./env.js";

export interface SyncMarker {
  id: number;
  last_modified_at: number;
  last_modified_by: string;
  action_count: number;
  last_action_type: string | null;
  updated_at: string;
}

const touchStmt = db.prepare(`
  UPDATE sync_marker
  SET last_modified_at = strftime('%s', 'now'),
      last_modified_by = ?,
      action_count = action_count + 1,
      last_action_type = COALESCE(?, last_action_type),
      updated_at = datetime('now')
  WHERE id = 1
`);

const getStmt = db.prepare(`
  SELECT * FROM sync_marker WHERE id = 1
`);

/**
 * Updates the sync marker to indicate a database mutation occurred.
 * Call this on key write operations (applications, reviews, modmail, config).
 *
 * @param actionType - Optional action type for debugging (e.g., 'review_action', 'application')
 */
export function touchSyncMarker(actionType?: string): void {
  try {
    touchStmt.run(BOT_LOCATION, actionType ?? null);
  } catch {
    // Silently ignore if table doesn't exist yet (first startup before migration)
  }
}

/**
 * Retrieves the current sync marker for comparison.
 * Used by start.cmd --switch to determine database freshness.
 */
export function getSyncMarker(): SyncMarker | null {
  try {
    return getStmt.get() as SyncMarker | null;
  } catch {
    return null;
  }
}
