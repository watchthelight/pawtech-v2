/**
 * Pawtropolis Tech — src/features/modPerformance.ts
 * WHAT: Moderator performance analytics engine with caching and percentile computation.
 * WHY: Powers /modstats command and dashboard metrics without expensive real-time queries.
 * FLOWS:
 *  - recalcModMetrics(guildId) → compute stats from action_log → write to mod_metrics
 *  - getCachedMetrics(guildId) → read from mod_metrics or trigger recalc
 * DOCS:
 *  - Percentile calculation: https://en.wikipedia.org/wiki/Percentile
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { getEpochPredicate } from "./metricsEpoch.js";

/**
 * Actions performed by moderators (never by applicants)
 */
export const MOD_ACTIONS = new Set([
  "claim",
  "approve",
  "reject",
  "perm_reject",
  "kick",
  "modmail_open",
  "modmail_close",
]);

/**
 * Actions performed by applicants (not moderators)
 */
export const APPLICANT_ACTIONS = new Set(["app_submitted"]);

/**
 * Moderator metrics shape
 */
export interface ModMetrics {
  moderator_id: string;
  guild_id: string;
  total_claims: number;
  total_accepts: number;
  total_rejects: number;
  total_kicks: number;
  total_modmail_opens: number;
  avg_response_time_s: number | null;
  p50_response_time_s: number | null;
  p95_response_time_s: number | null;
  updated_at: string;
}

/**
 * Action pair for response time calculation (claim → accept/reject)
 */
interface ActionPair {
  claim_time: number;
  resolution_time: number;
  response_time_s: number;
}

/**
 * In-memory cache for metrics (guild_id → metrics[])
 * Cache TTL: 5 minutes (auto-refresh on access if stale)
 */
const _metricsCache = new Map<string, { metrics: ModMetrics[]; timestamp: number }>();
const _getTTL = () => Number(process.env.MOD_METRICS_TTL_MS ?? 5 * 60 * 1000);

/**
 * WHAT: Clear metrics cache (test-only).
 * WHY: Ensure test isolation without cache pollution.
 */
export function __test__clearModMetricsCache(): void {
  _metricsCache.clear();
}

/**
 * WHAT: Calculate percentile from array using nearest-rank method.
 * WHY: Deterministic percentile computation for response time analytics.
 * METHOD: Nearest-rank (always picks existing value, no interpolation).
 *
 * @param values - Array of numbers (will be copied and sorted)
 * @param percentile - Percentile to calculate (0-100)
 * @returns Percentile value or null if array empty
 * @example
 * calculatePercentile([5, 1, 3, 2, 4], 50) // Returns 3 (median)
 */
function calculatePercentile(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;

  // Copy array to avoid mutating input
  const sorted = [...values].sort((a, b) => a - b);

  // Nearest-rank method: p ∈ (0, 100]
  const rank = Math.ceil((percentile / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));

  return sorted[index];
}

/**
 * WHAT: Compute response times for app_submitted → first mod action pairs.
 * WHY: Measures how quickly moderators respond to new applications.
 * HOW: Groups actions by app_id, finds app_submitted + first mod action pairs, calculates delta.
 *      Attributes response time to the moderator who performed the FIRST action, not just who claimed.
 *
 * @param guildId - Discord guild ID
 * @param moderatorId - Discord moderator user ID to filter results for
 * @returns Array of response time measurements attributed to this moderator
 */
function computeResponseTimes(guildId: string, moderatorId: string): number[] {
  try {
    // Get epoch filtering predicate
    const epochFilter = getEpochPredicate(guildId, "created_at_s");

    // Query ALL actions for this guild's applications (app_submitted + all mod actions)
    const modActionsPlaceholders = Array.from(MOD_ACTIONS)
      .map(() => "?")
      .join(",");
    const actions = db
      .prepare(
        `
      SELECT action, app_id, actor_id, created_at_s
      FROM action_log
      WHERE guild_id = ?
        AND app_id IS NOT NULL
        AND (action = 'app_submitted' OR action IN (${modActionsPlaceholders}))
        ${epochFilter.sql}
      ORDER BY app_id, created_at_s ASC
    `
      )
      .all(guildId, ...Array.from(MOD_ACTIONS), ...epochFilter.params) as Array<{
      action: string;
      app_id: string;
      actor_id: string;
      created_at_s: number;
    }>;

    // Group by app_id to find app_submitted → first mod action pairs
    const appGroups = new Map<string, Array<{ action: string; actor_id: string; time: number }>>();

    for (const row of actions) {
      if (!appGroups.has(row.app_id)) {
        appGroups.set(row.app_id, []);
      }

      appGroups.get(row.app_id)!.push({
        action: row.action,
        actor_id: row.actor_id,
        time: row.created_at_s,
      });
    }

    // Calculate response times (app_submitted → first mod action)
    const responseTimes: number[] = [];

    for (const [appId, events] of appGroups) {
      // Find latest app_submitted (in case of resubmissions)
      const submissions = events.filter((e) => e.action === "app_submitted");
      if (submissions.length === 0) continue;
      const latestSubmission = submissions[submissions.length - 1];

      // Find first mod action AFTER latest submission
      const firstModAction = events.find(
        (e) => e.time > latestSubmission.time && MOD_ACTIONS.has(e.action)
      );

      // Only count if THIS moderator was the first responder
      if (firstModAction && firstModAction.actor_id === moderatorId) {
        const responseTime = firstModAction.time - latestSubmission.time;
        if (responseTime > 0 && responseTime < 86400 * 7) {
          // Sanity check: 0 < time < 7 days
          responseTimes.push(responseTime);
        }
      }
    }

    return responseTimes;
  } catch (err) {
    logger.error({ err, guildId, moderatorId }, "[metrics] failed to compute response times");
    return [];
  }
}

/**
 * WHAT: Recalculate and persist moderator metrics for a guild.
 * WHY: Updates mod_metrics table with fresh counts and percentiles.
 * HOW:
 *  1. Query action_log grouped by actor_id
 *  2. Compute counts (claims, accepts, rejects, etc.)
 *  3. Calculate response time percentiles (p50, p95)
 *  4. UPSERT into mod_metrics table
 *
 * @param guildId - Discord guild ID
 * @returns Number of moderators processed
 * @example
 * await recalcModMetrics('896070888594759740');
 */
export async function recalcModMetrics(guildId: string): Promise<number> {
  try {
    logger.info({ guildId }, "[metrics] starting recalculation");

    // Get epoch filtering predicate
    const epochFilter = getEpochPredicate(guildId, "created_at_s");

    // Query action_log for all moderators in this guild (only MOD_ACTIONS, not applicants)
    const modActionsList = Array.from(MOD_ACTIONS)
      .map(() => "?")
      .join(",");
    const moderators = db
      .prepare(
        `
      SELECT DISTINCT actor_id
      FROM action_log
      WHERE guild_id = ?
        AND action IN (${modActionsList})
        ${epochFilter.sql}
    `
      )
      .all(guildId, ...Array.from(MOD_ACTIONS), ...epochFilter.params) as Array<{
      actor_id: string;
    }>;

    if (moderators.length === 0) {
      logger.info({ guildId }, "[metrics] no actions found for guild");
      return 0;
    }

    const now = new Date().toISOString();
    let processed = 0;

    for (const { actor_id: moderatorId } of moderators) {
      try {
        // Count actions by type (only MOD_ACTIONS, filtered by epoch)
        const counts = db
          .prepare(
            `
          SELECT
            SUM(CASE WHEN action = 'claim' THEN 1 ELSE 0 END) as claims,
            SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) as accepts,
            SUM(CASE WHEN action = 'reject' THEN 1 ELSE 0 END) as rejects,
            SUM(CASE WHEN action = 'kick' THEN 1 ELSE 0 END) as kicks,
            SUM(CASE WHEN action = 'modmail_open' THEN 1 ELSE 0 END) as modmail_opens
          FROM action_log
          WHERE guild_id = ? AND actor_id = ? AND action IN (${modActionsList})
            ${epochFilter.sql}
        `
          )
          .get(guildId, moderatorId, ...Array.from(MOD_ACTIONS), ...epochFilter.params) as {
          claims: number;
          accepts: number;
          rejects: number;
          kicks: number;
          modmail_opens: number;
        };

        // Compute response times
        const responseTimes = computeResponseTimes(guildId, moderatorId);
        responseTimes.sort((a, b) => a - b); // Sort for percentile calculation

        const avgResponseTime =
          responseTimes.length > 0
            ? responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length
            : null;

        const p50 = calculatePercentile(responseTimes, 50);
        const p95 = calculatePercentile(responseTimes, 95);

        // UPSERT into mod_metrics
        db.prepare(
          `
          INSERT INTO mod_metrics (
            moderator_id, guild_id,
            total_claims, total_accepts, total_rejects, total_kicks, total_modmail_opens,
            avg_response_time_s, p50_response_time_s, p95_response_time_s,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(moderator_id, guild_id) DO UPDATE SET
            total_claims = excluded.total_claims,
            total_accepts = excluded.total_accepts,
            total_rejects = excluded.total_rejects,
            total_kicks = excluded.total_kicks,
            total_modmail_opens = excluded.total_modmail_opens,
            avg_response_time_s = excluded.avg_response_time_s,
            p50_response_time_s = excluded.p50_response_time_s,
            p95_response_time_s = excluded.p95_response_time_s,
            updated_at = excluded.updated_at
        `
        ).run(
          moderatorId,
          guildId,
          counts.claims || 0,
          counts.accepts || 0,
          counts.rejects || 0,
          counts.kicks || 0,
          counts.modmail_opens || 0,
          avgResponseTime,
          p50,
          p95,
          now
        );

        processed++;
      } catch (err) {
        logger.error({ err, guildId, moderatorId }, "[metrics] failed to process moderator");
      }
    }

    // Invalidate cache
    _metricsCache.delete(guildId);

    logger.info({ guildId, processed }, "[metrics] recalculation complete");
    return processed;
  } catch (err) {
    logger.error({ err, guildId }, "[metrics] recalculation failed");
    throw err;
  }
}

/**
 * WHAT: Get cached metrics for a guild (with auto-refresh if stale).
 * WHY: Fast reads for /modstats command and dashboard API.
 * HOW: Checks cache → if stale, triggers recalc → returns metrics.
 *
 * @param guildId - Discord guild ID
 * @param forceRefresh - Skip cache and force recalculation
 * @returns Array of moderator metrics
 * @example
 * const metrics = await getCachedMetrics('896070888594759740');
 */
export async function getCachedMetrics(
  guildId: string,
  forceRefresh = false
): Promise<ModMetrics[]> {
  const cached = _metricsCache.get(guildId);
  const now = Date.now();
  const ttl = _getTTL();

  // Check cache validity
  if (!forceRefresh && cached && now - cached.timestamp < ttl) {
    logger.debug({ guildId, age: now - cached.timestamp }, "[metrics] cache hit");
    return cached.metrics;
  }

  // Cache miss or stale - recalculate
  logger.debug({ guildId, reason: forceRefresh ? "forced" : "stale" }, "[metrics] cache miss");

  await recalcModMetrics(guildId);

  // Read from database
  const metrics = db
    .prepare(
      `
    SELECT * FROM mod_metrics WHERE guild_id = ?
  `
    )
    .all(guildId) as ModMetrics[];

  // Update cache
  _metricsCache.set(guildId, { metrics, timestamp: now });

  return metrics;
}

/**
 * WHAT: Get metrics for a specific moderator.
 * WHY: Powers /modstats user mode for personal summaries.
 *
 * @param guildId - Discord guild ID
 * @param moderatorId - Discord moderator user ID
 * @returns Moderator metrics or null if not found
 */
export async function getModeratorMetrics(
  guildId: string,
  moderatorId: string
): Promise<ModMetrics | null> {
  const allMetrics = await getCachedMetrics(guildId);
  return allMetrics.find((m) => m.moderator_id === moderatorId) || null;
}

/**
 * WHAT: Get top moderators sorted by a metric.
 * WHY: Powers /modstats leaderboard mode.
 *
 * @param guildId - Discord guild ID
 * @param sortBy - Metric to sort by
 * @param limit - Max number of moderators to return
 * @returns Sorted array of moderator metrics
 */
export async function getTopModerators(
  guildId: string,
  sortBy: "accepts" | "claims" | "response_time" = "accepts",
  limit = 10
): Promise<ModMetrics[]> {
  const allMetrics = await getCachedMetrics(guildId);

  // Sort based on criteria
  const sorted = [...allMetrics].sort((a, b) => {
    switch (sortBy) {
      case "accepts":
        return b.total_accepts - a.total_accepts;
      case "claims":
        return b.total_claims - a.total_claims;
      case "response_time":
        // Lower response time is better (sort ascending, but nulls last)
        if (a.avg_response_time_s === null) return 1;
        if (b.avg_response_time_s === null) return -1;
        return a.avg_response_time_s - b.avg_response_time_s;
      default:
        return 0;
    }
  });

  return sorted.slice(0, limit);
}
