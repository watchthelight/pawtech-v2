/**
 * Pawtropolis Tech — src/web/api/guild.ts
 * WHAT: API routes for Discord guild data (roles, etc).
 * WHY: Expose guild metadata to admin dashboard.
 * ROUTES:
 *  - GET /api/guild/roles → fetch guild roles with caching
 * DOCS:
 *  - Discord API: https://discord.com/developers/docs/resources/guild#guild-role-object
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { logger } from "../../lib/logger.js";
import { verifySession } from "../auth.js";
import { client } from "../../index.js";

/**
 * Simple in-memory cache for guild roles
 * Structure: Map<guild_id, { roles: Role[], timestamp: number }>
 */
const rolesCache = new Map<string, { roles: any[]; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * WHAT: Register guild API routes.
 * WHY: Expose Discord guild data to admin dashboard.
 *
 * @param fastify - Fastify instance
 */
export async function registerGuildRoutes(fastify: FastifyInstance) {
  // GET /api/guild/roles
  fastify.get(
    "/api/guild/roles",
    {
      preHandler: verifySession,
    },
    async (request, reply) => {
      const { guild_id } = request.query as {
        guild_id?: string;
      };

      if (!guild_id) {
        return reply.code(400).send({ error: "guild_id required" });
      }

      try {
        // Check cache
        const cached = rolesCache.get(guild_id);
        const now = Date.now();

        if (cached && now - cached.timestamp < CACHE_TTL_MS) {
          logger.debug({ guild_id }, "[api:guild:roles] served from cache");
          return {
            roles: cached.roles,
            cached: true,
          };
        }

        // Fetch from Discord
        const guild = await client.guilds.fetch(guild_id);

        if (!guild) {
          return reply.code(404).send({ error: "Guild not found" });
        }

        const roles = await guild.roles.fetch();

        // Format roles
        const formattedRoles = roles.map((role) => ({
          id: role.id,
          name: role.name,
          color: role.color,
          position: role.position,
          icon: role.icon
            ? `https://cdn.discordapp.com/role-icons/${role.id}/${role.icon}.png?size=32`
            : null,
          unicodeEmoji: role.unicodeEmoji || null,
        }));

        // Sort by position (highest first)
        formattedRoles.sort((a, b) => b.position - a.position);

        // Update cache
        rolesCache.set(guild_id, {
          roles: formattedRoles,
          timestamp: now,
        });

        logger.debug(
          { guild_id, count: formattedRoles.length },
          "[api:guild:roles] fetched from Discord"
        );

        return {
          roles: formattedRoles,
          cached: false,
        };
      } catch (err) {
        logger.error({ err, guild_id }, "[api:guild:roles] failed");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
