/**
 * Pawtropolis Tech — src/web/api/index.ts
 * WHAT: Register all API routes for web control panel.
 * WHY: Centralized API registration.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { registerLogsRoutes } from "./logs.js";
import { registerMetricsRoutes } from "./metrics.js";
import { registerConfigRoutes } from "./config.js";
import { registerUsersRoutes } from "./users.js";
import { registerAdminRoutes } from "./admin.js";
import { registerGuildRoutes } from "./guild.js";
import { registerRolesRoutes } from "./roles.js";
import { registerBannerRoutes } from "./banner.js";

/**
 * WHAT: Register all API routes.
 * WHY: Mount protected endpoints under /api prefix.
 *
 * @param fastify - Fastify instance
 */
export async function registerApiRoutes(fastify: FastifyInstance) {
  await registerLogsRoutes(fastify);
  await registerMetricsRoutes(fastify);
  await registerConfigRoutes(fastify);
  await registerUsersRoutes(fastify);
  await registerAdminRoutes(fastify);
  await registerGuildRoutes(fastify);
  await registerRolesRoutes(fastify);
  await registerBannerRoutes(fastify); // Public banner endpoint
}
