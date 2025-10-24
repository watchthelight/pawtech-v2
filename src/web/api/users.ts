/**
 * Pawtropolis Tech — src/web/api/users.ts
 * WHAT: Discord user identity resolution with SQLite caching.
 * WHY: Provide usernames, avatars, and display names without rate-limiting Discord API.
 * ROUTES:
 *  - GET /api/users/resolve?guild_id=...&ids=123,456 → resolves user identities
 * DOCS:
 *  - Discord API: https://discord.com/developers/docs/resources/guild#get-guild-member
 *  - Discord CDN: https://discord.com/developers/docs/reference#image-formatting
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import axios from "axios";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { verifySession } from "../auth.js";

const CACHE_TTL_SECONDS = 1800; // 30 minutes
const NEGATIVE_CACHE_TTL_SECONDS = 300; // 5 minutes for failed lookups
const RATE_LIMIT_PER_MINUTE = 50;

// Simple in-memory rate limiter (token bucket)
const rateLimiter = {
  tokens: RATE_LIMIT_PER_MINUTE,
  lastRefill: Date.now(),

  tryConsume(count: number = 1): boolean {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    // Refill tokens every minute
    if (elapsed >= 60000) {
      this.tokens = RATE_LIMIT_PER_MINUTE;
      this.lastRefill = now;
    }

    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  },

  remaining(): number {
    return this.tokens;
  },
};

/**
 * Resolved user identity
 */
export interface ResolvedUser {
  user_id: string;
  username: string;
  global_name: string | null;
  display_name: string | null;
  avatar_url: string;
  fetched_at: string;
}

/**
 * Cached user data from database
 */
interface CachedUser {
  user_id: string;
  guild_id: string;
  username: string;
  global_name: string | null;
  display_name: string | null;
  avatar_hash: string | null;
  avatar_url: string;
  updated_at: string;
}

/**
 * Discord guild member response
 */
interface DiscordGuildMember {
  user?: {
    id: string;
    username: string;
    global_name?: string | null;
    discriminator: string;
    avatar?: string | null;
  };
  nick?: string | null;
}

/**
 * WHAT: Get fallback avatar URL for a user.
 * WHY: Provide default Discord avatar when user has none.
 *
 * @param userId - Discord user ID
 * @returns Default Discord avatar URL
 */
function getFallbackAvatarUrl(userId: string): string {
  const defaultAvatarIndex = BigInt(userId) % 5n;
  return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png?size=128`;
}

/**
 * WHAT: Build avatar URL from user data.
 * WHY: Generate CDN URL for user's custom avatar or fallback.
 *
 * @param userId - Discord user ID
 * @param avatarHash - Avatar hash from Discord API
 * @returns Avatar CDN URL
 */
function getAvatarUrl(userId: string, avatarHash: string | null | undefined): string {
  if (!avatarHash) {
    return getFallbackAvatarUrl(userId);
  }
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=128`;
}

/**
 * WHAT: Fetch cached users from database.
 * WHY: Avoid hitting Discord API if data is fresh.
 *
 * @param guildId - Discord guild ID
 * @param userIds - Array of user IDs to fetch
 * @returns Map of user_id → cached user data
 */
function getCachedUsers(guildId: string, userIds: string[]): Map<string, CachedUser> {
  if (userIds.length === 0) return new Map();

  const placeholders = userIds.map(() => "?").join(",");
  const query = `
    SELECT
      user_id, guild_id, username, global_name, display_name,
      avatar_hash, avatar_url, updated_at
    FROM user_cache
    WHERE guild_id = ? AND user_id IN (${placeholders})
      AND datetime(updated_at, '+${CACHE_TTL_SECONDS} seconds') > datetime('now')
  `;

  try {
    const rows = db.prepare(query).all(guildId, ...userIds) as CachedUser[];
    const map = new Map<string, CachedUser>();
    for (const row of rows) {
      map.set(row.user_id, row);
    }
    return map;
  } catch (err) {
    logger.error({ err, guildId, userIds }, "[users] failed to fetch cached users");
    return new Map();
  }
}

/**
 * WHAT: Fetch user from Discord guild member API.
 * WHY: Resolve username, avatar, and display name from Discord.
 *
 * @param guildId - Discord guild ID
 * @param userId - Discord user ID
 * @returns Discord guild member data or null if not found
 */
async function fetchFromDiscord(
  guildId: string,
  userId: string
): Promise<DiscordGuildMember | null> {
  const botToken = process.env.DISCORD_TOKEN;
  if (!botToken) {
    logger.error("[users] DISCORD_TOKEN not configured");
    return null;
  }

  try {
    const response = await axios.get(
      `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
      {
        headers: { Authorization: `Bot ${botToken}` },
        timeout: 5000,
      }
    );

    return response.data as DiscordGuildMember;
  } catch (err: any) {
    if (err.response?.status === 404) {
      logger.warn({ guildId, userId }, "[users] user not found in guild");
      return null;
    }
    if (err.response?.status === 429) {
      logger.warn({ guildId, userId }, "[users] Discord API rate limited");
      return null;
    }
    logger.error({ err: err.message, guildId, userId }, "[users] Discord API error");
    return null;
  }
}

/**
 * WHAT: Upsert user data into cache.
 * WHY: Store fetched Discord data for future requests.
 *
 * @param guildId - Discord guild ID
 * @param member - Discord guild member data
 */
function upsertCache(guildId: string, member: DiscordGuildMember): void {
  if (!member.user) return;

  const { id, username, global_name, avatar } = member.user;
  const displayName = member.nick || global_name || username;
  const avatarUrl = getAvatarUrl(id, avatar);

  try {
    db.prepare(
      `
      INSERT INTO user_cache (
        user_id, guild_id, username, global_name, display_name, avatar_hash, avatar_url, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, guild_id) DO UPDATE SET
        username = excluded.username,
        global_name = excluded.global_name,
        display_name = excluded.display_name,
        avatar_hash = excluded.avatar_hash,
        avatar_url = excluded.avatar_url,
        updated_at = datetime('now')
    `
    ).run(id, guildId, username, global_name, displayName, avatar, avatarUrl);

    logger.debug({ userId: id, guildId }, "[users] cached user data");
  } catch (err) {
    logger.error({ err, userId: id, guildId }, "[users] failed to upsert cache");
  }
}

/**
 * WHAT: Resolve user identities with caching.
 * WHY: Provide usernames and avatars for dashboard UI.
 *
 * @param guildId - Discord guild ID
 * @param userIds - Array of user IDs to resolve
 * @returns Array of resolved user objects
 */
async function resolveUsers(guildId: string, userIds: string[]): Promise<ResolvedUser[]> {
  // Get cached users first
  const cached = getCachedUsers(guildId, userIds);
  const results: ResolvedUser[] = [];
  const missingIds: string[] = [];

  for (const userId of userIds) {
    const cachedUser = cached.get(userId);
    if (cachedUser) {
      results.push({
        user_id: cachedUser.user_id,
        username: cachedUser.username,
        global_name: cachedUser.global_name,
        display_name: cachedUser.display_name,
        avatar_url: cachedUser.avatar_url,
        fetched_at: cachedUser.updated_at,
      });
    } else {
      missingIds.push(userId);
    }
  }

  // Fetch missing users from Discord
  if (missingIds.length > 0 && rateLimiter.tryConsume(missingIds.length)) {
    for (const userId of missingIds) {
      const member = await fetchFromDiscord(guildId, userId);

      if (member && member.user) {
        // Cache and add to results
        upsertCache(guildId, member);

        results.push({
          user_id: member.user.id,
          username: member.user.username,
          global_name: member.user.global_name || null,
          display_name: member.nick || member.user.global_name || member.user.username,
          avatar_url: getAvatarUrl(member.user.id, member.user.avatar),
          fetched_at: new Date().toISOString(),
        });
      } else {
        // Add fallback for not found
        results.push({
          user_id: userId,
          username: `User#${userId.slice(-4)}`,
          global_name: null,
          display_name: `User#${userId.slice(-4)}`,
          avatar_url: getFallbackAvatarUrl(userId),
          fetched_at: new Date().toISOString(),
        });
      }
    }
  } else if (missingIds.length > 0) {
    logger.warn({ count: missingIds.length }, "[users] rate limit exceeded, using fallbacks");

    // Rate limited - use fallbacks
    for (const userId of missingIds) {
      results.push({
        user_id: userId,
        username: `User#${userId.slice(-4)}`,
        global_name: null,
        display_name: `User#${userId.slice(-4)}`,
        avatar_url: getFallbackAvatarUrl(userId),
        fetched_at: new Date().toISOString(),
      });
    }
  }

  return results;
}

/**
 * WHAT: Build Discord banner URL from user data.
 * WHY: Generate CDN URL for user's custom banner.
 *
 * @param userId - Discord user ID
 * @param bannerHash - Banner hash from Discord API
 * @returns Banner CDN URL or null
 */
function getBannerUrl(userId: string, bannerHash: string | null | undefined): string | null {
  if (!bannerHash) {
    return null;
  }
  return `https://cdn.discordapp.com/banners/${userId}/${bannerHash}.png?size=1024`;
}

/**
 * WHAT: Build higher resolution avatar URL for theme extraction.
 * WHY: Generate CDN URL for user's custom avatar at 256px for better color extraction.
 *
 * @param userId - Discord user ID
 * @param avatarHash - Avatar hash from Discord API
 * @returns Avatar CDN URL
 */
function getHighResAvatarUrl(userId: string, avatarHash: string | null | undefined): string {
  if (!avatarHash) {
    return getFallbackAvatarUrl(userId);
  }
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=256`;
}

/**
 * WHAT: Register user resolution API routes.
 * WHY: Expose user identity resolution to admin dashboard.
 *
 * @param fastify - Fastify instance
 */
export async function registerUsersRoutes(fastify: FastifyInstance) {
  // GET /api/users/@me - Get current authenticated user with assets
  fastify.get(
    "/api/users/@me",
    {
      preHandler: verifySession,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = request.session;

      if (!session?.user) {
        return reply.code(401).send({ error: "Not authenticated" });
      }

      const { id, username, avatar } = session.user;

      try {
        // Fetch user details from Discord to get banner and accent color
        const botToken = process.env.DISCORD_TOKEN;
        if (!botToken) {
          logger.error("[users] DISCORD_TOKEN not configured");
          return reply.code(500).send({ error: "Server configuration error" });
        }

        const response = await axios.get(`https://discord.com/api/v10/users/${id}`, {
          headers: { Authorization: `Bot ${botToken}` },
          timeout: 5000,
        });

        const discordUser = response.data;
        const avatarUrl = getHighResAvatarUrl(id, discordUser.avatar);
        const bannerUrl = getBannerUrl(id, discordUser.banner);

        // Add cache headers (15 minutes)
        reply.header("Cache-Control", "private, max-age=900");

        return {
          id,
          username: discordUser.username,
          global_name: discordUser.global_name || null,
          discriminator: discordUser.discriminator,
          avatar_url: avatarUrl,
          banner_url: bannerUrl,
          accent_color: discordUser.accent_color || null,
        };
      } catch (err: any) {
        if (err.response?.status === 404) {
          logger.warn({ userId: id }, "[users] user not found");
          return reply.code(404).send({ error: "User not found" });
        }
        logger.error({ err: err.message, userId: id }, "[users] Discord API error");
        return reply.code(500).send({ error: "Failed to fetch user data" });
      }
    }
  );

  // GET /api/users/resolve?guild_id=...&ids=123,456
  fastify.get(
    "/api/users/resolve",
    {
      preHandler: verifySession,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { guild_id, ids } = request.query as { guild_id?: string; ids?: string };

      if (!guild_id) {
        return reply.code(400).send({ error: "guild_id is required" });
      }

      if (!ids) {
        return reply.code(400).send({ error: "ids parameter is required" });
      }

      // Parse comma-separated IDs
      const userIds = ids
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 100); // Limit to 100 IDs per request

      if (userIds.length === 0) {
        return reply.code(400).send({ error: "At least one user ID is required" });
      }

      try {
        const items = await resolveUsers(guild_id, userIds);
        const cached = items.every((u) => u.fetched_at < new Date(Date.now() - 1000).toISOString());

        // Add cache headers
        reply.header("ETag", `"${guild_id}-${userIds.join(",")}-${items.length}"`);
        reply.header("Cache-Control", "private, max-age=30");
        reply.header("X-RateLimit-Remaining", rateLimiter.remaining().toString());

        return {
          items,
          cached,
          ttl_s: CACHE_TTL_SECONDS,
        };
      } catch (err) {
        logger.error({ err, guild_id, ids }, "[users] resolve failed");
        return reply.code(500).send({ error: "Failed to resolve users" });
      }
    }
  );
}
