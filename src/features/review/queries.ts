/**
 * Pawtropolis Tech — src/features/review/queries.ts
 * WHAT: Query helpers for review card data (action history, claims, etc.).
 * WHY: Centralize prepared statements for review card rendering and analytics.
 * FLOWS: Fetch recent actions, moderator info, claim status for display.
 * DOCS:
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";

/**
 * WHAT: Row structure for recent review actions.
 * WHY: Type-safe results from getRecentActionsForApp query.
 */
export type RecentAction = {
  action: string;
  moderator_id: string;
  reason: string | null;
  created_at: number; // Unix epoch seconds
};

/**
 * WHAT: Fetch recent review actions for an application.
 * WHY: Display action history on review card to reduce tab-switching for mods.
 * RETURNS: Array of recent actions, ordered newest first.
 * PERF: Uses idx_review_action_app_time (app_id, created_at DESC).
 */
export function getRecentActionsForApp(appId: string, limit = 4): RecentAction[] {
  const start = Date.now();

  const stmt = db.prepare(`
    SELECT action, moderator_id, reason, created_at
    FROM review_action
    WHERE app_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(appId, limit) as RecentAction[];

  const ms = Date.now() - start;
  logger.info(
    { query: "getRecentActionsForApp", appId, limit, n: rows.length, ms },
    "[review] history_fetch"
  );

  return rows;
}
