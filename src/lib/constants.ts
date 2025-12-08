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

/** Maximum reason length for moderation actions (kick, reject, etc.) */
export const MAX_REASON_LENGTH = 512;

/** Dadmode odds range bounds (min, max) */
export const DADMODE_ODDS_MIN = 2;
export const DADMODE_ODDS_MAX = 100000;

/** Skullmode odds range bounds (min, max) */
export const SKULLMODE_ODDS_MIN = 1;
export const SKULLMODE_ODDS_MAX = 1000;

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

// ===== Feature-Specific Constants =====

/** OAuth rate limit: max requests per minute for general endpoints */
export const OAUTH_RATE_LIMIT_MAX_REQUESTS = 10;
