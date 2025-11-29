/**
 * Pawtropolis Tech -- src/features/analytics/approvalRate.ts
 * WHAT: Query functions for approval rate analytics.
 * WHY: Provides server-wide approval/rejection/kick/perm_reject rates with trend comparison.
 * FLOWS:
 *  - getApprovalRateStats -> action counts for a given period
 *  - getApprovalRateTrend -> compares current period to previous period
 *  - getTopRejectionReasons -> most common rejection reasons
 * DOCS:
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3
 *
 * NOTE: All timestamps are Unix epoch seconds (INTEGER).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";

export type ApprovalRateStats = {
  total: number;
  approvals: number;
  rejections: number;
  kicks: number;
  permRejects: number;
  approvalPct: number;
  rejectionPct: number;
  kickPct: number;
  permRejectPct: number;
};

export type ApprovalRateTrend = {
  current: ApprovalRateStats;
  previous: ApprovalRateStats;
  approvalRateDelta: number; // positive = improving, negative = declining
  trendDirection: "up" | "down" | "stable";
};

export type RejectionReason = {
  reason: string;
  count: number;
  percentage: number;
};

type QueryOptions = {
  guildId: string;
  from: number;
  to: number;
};

/**
 * getApprovalRateStats
 * WHAT: Counts actions grouped by type for a given time period.
 * WHY: Shows approval/rejection/kick/perm_reject breakdown.
 * HOW: Queries review_action table filtered by guild and time window.
 *
 * @param opts - Query options (guildId, from, to)
 * @returns ApprovalRateStats with counts and percentages
 */
export function getApprovalRateStats(opts: QueryOptions): ApprovalRateStats {
  const start = Date.now();

  try {
    // Query counts for each action type within the time window
    // The JOIN with application is needed to filter by guild_id since review_action
    // only has app_id, not guild_id directly.
    const sql = `
      SELECT
        COUNT(*) FILTER (WHERE ra.action = 'approve') as approvals,
        COUNT(*) FILTER (WHERE ra.action = 'reject') as rejections,
        COUNT(*) FILTER (WHERE ra.action = 'kick') as kicks,
        COUNT(*) FILTER (WHERE ra.action = 'perm_reject') as perm_rejects,
        COUNT(*) as total
      FROM review_action ra
      INNER JOIN application a ON ra.app_id = a.id
      WHERE a.guild_id = ?
        AND ra.action IN ('approve', 'reject', 'kick', 'perm_reject')
        AND ra.created_at >= ?
        AND ra.created_at <= ?
    `;

    const row = db.prepare(sql).get(opts.guildId, opts.from, opts.to) as {
      approvals: number;
      rejections: number;
      kicks: number;
      perm_rejects: number;
      total: number;
    } | undefined;

    const total = row?.total ?? 0;
    const approvals = row?.approvals ?? 0;
    const rejections = row?.rejections ?? 0;
    const kicks = row?.kicks ?? 0;
    const permRejects = row?.perm_rejects ?? 0;

    // Calculate percentages (avoid division by zero)
    const approvalPct = total > 0 ? (approvals / total) * 100 : 0;
    const rejectionPct = total > 0 ? (rejections / total) * 100 : 0;
    const kickPct = total > 0 ? (kicks / total) * 100 : 0;
    const permRejectPct = total > 0 ? (permRejects / total) * 100 : 0;

    const elapsed = Date.now() - start;
    logger.info(
      {
        query: "getApprovalRateStats",
        ms: elapsed,
        from: opts.from,
        to: opts.to,
        guild: opts.guildId,
        total,
        approvals,
        rejections,
        kicks,
        permRejects,
      },
      "[analytics] approval rate query completed"
    );

    return {
      total,
      approvals,
      rejections,
      kicks,
      permRejects,
      approvalPct,
      rejectionPct,
      kickPct,
      permRejectPct,
    };
  } catch (err) {
    logger.error({ err, opts }, "[analytics] getApprovalRateStats failed");
    throw err;
  }
}

/**
 * getApprovalRateTrend
 * WHAT: Compares approval rates between current and previous periods.
 * WHY: Shows if moderation standards are changing over time.
 * HOW: Queries stats for both periods and calculates delta.
 *
 * @param opts - Query options for current period
 * @returns ApprovalRateTrend with current, previous stats and trend direction
 */
export function getApprovalRateTrend(opts: QueryOptions): ApprovalRateTrend {
  const start = Date.now();

  try {
    // Calculate previous period window (same duration, immediately before)
    const periodDuration = opts.to - opts.from;
    const previousFrom = opts.from - periodDuration;
    const previousTo = opts.from - 1; // End 1 second before current period starts

    // Get stats for both periods
    const current = getApprovalRateStats(opts);
    const previous = getApprovalRateStats({
      guildId: opts.guildId,
      from: previousFrom,
      to: previousTo,
    });

    // Calculate delta (positive = improvement in approval rate)
    const approvalRateDelta = current.approvalPct - previous.approvalPct;

    // Determine trend direction (stable if within 1% change)
    let trendDirection: "up" | "down" | "stable";
    if (Math.abs(approvalRateDelta) < 1) {
      trendDirection = "stable";
    } else if (approvalRateDelta > 0) {
      trendDirection = "up";
    } else {
      trendDirection = "down";
    }

    const elapsed = Date.now() - start;
    logger.info(
      {
        query: "getApprovalRateTrend",
        ms: elapsed,
        guild: opts.guildId,
        currentPct: current.approvalPct,
        previousPct: previous.approvalPct,
        delta: approvalRateDelta,
        trend: trendDirection,
      },
      "[analytics] approval rate trend completed"
    );

    return {
      current,
      previous,
      approvalRateDelta,
      trendDirection,
    };
  } catch (err) {
    logger.error({ err, opts }, "[analytics] getApprovalRateTrend failed");
    throw err;
  }
}

/**
 * getTopRejectionReasons
 * WHAT: Returns most common rejection reasons with percentages.
 * WHY: Helps identify patterns in rejections.
 * HOW: Aggregates reasons from review_action where action is reject/kick/perm_reject.
 *
 * @param opts - Query options (guildId, from, to)
 * @param limit - Maximum number of reasons to return (default 5)
 * @returns Array of RejectionReason sorted by count descending
 */
export function getTopRejectionReasons(
  opts: QueryOptions,
  limit: number = 5
): RejectionReason[] {
  const start = Date.now();

  try {
    // Normalize reasons: lowercase, trim whitespace, collapse newlines
    // This groups similar reasons together (e.g., "Too young" and "too young")
    const sql = `
      SELECT
        LOWER(TRIM(REPLACE(REPLACE(ra.reason, CHAR(10), ' '), '  ', ' '))) as normalized_reason,
        COUNT(*) as count
      FROM review_action ra
      INNER JOIN application a ON ra.app_id = a.id
      WHERE a.guild_id = ?
        AND ra.action IN ('reject', 'kick', 'perm_reject')
        AND ra.created_at >= ?
        AND ra.created_at <= ?
        AND ra.reason IS NOT NULL
        AND TRIM(ra.reason) != ''
      GROUP BY normalized_reason
      HAVING normalized_reason IS NOT NULL AND normalized_reason != ''
      ORDER BY count DESC
      LIMIT ?
    `;

    const rows = db.prepare(sql).all(opts.guildId, opts.from, opts.to, limit) as Array<{
      normalized_reason: string;
      count: number;
    }>;

    // Calculate total rejections for percentage calculation
    const totalRejections = rows.reduce((sum, r) => sum + r.count, 0);

    const results: RejectionReason[] = rows.map((r) => ({
      reason: r.normalized_reason || "Unknown",
      count: r.count,
      percentage: totalRejections > 0 ? (r.count / totalRejections) * 100 : 0,
    }));

    const elapsed = Date.now() - start;
    logger.info(
      {
        query: "getTopRejectionReasons",
        ms: elapsed,
        guild: opts.guildId,
        from: opts.from,
        to: opts.to,
        resultCount: results.length,
      },
      "[analytics] top rejection reasons completed"
    );

    return results;
  } catch (err) {
    logger.error({ err, opts }, "[analytics] getTopRejectionReasons failed");
    throw err;
  }
}
