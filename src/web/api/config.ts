/**
 * Pawtropolis Tech — src/web/api/config.ts
 * WHAT: API routes for guild configuration management.
 * WHY: Allow admins to view/update bot settings via dashboard.
 * ROUTES:
 *  - GET /api/config → fetch guild config
 *  - POST /api/config → update guild config
 * DOCS:
 *  - Fastify routing: https://fastify.dev/docs/latest/Reference/Routes/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { verifySession } from "../auth.js";
import { setLoggingChannelId, getLoggingChannelId } from "../../config/loggingStore.js";
import {
  setFlagsChannelId,
  setSilentFirstMsgDays,
  getFlaggerConfig,
} from "../../config/flaggerStore.js";
import { upsertConfig } from "../../lib/config.js";
import { client } from "../../index.js";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { env } from "../../lib/env.js";
import { timingSafeEqual } from "node:crypto";

/**
 * Guild config shape
 */
interface GuildConfig {
  guild_id: string;
  logging_channel_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * WHAT: Timing-safe password comparison.
 * WHY: Prevent timing attacks on password verification.
 *
 * @param a - User-provided password
 * @param b - Correct password
 * @returns true if passwords match
 */
function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * WHAT: Check logging channel health.
 * WHY: Verify channel exists and bot has required permissions.
 *
 * @param guildId - Discord guild ID
 * @param channelId - Logging channel ID
 * @returns Health status object
 */
async function checkLoggingChannelHealth(
  guildId: string,
  channelId: string | null
): Promise<{ logging_channel_ok: boolean; logging_perms_ok: boolean }> {
  if (!channelId) {
    return { logging_channel_ok: false, logging_perms_ok: false };
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) {
      return { logging_channel_ok: false, logging_perms_ok: false };
    }

    const channel = await guild.channels.fetch(channelId);
    if (!channel) {
      return { logging_channel_ok: false, logging_perms_ok: false };
    }

    // Check if it's a text channel
    if (channel.type !== ChannelType.GuildText) {
      return { logging_channel_ok: true, logging_perms_ok: false };
    }

    // Check bot permissions
    const botMember = await guild.members.fetchMe();
    const permissions = channel.permissionsFor(botMember);

    const hasRequiredPerms =
      permissions?.has(PermissionFlagsBits.SendMessages) &&
      permissions?.has(PermissionFlagsBits.EmbedLinks);

    return {
      logging_channel_ok: true,
      logging_perms_ok: hasRequiredPerms || false,
    };
  } catch (err) {
    logger.error({ err, guildId, channelId }, "[config] health check failed");
    return { logging_channel_ok: false, logging_perms_ok: false };
  }
}

/**
 * WHAT: Check flags channel health (PR8).
 * WHY: Verify channel exists and bot has required permissions for Silent-Since-Join alerts.
 *
 * @param guildId - Discord guild ID
 * @param channelId - Flags channel ID
 * @returns Health status object
 */
async function checkFlagsChannelHealth(
  guildId: string,
  channelId: string | null
): Promise<{ flags_channel_ok: boolean; flags_perms_ok: boolean }> {
  if (!channelId) {
    return { flags_channel_ok: false, flags_perms_ok: false };
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) {
      return { flags_channel_ok: false, flags_perms_ok: false };
    }

    const channel = await guild.channels.fetch(channelId);
    if (!channel) {
      return { flags_channel_ok: false, flags_perms_ok: false };
    }

    // Check if it's a text channel
    if (channel.type !== ChannelType.GuildText) {
      return { flags_channel_ok: true, flags_perms_ok: false };
    }

    // Check bot permissions (same as logging: SendMessages + EmbedLinks)
    const botMember = await guild.members.fetchMe();
    const permissions = channel.permissionsFor(botMember);

    const hasRequiredPerms =
      permissions?.has(PermissionFlagsBits.SendMessages) &&
      permissions?.has(PermissionFlagsBits.EmbedLinks);

    return {
      flags_channel_ok: true,
      flags_perms_ok: hasRequiredPerms || false,
    };
  } catch (err) {
    logger.error({ err, guildId, channelId }, "[config] flags health check failed");
    return { flags_channel_ok: false, flags_perms_ok: false };
  }
}

/**
 * WHAT: Register config API routes.
 * WHY: Expose guild configuration to admin dashboard.
 *
 * @param fastify - Fastify instance
 */
export async function registerConfigRoutes(fastify: FastifyInstance) {
  // GET /api/config
  fastify.get(
    "/api/config",
    {
      preHandler: verifySession,
    },
    async (request, reply) => {
      const { guild_id } = request.query as { guild_id?: string };

      if (!guild_id) {
        return reply.code(400).send({ error: "guild_id required" });
      }

      try {
        // Fetch guild config including welcome template and mod roles
        const config = db
          .prepare(
            `
          SELECT
            guild_id,
            logging_channel_id,
            welcome_template,
            mod_role_ids,
            created_at,
            updated_at
          FROM guild_config
          WHERE guild_id = ?
        `
          )
          .get(guild_id) as
          | (GuildConfig & { welcome_template?: string | null; mod_role_ids?: string | null })
          | undefined;

        // Gate message is hardcoded in the bot (not stored in DB)
        // It's the "Welcome to {guild}" embed with the Verify button
        const gateMessageDefault = `**Welcome to the server!**

Before you enjoy your stay, you must go through our verification system which you can start by clicking **Verify** and answering 5 simple questions.`;

        // Parse mod role IDs from comma-separated string
        const modRoleIds = config?.mod_role_ids
          ? config.mod_role_ids.split(",").filter(Boolean)
          : [];

        // Check logging channel health
        const loggingChannelId = config?.logging_channel_id || null;
        const loggingHealth = await checkLoggingChannelHealth(guild_id, loggingChannelId);

        // Get flags configuration (PR8)
        const flaggerConfig = getFlaggerConfig(guild_id);
        const flagsHealth = await checkFlagsChannelHealth(guild_id, flaggerConfig.channelId);

        // Combine health checks
        const health = {
          ...loggingHealth,
          ...flagsHealth,
        };

        if (!config) {
          // Return empty config if not found
          logger.debug({ guild_id }, "[api:config] no config found, returning defaults");
          return {
            guild_id,
            logging_channel_id: null,
            flags_channel_id: flaggerConfig.channelId,
            silent_first_msg_days: flaggerConfig.silentDays,
            gate_message_md: gateMessageDefault,
            welcome_message_md: null,
            mod_role_ids: [],
            health,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        }

        logger.debug({ guild_id }, "[api:config] served config");

        return {
          ...config,
          flags_channel_id: flaggerConfig.channelId,
          silent_first_msg_days: flaggerConfig.silentDays,
          gate_message_md: gateMessageDefault,
          welcome_message_md: config.welcome_template || null,
          mod_role_ids: modRoleIds,
          health,
        };
      } catch (err) {
        logger.error({ err, guild_id }, "[api:config] failed to fetch config");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/config
  fastify.post(
    "/api/config",
    {
      preHandler: verifySession,
    },
    async (request, reply) => {
      const {
        guild_id,
        logging_channel_id,
        flags_channel_id,
        silent_first_msg_days,
        welcome_template,
        mod_role_ids,
        password,
      } = request.body as {
        guild_id?: string;
        logging_channel_id?: string | null;
        flags_channel_id?: string | null;
        silent_first_msg_days?: number;
        welcome_template?: string | null;
        mod_role_ids?: string[];
        password?: string;
      };

      if (!guild_id) {
        return reply.code(400).send({ error: "guild_id required" });
      }

      // Verify password (RESET_PASSWORD from .env)
      const correctPassword = env.RESET_PASSWORD;
      if (!correctPassword) {
        logger.error("[api:config] RESET_PASSWORD not configured");
        return reply.code(500).send({ error: "Server misconfiguration" });
      }

      if (!password) {
        logger.warn({ guild_id }, "[api:config] password required but not provided");
        return reply.code(401).send({ error: "Password required" });
      }

      if (!safeEq(password, correctPassword)) {
        logger.warn({ guild_id }, "[api:config] incorrect password attempt");
        return reply.code(403).send({ error: "Incorrect password" });
      }

      try {
        const updates: any = {};

        // Update logging_channel_id if provided
        if (logging_channel_id !== undefined) {
          setLoggingChannelId(guild_id, logging_channel_id);
          logger.info({ guild_id, logging_channel_id }, "[api:config] updated logging_channel_id");
        }

        // Update flags_channel_id if provided (PR8)
        if (flags_channel_id !== undefined && flags_channel_id !== null) {
          setFlagsChannelId(guild_id, flags_channel_id);
          logger.info({ guild_id, flags_channel_id }, "[api:config] updated flags_channel_id");
        }

        // Update silent_first_msg_days if provided (PR8)
        if (silent_first_msg_days !== undefined) {
          try {
            setSilentFirstMsgDays(guild_id, silent_first_msg_days);
            logger.info(
              { guild_id, silent_first_msg_days },
              "[api:config] updated silent_first_msg_days"
            );
          } catch (err: any) {
            logger.error(
              { err, guild_id, silent_first_msg_days },
              "[api:config] failed to update silent_first_msg_days"
            );
            return reply
              .code(400)
              .send({ error: err.message || "Invalid silent_first_msg_days value" });
          }
        }

        // Update welcome_template if provided
        if (welcome_template !== undefined) {
          updates.welcome_template = welcome_template;
          logger.info(
            { guild_id, template_length: welcome_template?.length || 0 },
            "[api:config] updated welcome_template"
          );
        }

        // Update mod_role_ids if provided (convert array to comma-separated string)
        if (mod_role_ids !== undefined) {
          const roleIdsStr = Array.isArray(mod_role_ids)
            ? mod_role_ids.filter(Boolean).join(",")
            : null;
          updates.mod_role_ids = roleIdsStr;
          logger.info(
            { guild_id, role_count: mod_role_ids.length },
            "[api:config] updated mod_role_ids"
          );
        }

        // Apply updates if any
        if (Object.keys(updates).length > 0) {
          upsertConfig(guild_id, updates);
        }

        // Fetch updated config
        const config = db
          .prepare(
            `
          SELECT
            guild_id,
            logging_channel_id,
            welcome_template,
            mod_role_ids,
            created_at,
            updated_at
          FROM guild_config
          WHERE guild_id = ?
        `
          )
          .get(guild_id) as any;

        return {
          ...config,
          mod_role_ids: config.mod_role_ids ? config.mod_role_ids.split(",").filter(Boolean) : [],
        };
      } catch (err) {
        logger.error({ err, guild_id }, "[api:config] failed to update config");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
