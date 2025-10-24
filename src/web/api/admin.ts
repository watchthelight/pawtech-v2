/**
 * Pawtropolis Tech — src/web/api/admin.ts
 * WHAT: Admin-only API routes for dangerous operations (reset data, etc).
 * WHY: Provides web dashboard access to administrative functions.
 * ROUTES:
 *  - POST /api/admin/resetdata → reset metrics epoch with password validation
 * DOCS:
 *  - Fastify routing: https://fastify.dev/docs/latest/Reference/Routes/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { logger } from "../../lib/logger.js";
import { verifySession } from "../auth.js";
import { setMetricsEpoch } from "../../features/metricsEpoch.js";
import { __test__clearModMetricsCache as clearModMetricsCache } from "../../features/modPerformance.js";
import { db } from "../../db/db.js";
import crypto from "node:crypto";

/**
 * WHAT: Constant-time string comparison to prevent timing attacks.
 * WHY: Password validation must not leak information via timing.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * WHAT: Register admin API routes.
 * WHY: Expose dangerous administrative operations with strict auth.
 *
 * @param fastify - Fastify instance
 */
export async function registerAdminRoutes(fastify: FastifyInstance) {
  // POST /api/admin/resetdata
  fastify.post(
    "/api/admin/resetdata",
    {
      preHandler: verifySession,
    },
    async (request, reply) => {
      const { guild_id, password } = request.body as {
        guild_id?: string;
        password?: string;
      };

      // Validate inputs
      if (!guild_id || !password) {
        return reply.code(400).send({ error: "guild_id and password required" });
      }

      // Validate password
      const correctPassword = process.env.RESET_PASSWORD;

      if (!correctPassword) {
        logger.error("[api:admin:resetdata] RESET_PASSWORD not configured");
        return reply.code(500).send({ error: "Server misconfiguration" });
      }

      if (!constantTimeCompare(password, correctPassword)) {
        logger.warn(
          { userId: request.session.user?.id, guildId: guild_id },
          "[api:admin:resetdata] incorrect password attempt"
        );

        return reply.code(403).send({ error: "Incorrect password" });
      }

      // Verify user has admin role
      const user = request.session.user;
      if (!user || !user.isAdmin) {
        logger.warn(
          { userId: user?.id, guildId: guild_id },
          "[api:admin:resetdata] unauthorized attempt (no admin role)"
        );

        return reply.code(403).send({ error: "Admin role required" });
      }

      try {
        // Set metrics epoch
        const epoch = new Date();
        setMetricsEpoch(guild_id, epoch);

        // Clear mod metrics cache
        clearModMetricsCache();

        // Delete cached mod_metrics rows (optional, harmless)
        db.prepare(`DELETE FROM mod_metrics WHERE guild_id = ?`).run(guild_id);

        // Log action to action_log
        db.prepare(
          `
          INSERT INTO action_log (
            guild_id, actor_id, action, created_at_s, meta_json
          ) VALUES (?, ?, ?, ?, ?)
        `
        ).run(
          guild_id,
          user.id,
          "modmail_close", // Repurpose for audit
          Math.floor(Date.now() / 1000),
          JSON.stringify({ action_type: "metrics_reset", epoch: epoch.toISOString() })
        );

        logger.info(
          { userId: user.id, guildId: guild_id, epoch: epoch.toISOString() },
          "[api:admin:resetdata] metrics reset successful"
        );

        return reply.send({
          ok: true,
          epoch: epoch.toISOString(),
          message: "Metrics data reset successfully",
        });
      } catch (err) {
        logger.error({ err, guildId: guild_id }, "[api:admin:resetdata] failed");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
