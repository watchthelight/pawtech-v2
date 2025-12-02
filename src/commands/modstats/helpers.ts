/**
 * Pawtropolis Tech -- src/commands/modstats/helpers.ts
 * WHAT: Helper functions for moderator statistics calculations.
 * WHY: Provides time formatting and database query utilities for modstats.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../../db/db.js";

/**
 * Actions that count as "decisions" for moderator metrics.
 *
 * Why modmail_open is included: Opening a modmail thread is a deliberate choice
 * to engage with an applicant rather than immediately approve/reject. It represents
 * active work even though it's not a terminal decision. Excluding it would
 * undercount moderators who do a lot of applicant communication.
 *
 * perm_reject vs reject: Both count equally for stats, but perm_reject prevents
 * the user from ever re-applying. The distinction matters for user lifecycle,
 * not moderator workload measurement.
 */
export const DECISION_ACTIONS = ["approve", "reject", "perm_reject", "kick", "modmail_open"];

/**
 * WHAT: Format duration in seconds as human-readable string.
 * WHY: Consistent time formatting for avg claim→decision displays.
 * FORMAT: "Xm" if < 1h, else "Hh Mm"
 *
 * @param seconds - Duration in seconds (null/undefined/negative → "—")
 * @returns Formatted duration string
 * @example
 * formatDuration(840) // "14m"
 * formatDuration(4320) // "1h 12m"
 * formatDuration(null) // "—"
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) {
    return "—";
  }

  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (hours === 0) {
    return `${mins}m`;
  }

  return `${hours}h ${mins}m`;
}

/**
 * WHAT: Calculate average claim→decision time for a moderator.
 * WHY: Key performance metric for review speed and moderator efficiency.
 * HOW: Uses CTE with self-join to compute average in a single query.
 *      Before: N+1 queries (1 + N decisions = 50-750 queries per moderator)
 *      After: 1 query per moderator
 *
 * @param guildId - Guild ID
 * @param actorId - Moderator user ID
 * @param windowStartS - Start of time window (unix seconds)
 * @returns Average seconds from claim to decision, or null if no data
 */
export function getAvgClaimToDecision(
  guildId: string,
  actorId: string,
  windowStartS: number
): number | null {
  // Single query using CTEs to join decisions with their most recent prior claim
  // This replaces the N+1 pattern where we queried for each decision's claim separately
  const result = db
    .prepare(
      `
      WITH decisions AS (
        SELECT app_id, created_at_s as decision_time
        FROM action_log
        WHERE guild_id = ? AND actor_id = ?
          AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
          AND created_at_s >= ?
          AND app_id IS NOT NULL
      ),
      claims AS (
        SELECT app_id, MAX(created_at_s) as claim_time
        FROM action_log
        WHERE guild_id = ? AND actor_id = ? AND action = 'claim'
        GROUP BY app_id
      )
      SELECT AVG(d.decision_time - c.claim_time) as avg_time
      FROM decisions d
      INNER JOIN claims c ON d.app_id = c.app_id
      WHERE c.claim_time < d.decision_time
    `
    )
    .get(guildId, actorId, windowStartS, guildId, actorId) as { avg_time: number | null };

  if (result?.avg_time === null || result?.avg_time === undefined) {
    return null;
  }

  // Return average time in seconds (floor to avoid fractional seconds)
  return Math.floor(result.avg_time);
}

/**
 * WHAT: Calculate server average submit→first claim time.
 * WHY: Context metric for understanding review queue responsiveness.
 * HOW: Uses CTE with self-join to compute average in a single query.
 *      Before: N+1 queries (1 + N submissions = 100+ queries)
 *      After: 1 query total
 *
 * @param guildId - Guild ID
 * @param windowStartS - Start of time window (unix seconds)
 * @returns Average seconds from submit to first claim, or null if no data
 */
export function getAvgSubmitToFirstClaim(guildId: string, windowStartS: number): number | null {
  // Single query using CTEs to join submissions with their first claim
  // This replaces the N+1 pattern where we queried for each submission's claim separately
  const result = db
    .prepare(
      `
      WITH submissions AS (
        SELECT app_id, created_at_s as submit_time
        FROM action_log
        WHERE guild_id = ? AND action = 'app_submitted' AND created_at_s >= ?
          AND app_id IS NOT NULL
      ),
      first_claims AS (
        SELECT app_id, MIN(created_at_s) as claim_time
        FROM action_log
        WHERE guild_id = ? AND action = 'claim'
        GROUP BY app_id
      )
      SELECT AVG(c.claim_time - s.submit_time) as avg_time
      FROM submissions s
      INNER JOIN first_claims c ON s.app_id = c.app_id
      WHERE c.claim_time > s.submit_time
    `
    )
    .get(guildId, windowStartS, guildId) as { avg_time: number | null };

  if (result?.avg_time === null || result?.avg_time === undefined) {
    return null;
  }

  return Math.floor(result.avg_time);
}
