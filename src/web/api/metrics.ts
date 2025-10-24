/**
 * Pawtropolis Tech — src/web/api/metrics.ts
 * WHAT: API routes for moderator performance metrics and timeseries data.
 * WHY: Expose mod_metrics table and action_log timeseries to admin dashboard.
 * ROUTES:
 *  - GET /api/metrics → fetch moderator metrics
 *  - GET /api/metrics/timeseries → fetch action counts over time
 *  - GET /api/metrics/latency → fetch response time percentiles over time
 * DOCS:
 *  - Fastify routing: https://fastify.dev/docs/latest/Reference/Routes/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { logger } from "../../lib/logger.js";
import { verifySession } from "../auth.js";
import {
  getCachedMetrics,
  getModeratorMetrics,
  MOD_ACTIONS,
  APPLICANT_ACTIONS,
} from "../../features/modPerformance.js";
import { db } from "../../db/db.js";
import { getEpochPredicate } from "../../features/metricsEpoch.js";

/**
 * WHAT: Register metrics API routes.
 * WHY: Expose moderator performance data to admin dashboard.
 *
 * @param fastify - Fastify instance
 */
export async function registerMetricsRoutes(fastify: FastifyInstance) {
  // GET /api/metrics
  fastify.get(
    "/api/metrics",
    {
      preHandler: verifySession,
    },
    async (request, reply) => {
      const {
        guild_id,
        moderator_id,
        limit: limitParam,
      } = request.query as {
        guild_id?: string;
        moderator_id?: string;
        limit?: string;
      };

      try {
        // If moderator_id specified, return single moderator's metrics
        if (moderator_id) {
          if (!guild_id) {
            return reply
              .code(400)
              .send({ error: "guild_id required when filtering by moderator_id" });
          }

          const metrics = await getModeratorMetrics(guild_id, moderator_id);

          if (!metrics) {
            return reply.code(404).send({ error: "Moderator metrics not found" });
          }

          logger.debug({ guild_id, moderator_id }, "[api:metrics] served single moderator");

          return {
            metrics,
          };
        }

        // Otherwise, return all metrics for guild
        if (!guild_id) {
          return reply.code(400).send({ error: "guild_id required" });
        }

        const allMetrics = await getCachedMetrics(guild_id);

        // Apply limit if specified
        const limit = limitParam ? Math.min(parseInt(limitParam, 10), 500) : allMetrics.length;
        const items = allMetrics.slice(0, limit);

        logger.debug({ guild_id, count: items.length }, "[api:metrics] served metrics");

        return {
          items,
          count: items.length,
          limit,
        };
      } catch (err) {
        logger.error({ err }, "[api:metrics] failed to fetch metrics");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/metrics/timeseries
  fastify.get(
    "/api/metrics/timeseries",
    {
      preHandler: verifySession,
    },
    async (request, reply) => {
      const {
        guild_id,
        window = "30d",
        bucket: requestedBucket,
      } = request.query as {
        guild_id?: string;
        window?: string;
        bucket?: string;
      };

      if (!guild_id) {
        return reply.code(400).send({ error: "guild_id required" });
      }

      try {
        // Window sizes in milliseconds
        const windowMs: Record<string, number> = {
          "1d": 1 * 24 * 60 * 60 * 1000,
          "7d": 7 * 24 * 60 * 60 * 1000,
          "30d": 30 * 24 * 60 * 60 * 1000,
          "365d": 365 * 24 * 60 * 60 * 1000,
        };

        // Auto-select bucket size based on window
        const bucket = requestedBucket || (window === "1d" || window === "7d" ? "1h" : "1d");

        const endTime = Date.now();
        const startTime = endTime - (windowMs[window] || windowMs["30d"]);
        const startSec = Math.floor(startTime / 1000);
        const endSec = Math.floor(endTime / 1000);

        // Get epoch filter
        const epochFilter = getEpochPredicate(guild_id, "created_at_s");

        // Bucket format for SQLite
        const bucketFormat = bucket === "1h" ? "%Y-%m-%dT%H:00:00Z" : "%Y-%m-%dT00:00:00Z";

        // Query action_log with epoch filtering
        const rows = db
          .prepare(
            `
            SELECT
              strftime(?, datetime(created_at_s, 'unixepoch')) as bucket,
              action,
              COUNT(*) as count
            FROM action_log
            WHERE guild_id = ?
              AND created_at_s >= ?
              ${epochFilter.sql}
            GROUP BY bucket, action
            ORDER BY bucket
          `
          )
          .all(bucketFormat, guild_id, startSec, ...epochFilter.params) as Array<{
          bucket: string;
          action: string;
          count: number;
        }>;

        // Build map of actual data
        const dataMap = new Map<
          string,
          { submissions: number; mod_actions: Record<string, number> }
        >();

        for (const row of rows) {
          if (!dataMap.has(row.bucket)) {
            dataMap.set(row.bucket, { submissions: 0, mod_actions: {} });
          }

          const data = dataMap.get(row.bucket)!;

          if (APPLICANT_ACTIONS.has(row.action)) {
            data.submissions += row.count;
          } else if (MOD_ACTIONS.has(row.action)) {
            data.mod_actions[row.action] = (data.mod_actions[row.action] || 0) + row.count;
          }
        }

        // Generate zero-filled buckets
        const bucketSizeMs = bucket === "1h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        const zeroBuckets: Array<{
          t: string;
          submissions: number;
          mod_actions: Record<string, number>;
        }> = [];

        for (let time = startTime; time < endTime; time += bucketSizeMs) {
          const date = new Date(time);
          const bucketKey =
            bucket === "1h"
              ? date.toISOString().substring(0, 13) + ":00:00Z"
              : date.toISOString().substring(0, 10) + "T00:00:00Z";

          const existingData = dataMap.get(bucketKey);

          zeroBuckets.push({
            t: bucketKey,
            submissions: existingData?.submissions || 0,
            mod_actions: existingData?.mod_actions || {},
          });
        }

        logger.debug(
          { guild_id, window, bucket, count: zeroBuckets.length },
          "[api:metrics:timeseries] served zero-filled timeseries"
        );

        return {
          window,
          bucket,
          start: new Date(startTime).toISOString(),
          end: new Date(endTime).toISOString(),
          buckets: zeroBuckets,
        };
      } catch (err) {
        logger.error({ err }, "[api:metrics:timeseries] failed");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/metrics/latency
  fastify.get(
    "/api/metrics/latency",
    {
      preHandler: verifySession,
    },
    async (request, reply) => {
      const {
        guild_id,
        window = "30d",
        bucket: requestedBucket,
      } = request.query as {
        guild_id?: string;
        window?: string;
        bucket?: string;
      };

      if (!guild_id) {
        return reply.code(400).send({ error: "guild_id required" });
      }

      try {
        // Window sizes in milliseconds
        const windowMs: Record<string, number> = {
          "1d": 1 * 24 * 60 * 60 * 1000,
          "7d": 7 * 24 * 60 * 60 * 1000,
          "30d": 30 * 24 * 60 * 60 * 1000,
          "365d": 365 * 24 * 60 * 60 * 1000,
        };

        // Auto-select bucket size based on window
        const bucket = requestedBucket || (window === "1d" || window === "7d" ? "1h" : "1d");

        const endTime = Date.now();
        const startTime = endTime - (windowMs[window] || windowMs["30d"]);
        const startSec = Math.floor(startTime / 1000);
        const endSec = Math.floor(endTime / 1000);

        // Get epoch filter
        const epochFilter = getEpochPredicate(guild_id, "created_at_s");

        // Bucket format for SQLite
        const bucketFormat = bucket === "1h" ? "%Y-%m-%dT%H:00:00Z" : "%Y-%m-%dT00:00:00Z";

        // Query for response times (time between app_submitted and FIRST mod action)
        const modActionsPlaceholders = Array.from(MOD_ACTIONS)
          .map(() => "?")
          .join(",");
        const rows = db
          .prepare(
            `
            WITH first_mod_actions AS (
              SELECT
                app_id,
                MIN(created_at_s) as first_action_ts
              FROM action_log
              WHERE guild_id = ?
                AND action IN (${modActionsPlaceholders})
                AND app_id IS NOT NULL
                ${epochFilter.sql}
              GROUP BY app_id
            )
            SELECT
              strftime(?, datetime(fma.first_action_ts, 'unixepoch')) as bucket,
              (fma.first_action_ts - submit.created_at_s) as response_time_s
            FROM action_log submit
            INNER JOIN first_mod_actions fma
              ON submit.app_id = fma.app_id
            WHERE submit.action = 'app_submitted'
              AND submit.guild_id = ?
              AND fma.first_action_ts >= ?
              ${epochFilter.sql}
              AND submit.created_at_s < fma.first_action_ts
            ORDER BY bucket
          `
          )
          .all(
            guild_id,
            ...Array.from(MOD_ACTIONS),
            ...epochFilter.params,
            bucketFormat,
            guild_id,
            startSec,
            ...epochFilter.params
          ) as Array<{
          bucket: string;
          response_time_s: number;
        }>;

        // Group by bucket and calculate percentiles
        const bucketMap = new Map<string, number[]>();

        for (const row of rows) {
          const bucketKey = row.bucket;

          if (!bucketMap.has(bucketKey)) {
            bucketMap.set(bucketKey, []);
          }

          bucketMap.get(bucketKey)!.push(row.response_time_s);
        }

        // Generate zero-filled buckets
        const bucketSizeMs = bucket === "1h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        const zeroBuckets: Array<{
          t: string;
          avg_response_time_s: number;
          p50_response_time_s: number;
          p95_response_time_s: number;
          count: number;
        }> = [];

        for (let time = startTime; time < endTime; time += bucketSizeMs) {
          const date = new Date(time);
          const bucketKey =
            bucket === "1h"
              ? date.toISOString().substring(0, 13) + ":00:00Z"
              : date.toISOString().substring(0, 10) + "T00:00:00Z";

          const times = bucketMap.get(bucketKey);

          if (times && times.length > 0) {
            const sorted = times.sort((a, b) => a - b);
            const avg = sorted.reduce((sum, val) => sum + val, 0) / sorted.length;
            const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
            const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;

            zeroBuckets.push({
              t: bucketKey,
              avg_response_time_s: Math.round(avg),
              p50_response_time_s: Math.round(p50),
              p95_response_time_s: Math.round(p95),
              count: sorted.length,
            });
          } else {
            // Zero-fill missing bucket
            zeroBuckets.push({
              t: bucketKey,
              avg_response_time_s: 0,
              p50_response_time_s: 0,
              p95_response_time_s: 0,
              count: 0,
            });
          }
        }

        logger.debug(
          { guild_id, window, bucket, count: zeroBuckets.length },
          "[api:metrics:latency] served zero-filled latency"
        );

        return {
          window,
          bucket,
          start: new Date(startTime).toISOString(),
          end: new Date(endTime).toISOString(),
          buckets: zeroBuckets,
        };
      } catch (err) {
        logger.error({ err }, "[api:metrics:latency] failed");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/metrics/join_submit
  fastify.get(
    "/api/metrics/join_submit",
    {
      preHandler: verifySession,
    },
    async (request, reply) => {
      const {
        guild_id,
        window = "30d",
        bucket: requestedBucket,
      } = request.query as {
        guild_id?: string;
        window?: string;
        bucket?: string;
      };

      if (!guild_id) {
        return reply.code(400).send({ error: "guild_id required" });
      }

      try {
        // Window sizes in milliseconds
        const windowMs: Record<string, number> = {
          "1d": 1 * 24 * 60 * 60 * 1000,
          "7d": 7 * 24 * 60 * 60 * 1000,
          "30d": 30 * 24 * 60 * 60 * 1000,
          "365d": 365 * 24 * 60 * 60 * 1000,
        };

        // Auto-select bucket size based on window
        const bucket = requestedBucket || (window === "1d" || window === "7d" ? "1h" : "1d");

        const endTime = Date.now();
        const startTime = endTime - (windowMs[window] || windowMs["30d"]);
        const startSec = Math.floor(startTime / 1000);
        const endSec = Math.floor(endTime / 1000);

        // Get epoch filter
        const epochFilter = getEpochPredicate(guild_id, "created_at_s");

        // Bucket format for SQLite
        const bucketFormat = bucket === "1h" ? "%Y-%m-%dT%H:00:00Z" : "%Y-%m-%dT00:00:00Z";

        // Query joins and submits
        const rows = db
          .prepare(
            `
            SELECT
              strftime(?, datetime(created_at_s, 'unixepoch')) as bucket,
              action,
              COUNT(*) as count
            FROM action_log
            WHERE guild_id = ?
              AND created_at_s >= ?
              AND action IN ('member_join', 'app_submitted')
              ${epochFilter.sql}
            GROUP BY bucket, action
            ORDER BY bucket
          `
          )
          .all(bucketFormat, guild_id, startSec, ...epochFilter.params) as Array<{
          bucket: string;
          action: string;
          count: number;
        }>;

        // Build map of actual data
        const dataMap = new Map<string, { joins: number; submits: number }>();

        for (const row of rows) {
          if (!dataMap.has(row.bucket)) {
            dataMap.set(row.bucket, { joins: 0, submits: 0 });
          }

          const data = dataMap.get(row.bucket)!;

          if (row.action === "member_join") {
            data.joins += row.count;
          } else if (row.action === "app_submitted") {
            data.submits += row.count;
          }
        }

        // Generate zero-filled buckets
        const bucketSizeMs = bucket === "1h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        const zeroBuckets: Array<{
          t: string;
          joins: number;
          submits: number;
          ratio_pct: number;
        }> = [];

        for (let time = startTime; time < endTime; time += bucketSizeMs) {
          const date = new Date(time);
          const bucketKey =
            bucket === "1h"
              ? date.toISOString().substring(0, 13) + ":00:00Z"
              : date.toISOString().substring(0, 10) + "T00:00:00Z";

          const existingData = dataMap.get(bucketKey);
          const joins = existingData?.joins || 0;
          const submits = existingData?.submits || 0;
          const ratio_pct = joins > 0 ? Math.round((submits / joins) * 100) : 0;

          zeroBuckets.push({
            t: bucketKey,
            joins,
            submits,
            ratio_pct,
          });
        }

        logger.debug(
          { guild_id, window, bucket, count: zeroBuckets.length },
          "[api:metrics:join_submit] served zero-filled join→submit ratio"
        );

        return {
          window,
          bucket,
          start: new Date(startTime).toISOString(),
          end: new Date(endTime).toISOString(),
          buckets: zeroBuckets,
        };
      } catch (err) {
        logger.error({ err }, "[api:metrics:join_submit] failed");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
