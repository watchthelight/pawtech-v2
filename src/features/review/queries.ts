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
import type { ApplicationRow, ApplicationStatus } from "./types.js";

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

// ===== Application Queries =====

/**
 * loadApplication
 * WHAT: Fetch an application by ID.
 * WHY: Core query used throughout review flows.
 * @param appId - The application ID
 * @returns ApplicationRow or undefined if not found
 */
export function loadApplication(appId: string): ApplicationRow | undefined {
  return db
    .prepare(
      `
    SELECT id, guild_id, user_id, status
    FROM application
    WHERE id = ?
  `
    )
    .get(appId) as ApplicationRow | undefined;
}

/**
 * findPendingAppByUserId
 * WHAT: Finds a pending (submitted or needs_info) application for a user in a guild.
 * WHY: Enables UID-based targeting for /accept and /reject slash commands.
 * @param guildId - The guild ID
 * @param userId - The user ID
 * @returns ApplicationRow or null if not found
 */
export function findPendingAppByUserId(guildId: string, userId: string): ApplicationRow | null {
  return db
    .prepare(
      `
    SELECT id, guild_id, user_id, status
    FROM application
    WHERE guild_id = ? AND user_id = ? AND status IN ('submitted', 'needs_info')
    ORDER BY created_at DESC
    LIMIT 1
  `
    )
    .get(guildId, userId) as ApplicationRow | null;
}

/**
 * updateReviewActionMeta
 * WHAT: Update the meta JSON field on a review_action row.
 * WHY: Store additional context (dmDelivered, roleApplied, etc.) for auditing.
 * @param id - The review_action row ID
 * @param meta - JSON-serializable object
 */
export function updateReviewActionMeta(id: number, meta: unknown) {
  db.prepare(`UPDATE review_action SET meta = json(?) WHERE id = ?`).run(JSON.stringify(meta), id);
}

/**
 * isClaimable
 * WHAT: Helper to determine if an application is in a claimable state.
 * WHY: Prevents claim attempts on terminal states (kicked, approved, rejected).
 * @param status - The application status
 * @returns true if the application can be claimed
 */
export function isClaimable(status: ApplicationStatus): boolean {
  return status === "submitted" || status === "needs_info";
}

/**
 * WHAT: Fetch recent review actions for an application.
 * WHY: Display action history on review card to reduce tab-switching for mods.
 * RETURNS: Array of recent actions, ordered newest first.
 * PERF: Uses idx_review_action_app_time (app_id, created_at DESC).
 */
// Fetches last N actions for display on review card history section.
// Index: idx_review_action_app_time (app_id, created_at DESC) makes this O(log n) + limit reads.
// Default limit=4 keeps the card compact while showing recent activity.
// Timing is logged for performance monitoring - if this gets slow, check index health.
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
  // Info-level log for query observability. If this shows up taking >10ms consistently,
  // the index may be missing or fragmented.
  logger.info(
    { query: "getRecentActionsForApp", appId, limit, n: rows.length, ms },
    "[review] history_fetch"
  );

  return rows;
}
