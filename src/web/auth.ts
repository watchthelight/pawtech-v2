/**
 * Pawtropolis Tech — src/web/auth.ts
 * WHAT: Discord OAuth2 authentication + role-based authorization.
 * WHY: Secure admin-only access to control panel APIs.
 * FLOWS:
 *  - /auth/login → redirects to Discord OAuth2
 *  - /auth/callback → exchanges code for user + checks roles
 *  - /auth/logout → clears session
 *  - /auth/me → returns current user info
 * DOCS:
 *  - Discord OAuth2: https://discord.com/developers/docs/topics/oauth2
 *  - Discord API: https://discord.com/developers/docs/resources/user
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import axios from "axios";
import { logger } from "../lib/logger.js";

/**
 * Discord user shape from OAuth2
 */
interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  email?: string;
}

/**
 * Discord guild member shape
 */
interface DiscordGuildMember {
  user: DiscordUser;
  roles: string[];
  nick?: string;
}

/**
 * Session user data
 */
export interface SessionUser {
  id: string;
  username: string;
  avatar: string | null;
  roles: string[];
  isAdmin: boolean;
}

/**
 * Augment Fastify session with user data
 */
declare module "fastify" {
  interface Session {
    user?: SessionUser;
  }
}

/**
 * WHAT: Build Discord OAuth2 authorization URL.
 * WHY: Redirect user to Discord for authentication.
 *
 * @returns OAuth2 URL
 */
function getOAuthUrl(): string {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DASHBOARD_REDIRECT_URI || "http://localhost:3000/auth/callback";
  const scopes = ["identify", "guilds.members.read"];

  const params = new URLSearchParams({
    client_id: clientId!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
  });

  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

/**
 * WHAT: Exchange OAuth2 code for access token.
 * WHY: Obtain user credentials from Discord.
 *
 * @param code - OAuth2 authorization code
 * @returns Access token and token type
 */
async function exchangeCode(code: string): Promise<{ access_token: string; token_type: string }> {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DASHBOARD_REDIRECT_URI || "http://localhost:3000/auth/callback";

  const params = new URLSearchParams({
    client_id: clientId!,
    client_secret: clientSecret!,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  try {
    const response = await axios.post("https://discord.com/api/oauth2/token", params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    return response.data;
  } catch (err: any) {
    logger.error({ err: err.response?.data || err.message }, "[auth] token exchange failed");
    throw new Error("Failed to exchange OAuth2 code");
  }
}

/**
 * WHAT: Fetch Discord user info from API.
 * WHY: Get user identity for session.
 *
 * @param accessToken - Discord access token
 * @returns Discord user object
 */
async function getDiscordUser(accessToken: string): Promise<DiscordUser> {
  try {
    const response = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    return response.data;
  } catch (err: any) {
    logger.error({ err: err.response?.data || err.message }, "[auth] fetch user failed");
    throw new Error("Failed to fetch user info");
  }
}

/**
 * WHAT: Fetch user's guild member info (roles).
 * WHY: Verify admin role for authorization.
 *
 * @param accessToken - Discord access token
 * @param guildId - Discord guild ID
 * @param userId - Discord user ID
 * @returns Guild member object with roles
 */
async function getGuildMember(
  accessToken: string,
  guildId: string,
  userId: string
): Promise<DiscordGuildMember> {
  try {
    // Use bot token for guild member lookup (more reliable)
    const botToken = process.env.DISCORD_TOKEN;
    const response = await axios.get(
      `https://discord.com/api/guilds/${guildId}/members/${userId}`,
      {
        headers: { Authorization: `Bot ${botToken}` },
      }
    );

    return response.data;
  } catch (err: any) {
    logger.error(
      { err: err.response?.data || err.message, guildId, userId },
      "[auth] fetch member failed"
    );
    throw new Error("Failed to fetch guild member");
  }
}

/**
 * WHAT: Check if user has admin role or is owner.
 * WHY: Enforce role-based access control with owner override.
 *
 * @param userId - User's Discord ID
 * @param roles - User's role IDs
 * @returns True if user is admin or owner
 */
function isAdmin(userId: string, roles: string[]): boolean {
  // Check owner IDs first (highest priority)
  const ownerIds = (process.env.OWNER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (ownerIds.includes(userId)) {
    logger.info({ userId }, "[auth] owner access granted");
    return true;
  }

  // Check admin role IDs
  const adminRoles = (process.env.ADMIN_ROLE_ID || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (adminRoles.length === 0) {
    logger.warn("[auth] ADMIN_ROLE_ID not configured - denying access");
    return false;
  }

  return roles.some((roleId) => adminRoles.includes(roleId));
}

/**
 * WHAT: Register auth routes on Fastify instance.
 * WHY: Expose OAuth2 login/callback/logout endpoints.
 *
 * @param fastify - Fastify instance
 */
export async function registerAuthRoutes(fastify: FastifyInstance) {
  // GET /auth/login → redirect to Discord OAuth2
  fastify.get("/auth/login", async (request, reply) => {
    const oauthUrl = getOAuthUrl();
    logger.info("[auth] redirecting to Discord OAuth2");
    return reply.redirect(oauthUrl);
  });

  // GET /auth/callback → handle OAuth2 callback
  fastify.get("/auth/callback", async (request, reply) => {
    const { code, error } = request.query as { code?: string; error?: string };

    // Handle OAuth2 errors
    if (error) {
      logger.warn({ error }, "[auth] OAuth2 error");
      return reply.code(401).send({ error: "OAuth2 authorization failed" });
    }

    if (!code) {
      return reply.code(400).send({ error: "Missing authorization code" });
    }

    try {
      // Exchange code for token
      const { access_token } = await exchangeCode(code);

      // Fetch user info
      const user = await getDiscordUser(access_token);

      // Fetch guild member info (roles)
      const guildId = process.env.GUILD_ID || process.env.DISCORD_GUILD_ID;
      if (!guildId) {
        logger.error("[auth] GUILD_ID not configured");
        return reply.code(500).send({ error: "Server misconfiguration" });
      }

      const member = await getGuildMember(access_token, guildId, user.id);

      // Check admin role or owner
      const userIsAdmin = isAdmin(user.id, member.roles);
      if (!userIsAdmin) {
        logger.warn(
          { userId: user.id, username: user.username },
          "[auth] non-admin/non-owner login attempt"
        );
        return reply.redirect("/unauthorized.html");
      }

      // Store user in session
      request.session.user = {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        roles: member.roles,
        isAdmin: true,
      };

      logger.info({ userId: user.id, username: user.username }, "[auth] admin login successful");

      // Redirect to admin panel
      return reply.redirect("/admin/");
    } catch (err) {
      logger.error({ err }, "[auth] callback handler failed");
      return reply.code(500).send({ error: "Authentication failed" });
    }
  });

  // GET /auth/logout → clear session
  fastify.get("/auth/logout", async (request, reply) => {
    const userId = request.session.user?.id;

    // Clear session data
    request.session.user = undefined;

    logger.info({ userId }, "[auth] user logged out");

    return reply.redirect("/");
  });

  // GET /auth/me → current user info
  fastify.get("/auth/me", async (request, reply) => {
    if (!request.session.user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    return {
      user: request.session.user,
    };
  });
}

/**
 * WHAT: Middleware to verify session + admin role.
 * WHY: Protect API routes from unauthorized access.
 *
 * @param request - Fastify request
 * @param reply - Fastify reply
 */
export async function verifySession(request: FastifyRequest, reply: FastifyReply) {
  if (!request.session.user) {
    return reply.code(401).send({ error: "Unauthorized - login required" });
  }

  if (!request.session.user.isAdmin) {
    return reply.code(403).send({ error: "Forbidden - admin role required" });
  }
}
