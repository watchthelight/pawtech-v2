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

// Security: Regex patterns for validating environment variables used in shell commands.
// These prevent command injection by restricting characters to safe alphanumeric patterns.
const SAFE_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const SAFE_PATH_REGEX = /^[a-zA-Z0-9_\-/.]+$/;

// Load .env from project root (current working directory)
// This works reliably whether bundled or not, as long as you run from project root
// override: true in production ensures .env values take precedence over stale shell environment
// override: false in tests allows test env vars to be set before imports
// GOTCHA: If you run the bot from a different directory, this will look for .env in the wrong place.
// Don't be clever with your working directory. Just run from project root.
const isTest = process.env.NODE_ENV === "test";
dotenv.config({ path: path.join(process.cwd(), ".env"), override: !isTest });

/**
 * Raw environment extraction. Every variable gets trimmed to handle
 * stray whitespace in .env files (copy-paste accidents are common).
 * We extract everything first, then validate in one pass via zod.
 */
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

  // Gate admin roles (optional, comma-separated role IDs)
  GATE_ADMIN_ROLE_IDS: process.env.GATE_ADMIN_ROLE_IDS?.trim(),

  // DB Recovery / PM2 process name for safe restarts
  PM2_PROCESS_NAME: process.env.PM2_PROCESS_NAME?.trim(),
  DB_BACKUPS_DIR: process.env.DB_BACKUPS_DIR?.trim(),

  // Operations Health & Monitoring (optional)
  HEALTH_ALERT_WEBHOOK: process.env.HEALTH_ALERT_WEBHOOK?.trim(),
  HEALTH_CHECK_INTERVAL_SECONDS: process.env.HEALTH_CHECK_INTERVAL_SECONDS?.trim(),
  QUEUE_BACKLOG_ALERT: process.env.QUEUE_BACKLOG_ALERT?.trim(),
  P95_RESPONSE_MS_ALERT: process.env.P95_RESPONSE_MS_ALERT?.trim(),
  WS_PING_MS_ALERT: process.env.WS_PING_MS_ALERT?.trim(),

  // Sync marker for local/remote database switching
  BOT_LOCATION: process.env.BOT_LOCATION?.trim(),

  // Linked Roles OAuth2 (for Server Developer badge)
  LINKED_ROLES_PORT: process.env.LINKED_ROLES_PORT?.trim(),
  LINKED_ROLES_REDIRECT_URI: process.env.LINKED_ROLES_REDIRECT_URI?.trim(),

  // Remote server SSH configuration (for database sync/recovery)
  REMOTE_ALIAS: process.env.REMOTE_ALIAS?.trim(),
  REMOTE_PATH: process.env.REMOTE_PATH?.trim(),

  // AI Detection APIs (optional - /isitreal command)
  HIVE_API_KEY: process.env.HIVE_API_KEY?.trim(),
  RAPIDAPI_KEY: process.env.RAPIDAPI_KEY?.trim(),
  SIGHTENGINE_API_USER: process.env.SIGHTENGINE_API_USER?.trim(),
  SIGHTENGINE_API_SECRET: process.env.SIGHTENGINE_API_SECRET?.trim(),
  OPTIC_API_KEY: process.env.OPTIC_API_KEY?.trim(),
};

/**
 * Schema defines what's required vs optional. Required secrets (TOKEN, CLIENT_ID,
 * RESET_PASSWORD) fail fast at startup rather than crashing later when first used.
 * Optional fields get sensible defaults where possible.
 */
const schema = z.object({
  // Core Discord credentials - bot won't start without these
  DISCORD_TOKEN: z.string().min(1, "Missing DISCORD_TOKEN"),
  CLIENT_ID: z.string().min(1, "Missing CLIENT_ID"),
  GUILD_ID: z.string().optional(), // Only needed for guild-specific command deployment
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DB_PATH: z.string().default("data/data.db"),

  // Sentry error tracking - disabled if DSN not provided
  // 0.1 default sample rate = 10% of transactions traced (saves quota in prod)
  // If you set this to 1.0, you WILL blow through your Sentry quota in a day. Ask me how I know.
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

  // Gate admin roles (optional, comma-separated role IDs)
  GATE_ADMIN_ROLE_IDS: z.string().optional(),

  // DB Recovery / PM2 process name for safe restarts
  // Security: Validated with regex to prevent command injection when used in shell commands
  PM2_PROCESS_NAME: z
    .string()
    .default("pawtropolis")
    .refine((val) => SAFE_NAME_REGEX.test(val), {
      message: "PM2_PROCESS_NAME contains invalid characters (only alphanumeric, underscore, hyphen allowed)",
    }),
  DB_BACKUPS_DIR: z
    .string()
    .default("data/backups")
    .refine((val) => SAFE_PATH_REGEX.test(val), {
      message: "DB_BACKUPS_DIR contains invalid characters",
    }),

  // Operations Health & Monitoring (optional)
  HEALTH_ALERT_WEBHOOK: z.string().optional(),
  HEALTH_CHECK_INTERVAL_SECONDS: z.string().optional(),
  QUEUE_BACKLOG_ALERT: z.string().optional(),
  P95_RESPONSE_MS_ALERT: z.string().optional(),
  WS_PING_MS_ALERT: z.string().optional(),

  // Sync marker for local/remote database switching
  // Values: 'local', 'remote', or custom hostname
  BOT_LOCATION: z.string().default("unknown"),

  // Linked Roles OAuth2 (for Server Developer badge)
  LINKED_ROLES_PORT: z.string().optional(),
  LINKED_ROLES_REDIRECT_URI: z.string().optional(),

  // Remote server SSH configuration (optional - for database sync/recovery)
  // Security: Validated with regex to prevent command injection when used in shell commands
  REMOTE_ALIAS: z
    .string()
    .optional()
    .refine((val) => !val || SAFE_NAME_REGEX.test(val), {
      message: "REMOTE_ALIAS contains invalid characters (only alphanumeric, underscore, hyphen allowed)",
    }),
  REMOTE_PATH: z
    .string()
    .optional()
    .refine((val) => !val || SAFE_PATH_REGEX.test(val), {
      message: "REMOTE_PATH contains invalid characters",
    }),

  // AI Detection APIs (optional - /isitreal command)
  HIVE_API_KEY: z.string().optional(),
  RAPIDAPI_KEY: z.string().optional(),
  SIGHTENGINE_API_USER: z.string().optional(),
  SIGHTENGINE_API_SECRET: z.string().optional(),
  OPTIC_API_KEY: z.string().optional(),
});

/**
 * Fail-fast validation. If required vars are missing, exit immediately with
 * clear error messages rather than letting the app limp along and fail randomly.
 * safeParse gives us all errors at once instead of one-at-a-time.
 * WHY safeParse and not parse? Because parse throws on first error.
 * safeParse collects ALL errors so you don't play whack-a-mole fixing one at a time.
 */
const parsed = schema.safeParse(raw);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
  console.error(`Environment validation failed:\n${issues}`);
  process.exit(1);
}
export const env = parsed.data;

/**
 * Boolean feature flags parsed separately. These read directly from process.env
 * rather than going through zod since they have trivial parsing logic and
 * default to "on" for backwards compat.
 */
// WHY not just use zod's coerce.boolean? Because people put weird stuff in .env files.
// "yes", "YES", "1", "true", "TRUE"... this regex handles all the reasonable ones.
// If someone puts "yaaas" they deserve what they get.
const truthyPattern = /^(1|true|yes|on)$/i;

// Controls whether avatar risk warnings appear in review UI. Defaults ON.
export const GATE_SHOW_AVATAR_RISK = truthyPattern.test(process.env.GATE_SHOW_AVATAR_RISK ?? "1");

// Bot location identifier for sync marker tracking
export const BOT_LOCATION = env.BOT_LOCATION;
