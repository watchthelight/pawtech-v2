/**
 * Pawtropolis Tech — src/features/analytics/queries.ts
 * WHAT: Pure query functions for reviewer analytics.
 * WHY: Provides insight into moderator activity, review velocity, and queue health.
 * FLOWS:
 *  - getActionCountsByMod → per-moderator action breakdown
 *  - getLeadTimeStats → review velocity (p50/p90/mean)
 *  - getTopReasons → most common rejection reasons
 *  - getVolumeSeries → time-bucketed action volumes
 *  - getOpenQueueAge → pending application age distribution
 * DOCS:
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3
 *  - Percentile calculation: https://en.wikipedia.org/wiki/Percentile
 *
 * NOTE: All timestamps are Unix epoch seconds (INTEGER). All queries use prepared statements.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { nowUtc } from "../../lib/time.js";

// All query options are optional, which means every function needs to handle
// the "give me everything" case. This is intentional - cross-guild queries are
// a valid use case for bot owners doing aggregate analytics.
export type QueryOptions = {
  guildId?: string;
  from?: number;
  to?: number;
};

export type ActionCount = {
  moderator_id: string;
  action: string;
  count: number;
};

export type LeadTimeStats = {
  p50: number;
  p90: number;
  mean: number;
  n: number;
};

export type ReasonCount = {
  reason: string;
  count: number;
};

export type VolumeBucket = {
  t0: number;
  t1: number;
  total: number;
  approvals: number;
  rejects: number;
  permrejects: number;
};

export type QueueAgeStats = {
  count: number;
  max_age_sec: number;
  p50_age_sec: number;
};

/**
 * getActionCountsByMod
 * WHAT: Counts actions grouped by moderator and action type.
 * WHY: Shows which mods are most active and what actions they take.
 * HOW: Joins review_action with application to filter by guild; groups by moderator_id and action.
 *
 * @param opts - Query options (guildId, from, to)
 * @returns Array of { moderator_id, action, count }
 */
/*
 * GOTCHA: This function builds SQL dynamically. Yes, I know what you're thinking.
 * No, it's not vulnerable - all user input goes through parameterized queries.
 * The only dynamic parts are table/column names which are hardcoded strings.
 * Still makes me nervous every time I look at it though.
 */
export function getActionCountsByMod(opts: QueryOptions): ActionCount[] {
  const start = Date.now();

  try {
    // Dynamic SQL construction for optional guild filter. The JOIN is only added when
    // guildId is specified to avoid the join overhead for cross-guild queries.
    // Performance note: This query benefits from an index on review_action(created_at)
    // and application(guild_id) when filtering. Consider composite index if slow.
    let sql = `
      SELECT
        ra.moderator_id,
        ra.action,
        COUNT(*) as count
      FROM review_action ra
    `;

    const conditions: string[] = [];
    const params: any[] = [];

    // Join with application if we need to filter by guild
    // The join is relatively cheap because app_id is indexed as a foreign key
    if (opts.guildId) {
      sql += ` INNER JOIN application a ON ra.app_id = a.id`;
      conditions.push(`a.guild_id = ?`);
      params.push(opts.guildId);
    }

    // Time filters
    if (opts.from !== undefined) {
      conditions.push(`ra.created_at >= ?`);
      params.push(opts.from);
    }
    if (opts.to !== undefined) {
      conditions.push(`ra.created_at <= ?`);
      params.push(opts.to);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    sql += ` GROUP BY ra.moderator_id, ra.action ORDER BY count DESC`;

    // Preparing statements on every call is fine for analytics - these queries run
    // maybe a few times per day. If this ever becomes a hot path (it won't), consider
    // pre-compiling the fixed variants and picking the right one at runtime.
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as ActionCount[];

    const elapsed = Date.now() - start;
    logger.info(
      {
        query: "getActionCountsByMod",
        ms: elapsed,
        from: opts.from,
        to: opts.to,
        guild: opts.guildId || "all",
        resultCount: rows.length,
      },
      "[analytics] query completed"
    );

    return rows;
  } catch (err) {
    logger.error({ err, opts }, "[analytics] getActionCountsByMod failed");
    throw err;
  }
}

/**
 * getLeadTimeStats
 * WHAT: Calculates review lead time statistics (p50, p90, mean).
 * WHY: Measures how quickly moderators process applications.
 * HOW: Finds terminal decisions (approve/reject/permreject), calculates time from app creation to decision.
 *
 * Lead time = final_decision.created_at - application.created_at
 *
 * @param opts - Query options (guildId, from, to)
 * @returns { p50, p90, mean, n } in seconds
 */
export function getLeadTimeStats(opts: QueryOptions): LeadTimeStats {
  const start = Date.now();

  try {
    // Get lead times for all terminal decisions
    let sql = `
      SELECT
        (ra.created_at - a.created_at) as lead_time_sec
      FROM review_action ra
      INNER JOIN application a ON ra.app_id = a.id
      WHERE ra.action IN ('approve', 'reject', 'perm_reject')
    `;

    const conditions: string[] = [];
    const params: any[] = [];

    if (opts.guildId) {
      conditions.push(`a.guild_id = ?`);
      params.push(opts.guildId);
    }

    if (opts.from !== undefined) {
      conditions.push(`ra.created_at >= ?`);
      params.push(opts.from);
    }

    if (opts.to !== undefined) {
      conditions.push(`ra.created_at <= ?`);
      params.push(opts.to);
    }

    if (conditions.length > 0) {
      sql += ` AND ${conditions.join(" AND ")}`;
    }

    // Only get the latest terminal decision per app
    // This correlated subquery ensures we only count one decision per application.
    // Without this, apps with multiple reject->approve cycles would skew the stats.
    // The ORDER BY lead_time_sec ASC is required for accurate percentile calculation
    // using the nearest-rank method below.
    sql += `
      AND ra.created_at = (
        SELECT MAX(ra2.created_at)
        FROM review_action ra2
        WHERE ra2.app_id = ra.app_id
          AND ra2.action IN ('approve', 'reject', 'perm_reject')
      )
      ORDER BY lead_time_sec ASC
    `;
    // This correlated subquery is O(n*m) in the worst case, but review_action is small
    // enough that it doesn't matter. Famous last words, I know.

    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Array<{ lead_time_sec: number }>;

    if (rows.length === 0) {
      return { p50: 0, p90: 0, mean: 0, n: 0 };
    }

    // Calculate statistics
    // We compute these in JS rather than SQL because SQLite lacks percentile functions
    // and the dataset is typically small enough (thousands of rows) that this is fine.
    // WHY JS instead of a SQLite extension? Because adding native extensions to SQLite
    // is a deployment nightmare, and the percentile-of-1000-rows cost is basically free.
    const leadTimes = rows.map((r) => r.lead_time_sec);
    const n = leadTimes.length;
    const sum = leadTimes.reduce((acc, val) => acc + val, 0);
    const mean = n > 0 ? Math.round(sum / n) : 0;

    // Percentiles (using nearest-rank method)
    // This is simpler than interpolation and good enough for our analytics purposes.
    // At small n, the difference between methods is negligible anyway.
    //
    // The Math.max(0, Math.min(...)) dance is defensive programming against array bounds.
    // Could probably just use leadTimes[Math.floor(n * 0.5)] but I've been burned before.
    const p50Index = Math.max(0, Math.min(Math.ceil(0.5 * n) - 1, n - 1));
    const p90Index = Math.max(0, Math.min(Math.ceil(0.9 * n) - 1, n - 1));
    const p50 = leadTimes[p50Index];
    const p90 = leadTimes[p90Index];

    const elapsed = Date.now() - start;
    logger.info(
      {
        query: "getLeadTimeStats",
        ms: elapsed,
        from: opts.from,
        to: opts.to,
        guild: opts.guildId || "all",
        n,
        p50,
        p90,
        mean,
      },
      "[analytics] query completed"
    );

    return { p50, p90, mean, n };
  } catch (err) {
    logger.error({ err, opts }, "[analytics] getLeadTimeStats failed");
    throw err;
  }
}

/**
 * getTopReasons
 * WHAT: Returns most common rejection reasons.
 * WHY: Helps identify patterns in rejections (e.g., incomplete answers, age requirements).
 * HOW: Aggregates reject/perm_reject actions, normalizes reasons, counts occurrences.
 *
 * Normalization: LOWER(TRIM(reason)), replace newlines with spaces, collapse multiple spaces.
 *
 * @param opts - Query options (guildId, from, to, limit)
 * @returns Array of { reason, count } sorted by count descending
 */
export function getTopReasons(opts: QueryOptions & { limit?: number }): ReasonCount[] {
  const start = Date.now();
  const limit = opts.limit || 10;

  try {
    // Normalization: lowercase, trim whitespace, collapse newlines and multiple spaces.
    // This groups "Too young" and "too young" and "too  young\n" as the same reason.
    // The REPLACE chain is ugly but SQLite doesn't have regex replace.
    // Known limitation: Only collapses double-spaces once; "too   young" becomes "too  young".
    // Not worth fixing since it's rare and the results are still readable.
    //
    // Yes, this normalization is duplicated in approvalRate.ts. No, I haven't extracted it
    // into a shared constant. The SQL snippets are slightly different and abstracting SQL
    // fragments tends to make things worse, not better.
    let sql = `
      SELECT
        LOWER(TRIM(REPLACE(REPLACE(reason, CHAR(10), ' '), '  ', ' '))) as normalized_reason,
        COUNT(*) as count
      FROM review_action ra
    `;

    const conditions: string[] = [`ra.action IN ('reject', 'perm_reject')`];
    const params: any[] = [];

    // Join with application if filtering by guild
    if (opts.guildId) {
      sql += ` INNER JOIN application a ON ra.app_id = a.id`;
      conditions.push(`a.guild_id = ?`);
      params.push(opts.guildId);
    }

    // Time filters
    if (opts.from !== undefined) {
      conditions.push(`ra.created_at >= ?`);
      params.push(opts.from);
    }
    if (opts.to !== undefined) {
      conditions.push(`ra.created_at <= ?`);
      params.push(opts.to);
    }

    // Exclude NULL/empty reasons
    conditions.push(`ra.reason IS NOT NULL`);
    conditions.push(`TRIM(ra.reason) != ''`);

    sql += ` WHERE ${conditions.join(" AND ")}`;
    sql += ` GROUP BY normalized_reason`;
    sql += ` HAVING normalized_reason IS NOT NULL AND normalized_reason != ''`;
    // Secondary sort by reason name so results are deterministic when counts tie.
    // Without this, pagination would be unreliable if we ever added it.
    sql += ` ORDER BY count DESC, normalized_reason ASC`;
    sql += ` LIMIT ?`;

    params.push(limit);

    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      normalized_reason: string;
      count: number;
    }>;

    // Map to output format
    const results = rows.map((r) => ({
      reason: r.normalized_reason || '',
      count: typeof r.count === 'number' ? r.count : 0,
    }));

    const elapsed = Date.now() - start;
    logger.info(
      {
        query: "getTopReasons",
        ms: elapsed,
        from: opts.from,
        to: opts.to,
        guild: opts.guildId || "all",
        resultCount: results.length,
      },
      "[analytics] query completed"
    );

    return results;
  } catch (err) {
    logger.error({ err, opts }, "[analytics] getTopReasons failed");
    throw err;
  }
}

/**
 * getVolumeSeries
 * WHAT: Returns time-bucketed action counts.
 * WHY: Shows trends in moderation activity over time.
 * HOW: Truncates timestamps to day/week boundaries, aggregates actions per bucket.
 *
 * Bucket boundaries are inclusive [t0, t1).
 * Default window: last 7 days if from/to not specified.
 *
 * @param opts - Query options (guildId, from, to, bucket)
 * @returns Array of { t0, t1, total, approvals, rejects, permrejects }
 */
// "day" | "week" only - no "month" option because months have variable lengths
// and someone will inevitably file a bug when February looks different from March.
export function getVolumeSeries(opts: QueryOptions & { bucket?: "day" | "week" }): VolumeBucket[] {
  const start = Date.now();
  const bucket = opts.bucket || "day";
  const bucketSec = bucket === "day" ? 86400 : 604800; // 1 day or 7 days

  try {
    // Default to last 7 days if not specified
    const to = opts.to || nowUtc();
    const from = opts.from || to - 7 * 86400;

    // Time-bucket aggregation using integer division trick: (ts / bucket) * bucket
    // This truncates timestamps to bucket boundaries (midnight UTC for days).
    // Note: This uses server timezone (UTC assumed). If you need local timezone bucketing,
    // you'd need to offset timestamps before division, which gets complicated.
    //
    // EDGE CASE: If an action happens at exactly midnight UTC (bucket boundary), it lands
    // in the new bucket. This is the intuitive behavior but occasionally confuses people
    // doing audits who expect "today's stats" to include that midnight action.
    let sql = `
      SELECT
        (ra.created_at / ${bucketSec}) * ${bucketSec} as bucket_start,
        COUNT(*) as total,
        SUM(CASE WHEN ra.action = 'approve' THEN 1 ELSE 0 END) as approvals,
        SUM(CASE WHEN ra.action = 'reject' THEN 1 ELSE 0 END) as rejects,
        SUM(CASE WHEN ra.action = 'perm_reject' THEN 1 ELSE 0 END) as permrejects
      FROM review_action ra
    `;

    const conditions: string[] = [];
    const params: any[] = [];

    // Join with application if filtering by guild
    if (opts.guildId) {
      sql += ` INNER JOIN application a ON ra.app_id = a.id`;
      conditions.push(`a.guild_id = ?`);
      params.push(opts.guildId);
    }

    // Time filters (inclusive)
    conditions.push(`ra.created_at >= ?`);
    params.push(from);
    conditions.push(`ra.created_at <= ?`);
    params.push(to);

    sql += ` WHERE ${conditions.join(" AND ")}`;
    sql += ` GROUP BY bucket_start ORDER BY bucket_start ASC`;

    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      bucket_start: number;
      total: number;
      approvals: number;
      rejects: number;
      permrejects: number;
    }>;

    // Map to output format with bucket boundaries
    const results = rows.map((r) => ({
      t0: r.bucket_start,
      t1: r.bucket_start + bucketSec,
      total: r.total,
      approvals: r.approvals,
      rejects: r.rejects,
      permrejects: r.permrejects,
    }));

    const elapsed = Date.now() - start;
    logger.info(
      {
        query: "getVolumeSeries",
        ms: elapsed,
        from,
        to,
        guild: opts.guildId || "all",
        bucket,
        resultCount: results.length,
      },
      "[analytics] query completed"
    );

    return results;
  } catch (err) {
    logger.error({ err, opts }, "[analytics] getVolumeSeries failed");
    throw err;
  }
}

/**
 * getOpenQueueAge
 * WHAT: Returns age distribution for pending applications.
 * WHY: Helps identify backlog and SLA risks.
 * HOW: Calculates age for all applications with status = 'submitted' or 'needs_info'.
 *
 * Age = now - application.created_at
 *
 * @param guildId - Guild ID to filter (required for queue stats)
 * @returns { count, max_age_sec, p50_age_sec }
 */
// Unlike the other functions, this one requires guildId. Cross-guild queue stats
// don't make sense - each guild has its own backlog and SLA expectations.
export function getOpenQueueAge(guildId: string): QueueAgeStats {
  const start = Date.now();

  try {
    // Embed current timestamp directly in query rather than using datetime('now')
    // because we want consistent age calculations across all rows and with our JS code.
    // The status filter includes 'needs_info' because those are still "open" from a
    // workload perspective - they need moderator attention eventually.
    const now = nowUtc();

    const sql = `
      SELECT
        (${now} - created_at) as age_sec
      FROM application
      WHERE guild_id = ?
        AND status IN ('submitted', 'needs_info')
      ORDER BY age_sec ASC
    `;

    const stmt = db.prepare(sql);
    const rows = stmt.all(guildId) as Array<{ age_sec: number }>;

    if (rows.length === 0) {
      return { count: 0, max_age_sec: 0, p50_age_sec: 0 };
    }

    const ages = rows.map((r) => r.age_sec);
    const count = ages.length;
    // Query orders ASC, so last element is oldest (max age)
    const max_age_sec = ages[ages.length - 1];

    // p50 (median)
    const p50Index = Math.max(0, Math.min(Math.ceil(0.5 * count) - 1, count - 1));
    const p50_age_sec = ages[p50Index];

    const elapsed = Date.now() - start;
    logger.info(
      {
        query: "getOpenQueueAge",
        ms: elapsed,
        guild: guildId,
        count,
        max_age_sec,
        p50_age_sec,
      },
      "[analytics] query completed"
    );

    return { count, max_age_sec, p50_age_sec };
  } catch (err) {
    logger.error({ err, guildId }, "[analytics] getOpenQueueAge failed");
    throw err;
  }
}
