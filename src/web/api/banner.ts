/**
 * Pawtropolis Tech — src/web/api/banner.ts
 * WHAT: API endpoint to serve current Discord server banner URL
 * WHY: Allows website to dynamically display server banner without auth
 * FLOWS:
 *  - GET /api/banner → returns current guild banner URL from cache
 * DOCS:
 *  - Fastify routes: https://fastify.dev/docs/latest/Reference/Routes/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { getCurrentBannerURL } from "../../features/bannerSync.js";
import { logger } from "../../lib/logger.js";

/**
 * registerBannerRoutes
 * WHAT: Registers /api/banner endpoint
 * WHY: Public endpoint for website to fetch current server banner
 * PARAMS:
 *  - fastify: Fastify instance
 * RETURNS: Promise<void>
 */
export async function registerBannerRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/banner
   * WHAT: Returns current guild banner URL
   * WHY: Website needs banner URL without requiring authentication
   * RETURNS: { banner_url: string | null }
   */
  fastify.get("/api/banner", async (request, reply) => {
    try {
      const bannerURL = getCurrentBannerURL();

      return {
        banner_url: bannerURL,
        cached_at: new Date().toISOString(),
      };
    } catch (err) {
      logger.error({ err }, "Failed to fetch banner URL");
      reply.code(500);
      return { error: "Failed to fetch banner" };
    }
  });
}
