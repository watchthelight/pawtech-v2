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
 * HOW: Joins claim actions with decision actions on same app_id + actor_id,
 *      then computes AVG(decision.created_at_s - claim.created_at_s).
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
  // For each decision by this moderator in the window:
  // 1. Find the most recent claim by same moderator for that app_id before the decision
  // 2. Compute delta (decision.created_at_s - claim.created_at_s)
  // 3. Average all deltas

  const decisions = db
    .prepare(
      `
      SELECT app_id, created_at_s
      FROM action_log
      WHERE guild_id = ?
        AND actor_id = ?
        AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
        AND created_at_s >= ?
        AND app_id IS NOT NULL
      ORDER BY created_at_s ASC
    `
    )
    .all(guildId, actorId, windowStartS) as Array<{
    app_id: string;
    created_at_s: number;
  }>;

  if (decisions.length === 0) {
    return null;
  }

  const deltas: number[] = [];

  for (const decision of decisions) {
    // Find most recent claim by same moderator for this app before decision
    const claim = db
      .prepare(
        `
        SELECT created_at_s
        FROM action_log
        WHERE guild_id = ?
          AND app_id = ?
          AND actor_id = ?
          AND action = 'claim'
          AND created_at_s < ?
        ORDER BY created_at_s DESC
        LIMIT 1
      `
      )
      .get(guildId, decision.app_id, actorId, decision.created_at_s) as
      | { created_at_s: number }
      | undefined;

    if (claim) {
      const delta = decision.created_at_s - claim.created_at_s;
      // Only count positive deltas (sanity check: decision should come after claim)
      if (delta > 0) {
        deltas.push(delta);
      }
    }
    // Note: If no claim found, this decision is skipped (e.g., unclaimed app decisions)
  }

  if (deltas.length === 0) {
    return null;
  }

  // Return average time in seconds (floor to avoid fractional seconds)
  return Math.floor(deltas.reduce((sum, d) => sum + d, 0) / deltas.length);
}

/**
 * WHAT: Calculate server average submit→first claim time.
 * WHY: Context metric for understanding review queue responsiveness.
 * HOW: For each app_submitted action, find earliest claim (by ANY moderator),
 *      then compute AVG(first_claim.created_at_s - submit.created_at_s).
 *
 * @param guildId - Guild ID
 * @param windowStartS - Start of time window (unix seconds)
 * @returns Average seconds from submit to first claim, or null if no data
 */
export function getAvgSubmitToFirstClaim(guildId: string, windowStartS: number): number | null {
  // For each app_submitted in window:
  // 1. Find earliest claim for that app_id
  // 2. Compute delta (claim.created_at_s - submit.created_at_s)
  // 3. Average all deltas

  const submissions = db
    .prepare(
      `
      SELECT app_id, created_at_s
      FROM action_log
      WHERE guild_id = ?
        AND action = 'app_submitted'
        AND created_at_s >= ?
        AND app_id IS NOT NULL
      ORDER BY created_at_s ASC
    `
    )
    .all(guildId, windowStartS) as Array<{
    app_id: string;
    created_at_s: number;
  }>;

  if (submissions.length === 0) {
    return null;
  }

  const deltas: number[] = [];

  for (const submission of submissions) {
    // Find earliest claim for this app
    const claim = db
      .prepare(
        `
        SELECT created_at_s
        FROM action_log
        WHERE guild_id = ?
          AND app_id = ?
          AND action = 'claim'
          AND created_at_s >= ?
        ORDER BY created_at_s ASC
        LIMIT 1
      `
      )
      .get(guildId, submission.app_id, submission.created_at_s) as
      | { created_at_s: number }
      | undefined;

    if (claim) {
      const delta = claim.created_at_s - submission.created_at_s;
      if (delta > 0) {
        deltas.push(delta);
      }
    }
  }

  if (deltas.length === 0) {
    return null;
  }

  return Math.floor(deltas.reduce((sum, d) => sum + d, 0) / deltas.length);
}
