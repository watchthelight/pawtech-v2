/**
 * Pawtropolis Tech — src/lib/constants.ts
 * WHAT: Centralized application constants for timeouts, delays, and limits
 * WHY: Single source of truth for magic numbers, improves maintainability
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { MessageMentionOptions } from "discord.js";

// ===== Discord Message Options =====

/**
 * Suppresses all @mentions in messages (users, roles, everyone/here)
 * USE CASE: Logs, audit trails, automated notifications that quote user content
 * WHY: Prevents accidental pings when echoing user input or displaying metadata
 */
export const SAFE_ALLOWED_MENTIONS: MessageMentionOptions = { parse: [] };

// ===== Discord API Rate Limits & Constraints =====

/** Discord bulk delete only works for messages < 14 days old */
export const DISCORD_BULK_DELETE_AGE_LIMIT_MS = 14 * 24 * 60 * 60 * 1000;

/** Discord command sync rate limit buffer (keeps us under 2 req/sec) */
export const DISCORD_COMMAND_SYNC_DELAY_MS = 650;

/** Maximum reason length for flag entries */
export const FLAG_REASON_MAX_LENGTH = 512;

/** Dadmode odds range bounds (min, max) */
export const DADMODE_ODDS_MIN = 2;
export const DADMODE_ODDS_MAX = 100000;

// ===== Timeouts & Delays =====

/** Health check timeout before aborting */
export const HEALTH_CHECK_TIMEOUT_MS = 5000;

/** Retry delay when Discord API returns "Unknown Message" (10008) */
export const DISCORD_RETRY_DELAY_MS = 2000;

/** Delay between individual message deletes to avoid rate limits */
export const MESSAGE_DELETE_BATCH_DELAY_MS = 1500;

/** Delay between bulk delete iterations */
export const BULK_DELETE_ITERATION_DELAY_MS = 1000;

/** Grace period before exit on uncaught exception (for Sentry flush) */
export const UNCAUGHT_EXCEPTION_EXIT_DELAY_MS = 1000;

/** Database recovery operation delay */
export const DB_RECOVERY_OPERATION_DELAY_MS = 5000;

/** Slow event warning threshold (30% of default 10s timeout) */
export const SLOW_EVENT_THRESHOLD_MS = 3000;

// ===== Time Unit Conversions =====

/** Milliseconds per second */
export const MS_PER_SECOND = 1000;

/** Seconds per minute */
export const SECONDS_PER_MINUTE = 60;

/** Seconds per hour */
export const SECONDS_PER_HOUR = 3600;

// ===== Feature-Specific Constants =====

/** Banner sync minimum update interval (prevents API hammering) */
export const BANNER_SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/** OAuth rate limit: max requests per minute for general endpoints */
export const OAUTH_RATE_LIMIT_MAX_REQUESTS = 10;

/** OAuth rate limit: max requests per 5 minutes for OAuth-specific endpoints */
export const OAUTH_RATE_LIMIT_MAX_OAUTH_REQUESTS = 5;

/** State token expiry for CSRF protection */
export const OAUTH_STATE_TOKEN_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/** Cleanup interval for rate limit stores */
export const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
