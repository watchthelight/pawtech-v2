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
export function getActionCountsByMod(opts: QueryOptions): ActionCount[] {
  const start = Date.now();

  try {
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
    sql += `
      AND ra.created_at = (
        SELECT MAX(ra2.created_at)
        FROM review_action ra2
        WHERE ra2.app_id = ra.app_id
          AND ra2.action IN ('approve', 'reject', 'perm_reject')
      )
      ORDER BY lead_time_sec ASC
    `;

    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Array<{ lead_time_sec: number }>;

    if (rows.length === 0) {
      return { p50: 0, p90: 0, mean: 0, n: 0 };
    }

    // Calculate statistics
    const leadTimes = rows.map((r) => r.lead_time_sec);
    const n = leadTimes.length;
    const sum = leadTimes.reduce((acc, val) => acc + val, 0);
    const mean = Math.round(sum / n);

    // Percentiles (using nearest-rank method)
    const p50Index = Math.ceil(0.5 * n) - 1;
    const p90Index = Math.ceil(0.9 * n) - 1;
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
      reason: r.normalized_reason,
      count: r.count,
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
export function getVolumeSeries(opts: QueryOptions & { bucket?: "day" | "week" }): VolumeBucket[] {
  const start = Date.now();
  const bucket = opts.bucket || "day";
  const bucketSec = bucket === "day" ? 86400 : 604800; // 1 day or 7 days

  try {
    // Default to last 7 days if not specified
    const to = opts.to || nowUtc();
    const from = opts.from || to - 7 * 86400;

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
export function getOpenQueueAge(guildId: string): QueueAgeStats {
  const start = Date.now();

  try {
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
    const max_age_sec = ages[ages.length - 1]; // Already sorted ASC

    // p50 (median)
    const p50Index = Math.ceil(0.5 * count) - 1;
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
