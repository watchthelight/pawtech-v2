/**
 * Pawtropolis Tech — src/lib/env.ts
 * WHAT: Environment loading/validation via dotenv + zod.
 * WHY: Fail-fast on missing secrets; keep process.env access centralized.
 * FLOWS: load .env → parse/validate → export typed env object
 * DOCS:
 *  - Node ESM: https://nodejs.org/api/esm.html
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: LicenseRef-ANW-1.0
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */

import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";

// Load .env from project root (current working directory)
// This works reliably whether bundled or not, as long as you run from project root
// override: true in production ensures .env values take precedence over stale shell environment
// override: false in tests allows test env vars to be set before imports
const isTest = process.env.NODE_ENV === "test";
dotenv.config({ path: path.join(process.cwd(), ".env"), override: !isTest });

const raw = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN?.trim(),
  CLIENT_ID: process.env.CLIENT_ID?.trim(),
  GUILD_ID: process.env.GUILD_ID?.trim(),
  NODE_ENV: process.env.NODE_ENV?.trim(),
  DB_PATH: process.env.DB_PATH?.trim(),
  SENTRY_DSN: process.env.SENTRY_DSN?.trim(),
  SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT?.trim(),
  SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE?.trim(),
  LOG_LEVEL: process.env.LOG_LEVEL?.trim(),
  TEST_GUILD_ID: process.env.TEST_GUILD_ID?.trim(),
  TEST_REVIEWER_ROLE_ID: process.env.TEST_REVIEWER_ROLE_ID?.trim(),
  RESET_PASSWORD: process.env.RESET_PASSWORD?.trim(),
  OWNER_IDS: process.env.OWNER_IDS?.trim(),

  // PR6: Web Control Panel OAuth2 (optional - only needed for web server)
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID?.trim(),
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET?.trim(),
  DASHBOARD_REDIRECT_URI: process.env.DASHBOARD_REDIRECT_URI?.trim(),
  ADMIN_ROLE_ID: process.env.ADMIN_ROLE_ID?.trim(),
  FASTIFY_SESSION_SECRET: process.env.FASTIFY_SESSION_SECRET?.trim(),
  DASHBOARD_PORT: process.env.DASHBOARD_PORT?.trim(),

  // Manual flag alerts (optional)
  FLAGGED_REPORT_CHANNEL_ID: process.env.FLAGGED_REPORT_CHANNEL_ID?.trim(),
};

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, "Missing DISCORD_TOKEN"),
  CLIENT_ID: z.string().min(1, "Missing CLIENT_ID"),
  GUILD_ID: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DB_PATH: z.string().default("data/data.db"),

  // Sentry error tracking (optional)
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // Optional log level
  LOG_LEVEL: z.string().optional(),

  // Seed-only helpers (optional at runtime)
  TEST_GUILD_ID: z.string().optional(),
  TEST_REVIEWER_ROLE_ID: z.string().optional(),

  // Reset password (required)
  RESET_PASSWORD: z.string().min(1, "RESET_PASSWORD is required"),

  // Owner override (optional, comma-separated user IDs)
  OWNER_IDS: z.string().optional(),

  // PR6: Web Control Panel OAuth2 (optional - only needed when running web server)
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DASHBOARD_REDIRECT_URI: z.string().optional(),
  ADMIN_ROLE_ID: z.string().optional(),
  FASTIFY_SESSION_SECRET: z.string().optional(),
  DASHBOARD_PORT: z.string().optional(),

  // Manual flag alerts (optional)
  FLAGGED_REPORT_CHANNEL_ID: z.string().optional(),
});

const parsed = schema.safeParse(raw);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
  console.error(`Environment validation failed:\n${issues}`);
  process.exit(1);
}
export const env = parsed.data;

const truthyPattern = /^(1|true|yes|on)$/i;

export const GATE_SHOW_AVATAR_RISK = truthyPattern.test(process.env.GATE_SHOW_AVATAR_RISK ?? "1");
