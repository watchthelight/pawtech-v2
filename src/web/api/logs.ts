/**
 * Pawtropolis Tech — src/web/api/logs.ts
 * WHAT: API routes for action logs and real-time SSE streaming.
 * WHY: Expose action_log table to admin dashboard with live updates.
 * ROUTES:
 *  - GET /api/logs → fetch recent action logs with filters
 *  - GET /api/logs/stream → SSE stream of new action logs
 * DOCS:
 *  - Fastify routing: https://fastify.dev/docs/latest/Reference/Routes/
 *  - Server-Sent Events: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { verifySession } from "../auth.js";
import type { FastifyReplyTyped } from "fastify";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Simple event emitter for broadcasting new action logs to SSE clients
 */
class LogStreamEmitter {
  private listeners = new Set<(event: ApiLogEntry) => void>();

  subscribe(callback: (event: ApiLogEntry) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit(event: ApiLogEntry): void {
    this.listeners.forEach((callback) => callback(event));
  }

  get activeConnections(): number {
    return this.listeners.size;
  }
}

const logEmitter = new LogStreamEmitter();

/**
 * Action log entry shape for API response
 */
interface ApiLogEntry {
  id: number;
  action: string;
  timestamp: string;
  guild_id: string;
  moderator_id: string;
  applicant_id: string | null;
  app_id: string | null;
  app_code: string | null;
  reason: string | null;
  metadata: Record<string, any> | null;
}

/**
 * WHAT: Register log API routes.
 * WHY: Expose action logs to admin dashboard.
 *
 * @param fastify - Fastify instance
 */
export async function registerLogsRoutes(fastify: FastifyInstance) {
  // GET /api/logs
  fastify.get(
    "/api/logs",
    {
      preHandler: verifySession,
    },
    async (request, reply) => {
      const {
        limit: limitParam,
        action,
        guild_id,
        moderator_id,
      } = request.query as {
        limit?: string;
        action?: string;
        guild_id?: string;
        moderator_id?: string;
      };

      const limit = limitParam
        ? Math.min(Math.max(1, parseInt(limitParam, 10)), MAX_LIMIT)
        : DEFAULT_LIMIT;

      try {
        // Build query
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
          WHERE 1=1
        `;

        const params: any[] = [];

        // Filter by guild_id
        if (guild_id) {
          query += ` AND guild_id = ?`;
          params.push(guild_id);
        }

        // Filter by moderator_id
        if (moderator_id) {
          query += ` AND actor_id = ?`;
          params.push(moderator_id);
        }

        // Filter by action types
        if (action) {
          const actions = action.split(",").map((a) => a.trim());
          const placeholders = actions.map(() => "?").join(",");
          query += ` AND action IN (${placeholders})`;
          params.push(...actions);
        }

        query += ` ORDER BY created_at_s DESC LIMIT ?`;
        params.push(limit);

        // Execute query
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

        // Transform to API shape
        const items: ApiLogEntry[] = rows.map((row) => ({
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

        logger.debug(
          { count: items.length, filters: { guild_id, moderator_id, action } },
          "[api:logs] served logs"
        );

        return {
          items,
          count: items.length,
          limit,
        };
      } catch (err) {
        logger.error({ err }, "[api:logs] failed to fetch logs");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/logs/stream (Server-Sent Events)
  fastify.get(
    "/api/logs/stream",
    {
      preHandler: verifySession,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { guild_id } = request.query as { guild_id?: string };

      if (!guild_id) {
        return reply.code(400).send({ error: "guild_id required" });
      }

      // Set headers for SSE
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // Disable nginx buffering
      });

      let eventId = 0;

      // Send initial connection confirmation
      reply.raw.write(`: connected\n\n`);

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        reply.raw.write(`: heartbeat\n\n`);
      }, 20000);

      // Subscribe to new log events
      const unsubscribe = logEmitter.subscribe((event: ApiLogEntry) => {
        // Only send events for the requested guild
        if (event.guild_id === guild_id) {
          eventId++;
          const data = JSON.stringify(event);
          reply.raw.write(`id: ${eventId}\n`);
          reply.raw.write(`event: action\n`);
          reply.raw.write(`data: ${data}\n\n`);
        }
      });

      logger.info(
        { guild_id, activeConnections: logEmitter.activeConnections },
        "[api:logs:stream] SSE client connected"
      );

      // Cleanup on client disconnect
      request.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        logger.info(
          { guild_id, activeConnections: logEmitter.activeConnections },
          "[api:logs:stream] SSE client disconnected"
        );
      });
    }
  );
}

/**
 * WHAT: Emit a new action log event to all SSE subscribers.
 * WHY: Notify connected clients of new log entries in real-time.
 * WHEN: Called when a new action is logged to the database.
 *
 * @param event - The log entry to broadcast
 */
export function broadcastLogEvent(event: ApiLogEntry): void {
  logEmitter.emit(event);
}
