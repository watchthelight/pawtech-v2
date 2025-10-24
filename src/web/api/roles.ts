/**
 * Pawtropolis Tech — src/web/api/roles.ts
 * WHAT: API routes for resolving Discord role metadata by IDs.
 * WHY: Allow config page to show Discord-style role pills with colors/emojis.
 * ROUTES:
 *  - GET /api/roles/resolve → resolve specific role IDs to metadata
 * DOCS:
 *  - Discord API: https://discord.com/developers/docs/resources/guild#guild-role-object
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { logger } from "../../lib/logger.js";
import { verifySession } from "../auth.js";
import { client } from "../../index.js";

/**
 * Simple in-memory cache for resolved roles
 * Structure: Map<guild_id, { roles: Role[], timestamp: number }>
 */
const rolesCache = new Map<string, { roles: any[]; timestamp: number }>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * WHAT: Register role resolution API routes.
 * WHY: Expose role metadata for config UI role pills.
 *
 * @param fastify - Fastify instance
 */
export async function registerRolesRoutes(fastify: FastifyInstance) {
  // GET /api/roles/resolve
  fastify.get(
    "/api/roles/resolve",
    {
      preHandler: verifySession,
    },
    async (request, reply) => {
      const { guild_id, ids } = request.query as {
        guild_id?: string;
        ids?: string;
      };

      if (!guild_id || !ids) {
        return reply.code(400).send({ error: "guild_id and ids required" });
      }

      // Parse comma-separated IDs
      const roleIds = ids
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (roleIds.length === 0) {
        return { items: [] };
      }

      try {
        // Check cache
        const cached = rolesCache.get(guild_id);
        const now = Date.now();
        let allRoles: any[];

        if (cached && now - cached.timestamp < CACHE_TTL_MS) {
          logger.debug({ guild_id }, "[api:roles:resolve] served from cache");
          allRoles = cached.roles;
        } else {
          // Fetch from Discord
          const guild = await client.guilds.fetch(guild_id);

          if (!guild) {
            return reply.code(404).send({ error: "Guild not found" });
          }

          const roles = await guild.roles.fetch();

          // Format roles
          allRoles = roles.map((role) => ({
            id: role.id,
            name: role.name,
            color: role.color,
            position: role.position,
            unicodeEmoji: role.unicodeEmoji || null,
          }));

          // Update cache
          rolesCache.set(guild_id, {
            roles: allRoles,
            timestamp: now,
          });

          logger.debug(
            { guild_id, count: allRoles.length },
            "[api:roles:resolve] fetched from Discord"
          );
        }

        // Filter to requested IDs
        const roleMap = new Map(allRoles.map((r) => [r.id, r]));
        const items = roleIds
          .map((id) => roleMap.get(id))
          .filter(Boolean)
          .map((role) => ({
            role_id: role!.id,
            name: role!.name,
            color_hex: role!.color ? `#${role!.color.toString(16).padStart(6, "0")}` : null,
            emoji: role!.unicodeEmoji || null,
            position: role!.position,
          }));

        return { items };
      } catch (err) {
        logger.error({ err, guild_id }, "[api:roles:resolve] failed");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
