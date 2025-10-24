/**
 * Pawtropolis Tech — src/server/dashboard.ts
 * WHAT: HTTP server for dashboard JSON feed (action_log recent entries).
 * WHY: Enables external dashboards/analytics to consume action logs via REST API.
 * FLOWS:
 *  - GET /logs/dashboard.json → returns last N action_log rows as JSON
 *  - Query params: ?limit=50&action=accept,claim
 * DOCS:
 *  - Node HTTP server: https://nodejs.org/api/http.html
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import http from "node:http";
import { URL } from "node:url";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Action log entry shape for dashboard feed
 */
interface DashboardLogEntry {
  id: number;
  action: string;
  timestamp: string; // ISO8601
  guild_id: string;
  moderator_id: string;
  applicant_id: string | null;
  app_id: string | null;
  app_code: string | null;
  reason: string | null;
  metadata: Record<string, any> | null;
}

/**
 * WHAT: Fetch recent action_log entries with optional filters.
 * WHY: Powers dashboard JSON feed for analytics/monitoring.
 *
 * @param limit - Max number of entries (default 100, max 500)
 * @param actions - Filter by action types (comma-separated)
 * @returns Array of action log entries
 */
function getRecentActionLogs(
  limit: number = DEFAULT_LIMIT,
  actions?: string[]
): DashboardLogEntry[] {
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  let query = `
    SELECT
      id,
      action,
      created_at_s,
      guild_id,
      actor_id,
      subject_id,
      app_id,
      app_code,
      reason,
      meta_json
    FROM action_log
  `;

  const params: any[] = [];

  // Filter by action types if specified
  if (actions && actions.length > 0) {
    const placeholders = actions.map(() => "?").join(",");
    query += ` WHERE action IN (${placeholders})`;
    params.push(...actions);
  }

  query += ` ORDER BY created_at_s DESC LIMIT ?`;
  params.push(safeLimit);

  try {
    const rows = db.prepare(query).all(...params) as Array<{
      id: number;
      action: string;
      created_at_s: number;
      guild_id: string;
      actor_id: string;
      subject_id: string | null;
      app_id: string | null;
      app_code: string | null;
      reason: string | null;
      meta_json: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      timestamp: new Date(row.created_at_s * 1000).toISOString(),
      guild_id: row.guild_id,
      moderator_id: row.actor_id,
      applicant_id: row.subject_id,
      app_id: row.app_id,
      app_code: row.app_code,
      reason: row.reason,
      metadata: row.meta_json ? JSON.parse(row.meta_json) : null,
    }));
  } catch (err) {
    logger.error({ err }, "[dashboard] failed to fetch action logs");
    throw err;
  }
}

/**
 * WHAT: HTTP request handler for dashboard routes.
 * WHY: Serves dashboard JSON feed endpoint.
 *
 * @param req - HTTP request
 * @param res - HTTP response
 */
function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  // CORS headers for external dashboard access
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Only allow GET requests
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  // Route: GET /logs/dashboard.json
  if (url.pathname === "/logs/dashboard.json" || url.pathname === "/logs/dashboard") {
    try {
      // Parse query parameters
      const mode = url.searchParams.get("mode") || "logs";
      const limitParam = url.searchParams.get("limit");
      const actionParam = url.searchParams.get("action");

      // Mode: stats → return moderator metrics
      if (mode === "stats") {
        const guildId = url.searchParams.get("guild_id");
        const limit = limitParam ? Math.min(parseInt(limitParam, 10), MAX_LIMIT) : 50;

        // Query mod_metrics table
        let query = `
          SELECT * FROM mod_metrics
        `;

        const params: any[] = [];

        if (guildId) {
          query += ` WHERE guild_id = ?`;
          params.push(guildId);
        }

        query += ` ORDER BY total_accepts DESC LIMIT ?`;
        params.push(limit);

        const items = db.prepare(query).all(...params) as Array<any>;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(
            {
              items,
              count: items.length,
              limit,
              mode: "stats",
            },
            null,
            2
          )
        );

        logger.debug(
          { path: url.pathname, mode, guildId, count: items.length },
          "[dashboard] served mod metrics"
        );
        return;
      }

      // Mode: logs (default) → return action logs
      const limit = limitParam ? parseInt(limitParam, 10) : DEFAULT_LIMIT;
      const actions = actionParam ? actionParam.split(",").map((a) => a.trim()) : undefined;

      // Fetch logs
      const items = getRecentActionLogs(limit, actions);

      // Return JSON response
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            items,
            count: items.length,
            limit: Math.min(limit, MAX_LIMIT),
            mode: "logs",
          },
          null,
          2
        )
      );

      logger.debug(
        { path: url.pathname, limit, actions, count: items.length },
        "[dashboard] served action logs"
      );
    } catch (err) {
      logger.error({ err, path: url.pathname }, "[dashboard] error serving logs");
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
    return;
  }

  // Route: GET /health
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "pawtropolis-dashboard" }));
    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}

/**
 * WHAT: Start dashboard HTTP server.
 * WHY: Enables external access to action logs for dashboards/analytics.
 *
 * @param port - Port number (default: 3000)
 * @returns HTTP server instance
 */
export function startDashboardServer(port: number = 3000): http.Server {
  const server = http.createServer(handleRequest);

  server.listen(port, () => {
    logger.info({ port }, "[dashboard] HTTP server started");
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    logger.info("[dashboard] SIGTERM received, closing server");
    server.close(() => {
      logger.info("[dashboard] server closed");
    });
  });

  return server;
}
