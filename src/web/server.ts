/**
 * Pawtropolis Tech — src/web/server.ts
 * WHAT: Fastify-based web server for admin control panel.
 * WHY: Provides OAuth2-secured APIs and static site hosting.
 * FLOWS:
 *  - /auth/* → Discord OAuth2 authentication
 *  - /api/* → Protected API endpoints (logs, metrics, config)
 *  - /* → Static website files from ./website
 * DOCS:
 *  - Fastify: https://fastify.dev/docs/latest/
 *  - Discord OAuth2: https://discord.com/developers/docs/topics/oauth2
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifySession from "@fastify/session";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import { join } from "node:path";
import { logger } from "../lib/logger.js";
import { env } from "../lib/env.js";

/**
 * WHAT: Create and configure Fastify server instance.
 * WHY: Centralized server setup with all plugins and routes.
 *
 * @returns Configured Fastify instance
 */
export async function createWebServer() {
  // Trust proxy headers when behind reverse proxy (Apache/nginx)
  const trustProxy = process.env.TRUST_PROXY === "1" || process.env.NODE_ENV === "production";

  const fastify = Fastify({
    logger: false, // Use pino logger from lib/logger.ts
    trustProxy, // Trust X-Forwarded-* headers (for production proxies)
  });

  // Session secret (required for auth)
  const sessionSecret = process.env.FASTIFY_SESSION_SECRET || process.env.DISCORD_TOKEN;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("FASTIFY_SESSION_SECRET must be at least 32 characters");
  }

  // 1. Cookie support (required for sessions)
  await fastify.register(fastifyCookie);

  // 2. Session management
  await fastify.register(fastifySession, {
    secret: sessionSecret,
    cookie: {
      secure: process.env.NODE_ENV === "production", // HTTPS-only in prod
      httpOnly: true,
      maxAge: 6 * 60 * 60 * 1000, // 6 hours
      sameSite: "lax",
    },
    saveUninitialized: false,
    rolling: true, // Extend session on activity
  });

  // 3. CORS (allow frontend origin)
  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
    : process.env.NODE_ENV === "production"
      ? ["https://pawtropolis.tech", "https://www.pawtropolis.tech"]
      : true; // Allow all in dev

  await fastify.register(fastifyCors, {
    origin: corsOrigin,
    credentials: true,
  });

  // 4. Rate limiting (prevent abuse)
  await fastify.register(fastifyRateLimit, {
    max: 100, // 100 requests
    timeWindow: "1 minute",
  });

  // 5. Static file serving for website
  const websitePath = join(process.cwd(), "website");
  await fastify.register(fastifyStatic, {
    root: websitePath,
    prefix: "/", // Serve at root
    // SPA fallback handled separately
    setHeaders: (res, path) => {
      // Aggressive no-cache for .js and .css files to prevent CloudFlare caching issues
      if (path.endsWith(".js") || path.endsWith(".css")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    },
  });

  // Health check endpoint (public - no auth required)
  const startTime = Date.now();
  fastify.get("/health", async () => {
    const uptime_s = Math.floor((Date.now() - startTime) / 1000);
    return {
      ok: true,
      version: "1.1.0",
      service: "pawtropolis-web",
      uptime_s,
      timestamp: new Date().toISOString(),
    };
  });

  // Register auth routes
  const { registerAuthRoutes } = await import("./auth.js");
  await registerAuthRoutes(fastify);

  // Register API routes
  const { registerApiRoutes } = await import("./api/index.js");
  await registerApiRoutes(fastify);

  // SPA fallback: serve index.html for all unmatched routes
  // (Must be last to allow other routes to take precedence)
  fastify.setNotFoundHandler(async (request, reply) => {
    // Only serve index.html for browser navigation, not API 404s
    if (request.url.startsWith("/api/") || request.url.startsWith("/auth/")) {
      return reply.code(404).send({ error: "Not found" });
    }

    // Serve index.html for SPA routing
    return reply.sendFile("index.html");
  });

  return fastify;
}

/**
 * WHAT: Start web server on specified port.
 * WHY: Entry point for web control panel.
 *
 * @param port - Port number (default: 3000)
 * @returns Fastify server instance
 */
export async function startWebServer(port: number = 3000) {
  const fastify = await createWebServer();

  try {
    await fastify.listen({ port, host: "0.0.0.0" });
    logger.info({ port }, "[web] server started");
    return fastify;
  } catch (err) {
    logger.error({ err }, "[web] failed to start server");
    throw err;
  }
}
