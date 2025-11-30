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
import { LRUCache } from "../lib/lruCache.js";

/**
 * Actions performed by moderators (never by applicants).
 * This set is the source of truth for what counts as "mod activity."
 * If you add new mod actions to action_log, remember to add them here too
 * or they won't show up in performance metrics.
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
 * LRU cache for metrics (guild_id -> metrics[]) with TTL and bounded size.
 * TTL defaults to 5 minutes. This is a deliberate tradeoff: recalculating
 * metrics is expensive (full action_log scan), so we accept slightly stale
 * data for /modstats responses. For real-time needs, use forceRefresh=true.
 * Max 1000 guilds cached to prevent unbounded memory growth.
 */
// Env var override for testing. In prod this stays at 5 minutes.
const _getTTL = () => Number(process.env.MOD_METRICS_TTL_MS ?? 5 * 60 * 1000);
const CACHE_MAX_SIZE = 1000; // Max guilds to cache - prevents unbounded memory growth

// Note: We create the cache lazily to allow _getTTL() to pick up env vars set during test setup.
// The TTL is evaluated at cache creation time, not at each access.
let _metricsCache: LRUCache<string, ModMetrics[]> | null = null;

function getMetricsCache(): LRUCache<string, ModMetrics[]> {
  if (!_metricsCache) {
    _metricsCache = new LRUCache<string, ModMetrics[]>(CACHE_MAX_SIZE, _getTTL());
  }
  return _metricsCache;
}

/**
 * WHAT: Clear metrics cache (test-only).
 * WHY: Ensure test isolation without cache pollution.
 */
export function __test__clearModMetricsCache(): void {
  if (_metricsCache) {
    _metricsCache.clear();
  }
  // Reset the cache instance so TTL changes take effect on next access
  _metricsCache = null;
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

  // Copy array to avoid mutating input - important since we sort in place
  const sorted = [...values].sort((a, b) => a - b);

  // Using nearest-rank method (not linear interpolation). This means:
  // - Always returns an actual value from the dataset
  // - p50 of [1,2,3,4] returns 2, not 2.5
  // - Simpler to reason about for non-statisticians reading dashboards
  const rank = Math.ceil((percentile / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));

  return sorted[index];
}

/**
 * WHAT: Compute all response times from action_log in a single query
 * WHY: Avoids N+1 query pattern - fetches all data once, computes in memory
 * HOW: Groups actions by app_id, finds app_submitted + first mod action pairs
 *
 * @param guildId - Discord guild ID
 * @param epochFilter - Epoch filter predicate from getEpochPredicate
 * @returns Map of moderator_id -> array of response times in seconds
 */
function computeAllResponseTimes(
  guildId: string,
  epochFilter: { sql: string; params: unknown[] }
): Map<string, number[]> {
  const responseTimesByMod = new Map<string, number[]>();

  try {
    const modActionsPlaceholders = Array.from(MOD_ACTIONS)
      .map(() => "?")
      .join(",");

    // Single query for all app_submitted and mod action events
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

    // Group by app_id to find app_submitted -> first mod action pairs
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

    // Calculate response times (app_submitted -> first mod action)
    for (const [appId, events] of appGroups) {
      // Handle resubmissions: only measure from the LATEST submission
      const submissions = events.filter((e) => e.action === "app_submitted");
      if (submissions.length === 0) continue;
      const latestSubmission = submissions[submissions.length - 1];

      // Find first mod action AFTER latest submission
      const firstModAction = events.find(
        (e) => e.time > latestSubmission.time && MOD_ACTIONS.has(e.action)
      );

      if (firstModAction) {
        const responseTime = firstModAction.time - latestSubmission.time;
        // Sanity bounds: negative times are clock skew bugs, >7 days is
        // probably orphaned data that would skew percentiles badly.
        if (responseTime > 0 && responseTime < 86400 * 7) {
          const modId = firstModAction.actor_id;
          if (!responseTimesByMod.has(modId)) {
            responseTimesByMod.set(modId, []);
          }
          responseTimesByMod.get(modId)!.push(responseTime);
        }
      }
    }

    return responseTimesByMod;
  } catch (err) {
    logger.error({ err, guildId }, "[metrics] failed to compute all response times");
    return responseTimesByMod;
  }
}

/**
 * WHAT: Recalculate and persist moderator metrics for a guild.
 * WHY: Updates mod_metrics table with fresh counts and percentiles.
 * HOW: Batched approach (3 queries instead of 300+):
 *  1. Single query for all action counts grouped by actor_id
 *  2. Single query for all response time data, computed in memory
 *  3. Batch UPSERT in a transaction
 *
 * PERF: 100x speedup for guilds with 100 moderators (300 queries -> 3 queries)
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

    const modActionsList = Array.from(MOD_ACTIONS)
      .map(() => "?")
      .join(",");

    // STEP 1: Single query for all action counts grouped by actor_id
    let allCounts: Array<{
      actor_id: string;
      claims: number;
      accepts: number;
      rejects: number;
      kicks: number;
      modmail_opens: number;
    }>;
    try {
      allCounts = db
        .prepare(
          `
          SELECT
            actor_id,
            SUM(CASE WHEN action = 'claim' THEN 1 ELSE 0 END) as claims,
            SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) as accepts,
            SUM(CASE WHEN action = 'reject' THEN 1 ELSE 0 END) as rejects,
            SUM(CASE WHEN action = 'kick' THEN 1 ELSE 0 END) as kicks,
            SUM(CASE WHEN action = 'modmail_open' THEN 1 ELSE 0 END) as modmail_opens
          FROM action_log
          WHERE guild_id = ? AND action IN (${modActionsList})
            ${epochFilter.sql}
          GROUP BY actor_id
        `
        )
        .all(guildId, ...Array.from(MOD_ACTIONS), ...epochFilter.params) as typeof allCounts;
    } catch (err) {
      logger.error({ err, guildId }, "[metrics] failed to query all action counts");
      throw err;
    }

    if (allCounts.length === 0) {
      logger.info({ guildId }, "[metrics] no actions found for guild");
      return 0;
    }

    // STEP 2: Single query for all response time data, computed in memory
    const responseTimesByMod = computeAllResponseTimes(guildId, epochFilter);

    // Build metrics for each moderator
    const now = new Date().toISOString();
    const metrics: Array<{
      moderatorId: string;
      claims: number;
      accepts: number;
      rejects: number;
      kicks: number;
      modmail_opens: number;
      avgResponseTime: number | null;
      p50: number | null;
      p95: number | null;
    }> = [];

    for (const counts of allCounts) {
      const responseTimes = responseTimesByMod.get(counts.actor_id) || [];
      responseTimes.sort((a, b) => a - b);

      const avgResponseTime =
        responseTimes.length > 0
          ? responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length
          : null;

      const p50 = calculatePercentile(responseTimes, 50);
      const p95 = calculatePercentile(responseTimes, 95);

      metrics.push({
        moderatorId: counts.actor_id,
        claims: counts.claims || 0,
        accepts: counts.accepts || 0,
        rejects: counts.rejects || 0,
        kicks: counts.kicks || 0,
        modmail_opens: counts.modmail_opens || 0,
        avgResponseTime,
        p50,
        p95,
      });
    }

    // STEP 3: Batch UPSERT in a transaction
    let processed = 0;
    try {
      db.transaction(() => {
        const stmt = db.prepare(
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
        );

        for (const m of metrics) {
          stmt.run(
            m.moderatorId,
            guildId,
            m.claims,
            m.accepts,
            m.rejects,
            m.kicks,
            m.modmail_opens,
            m.avgResponseTime,
            m.p50,
            m.p95,
            now
          );
          processed++;
        }
      })();
    } catch (err) {
      logger.error({ err, guildId }, "[metrics] failed to batch upsert mod_metrics");
      throw err;
    }

    // Invalidate cache after DB writes complete. This ordering matters:
    // if we cleared cache first, a concurrent read could re-populate with
    // stale data before our writes finish.
    getMetricsCache().delete(guildId);

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
  const cache = getMetricsCache();
  const cached = cache.get(guildId);

  // Check cache validity. Note: no locking here, so two concurrent calls
  // with a stale cache will both trigger recalc. That's fine - recalc is
  // idempotent and the minor duplicate work beats adding lock complexity.
  // LRUCache.get() already handles TTL expiration internally.
  if (!forceRefresh && cached) {
    logger.debug({ guildId }, "[metrics] cache hit");
    return cached;
  }

  logger.debug({ guildId, reason: forceRefresh ? "forced" : "stale" }, "[metrics] cache miss");

  // Recalc writes to DB, then we read back. This ensures we return exactly
  // what's persisted, not some intermediate state.
  await recalcModMetrics(guildId);

  let metrics: ModMetrics[];
  try {
    metrics = db
      .prepare(
        `
      SELECT * FROM mod_metrics WHERE guild_id = ?
    `
      )
      .all(guildId) as ModMetrics[];
  } catch (err) {
    logger.error({ err, guildId }, "[metrics] failed to query metrics after recalc");
    throw err;
  }

  // Update cache
  cache.set(guildId, metrics);

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

  // In-memory sort is fine here - typical guild has <100 mods.
  // If you somehow have thousands of mods, push sort to SQL.
  const sorted = [...allMetrics].sort((a, b) => {
    switch (sortBy) {
      case "accepts":
        return b.total_accepts - a.total_accepts;
      case "claims":
        return b.total_claims - a.total_claims;
      case "response_time":
        // Lower response time is better. Mods with no response data (null)
        // go to the bottom - they either have no claims or data predates tracking.
        if (a.avg_response_time_s === null) return 1;
        if (b.avg_response_time_s === null) return -1;
        return a.avg_response_time_s - b.avg_response_time_s;
      default:
        return 0;
    }
  });

  return sorted.slice(0, limit);
}
