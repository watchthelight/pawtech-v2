/**
 * Pawtropolis Tech — src/lib/auditHelper.ts
 * WHAT: Safe wrappers for audit logging with consistent error handling.
 * WHY: Ensures audit trail failures are logged (not silently swallowed) while
 *      keeping audit operations non-blocking (fire-and-forget pattern).
 * FLOWS:
 *  - safeAuditLog: single attempt with warning on failure
 *  - safeAuditLogWithRetry: retries with exponential backoff before warning
 * DOCS:
 *  - Issue #88: Add logging for audit trail failures
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { logger } from "./logger.js";

/**
 * Context information for audit log operations.
 * Used to enrich warning logs when audit operations fail.
 */
export interface AuditContext {
  guildId?: string | null;
  userId?: string | null;
  [key: string]: unknown;
}

/**
 * safeAuditLog
 * WHAT: Wraps an audit log operation with consistent error handling.
 * WHY: Ensures audit failures are logged as warnings (not silent) while
 *      keeping the operation non-blocking.
 *
 * @param action - Identifier for the audit action (e.g., "send", "approve", "kick")
 * @param context - Contextual data for the log (guildId, userId, etc.)
 * @param logFn - The async function that performs the actual audit logging
 * @returns true if audit succeeded, false if it failed
 *
 * @example
 * ```ts
 * await safeAuditLog(
 *   "send",
 *   { guildId: interaction.guildId, userId: interaction.user.id },
 *   () => sendAuditLog(interaction, message, useEmbed, silent)
 * );
 * ```
 */
export async function safeAuditLog(
  action: string,
  context: AuditContext,
  logFn: () => Promise<void>
): Promise<boolean> {
  try {
    await logFn();
    return true;
  } catch (err) {
    logger.warn(
      {
        err,
        action,
        ...context,
      },
      "[audit] Failed to write audit log"
    );
    return false;
  }
}

/**
 * safeAuditLogWithRetry
 * WHAT: Wraps an audit log operation with retry logic for transient failures.
 * WHY: Network hiccups or rate limits can cause temporary failures. Retrying
 *      with backoff increases reliability without overloading Discord API.
 *
 * DESIGN:
 *  - Exponential backoff: 100ms, 200ms, 400ms (configurable base)
 *  - Only logs warning after all retries exhausted
 *  - Returns success/failure for callers who need to track reliability
 *
 * @param action - Identifier for the audit action
 * @param context - Contextual data for the log
 * @param logFn - The async function that performs the actual audit logging
 * @param maxRetries - Maximum retry attempts (default: 2, meaning 3 total attempts)
 * @param baseDelayMs - Base delay for exponential backoff (default: 100ms)
 * @returns true if audit succeeded, false if all attempts failed
 *
 * @example
 * ```ts
 * await safeAuditLogWithRetry(
 *   "approve",
 *   { guildId: guild.id, userId: member.id },
 *   () => logActionPretty(guild, { ... }),
 *   2  // 3 total attempts
 * );
 * ```
 */
export async function safeAuditLogWithRetry(
  action: string,
  context: AuditContext,
  logFn: () => Promise<void>,
  maxRetries = 2,
  baseDelayMs = 100
): Promise<boolean> {
  const totalAttempts = maxRetries + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      await logFn();
      return true;
    } catch (err) {
      if (attempt === totalAttempts) {
        // All retries exhausted - log warning
        logger.warn(
          {
            err,
            action,
            attempts: attempt,
            ...context,
          },
          "[audit] Failed to write audit log after retries"
        );
        return false;
      }

      // Exponential backoff before next attempt
      const delay = baseDelayMs * attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Unreachable, but TypeScript needs this
  return false;
}
