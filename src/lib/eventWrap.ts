/**
 * Pawtropolis Tech — src/lib/eventWrap.ts
 * WHAT: Safe wrapper for Discord.js event handlers
 * WHY: Ensures events never crash the bot, always logged with error classification
 * FLOWS:
 *  - wrapEvent(name, handler) → wrapped handler that catches errors
 *  - Error classification applied to all caught errors
 *  - Sentry capture only for reportable errors
 * USAGE:
 *  import { wrapEvent } from "./eventWrap.js";
 *  client.on("guildMemberAdd", wrapEvent("guildMemberAdd", async (member) => { ... }));
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { logger } from "./logger.js";
import { captureException } from "./sentry.js";
import { classifyError, errorContext, shouldReportToSentry } from "./errors.js";

/**
 * Generic event handler type.
 *
 * Supports both sync and async handlers since Discord.js events can be either.
 * The unknown[] is intentionally loose - we don't want to constrain which
 * events can be wrapped.
 */
type EventHandler<T extends unknown[]> = (...args: T) => Promise<void> | void;

const DEFAULT_EVENT_TIMEOUT_MS = parseInt(process.env.EVENT_TIMEOUT_MS ?? "30000", 10);

/**
 * Wrap an event handler with error protection
 *
 * @param eventName - Name of the event for logging
 * @param handler - The actual event handler function
 * @returns Wrapped handler that catches and logs errors
 *
 * @example
 * ```ts
 * client.on("guildMemberAdd", wrapEvent("guildMemberAdd", async (member) => {
 *   await processNewMember(member);
 * }));
 * ```
 */
export function wrapEvent<T extends unknown[]>(
  eventName: string,
  handler: EventHandler<T>,
  timeoutMs: number = DEFAULT_EVENT_TIMEOUT_MS
): EventHandler<T> {
  // Return an async wrapper that will never throw. This is critical -
  // an unhandled rejection in an event handler can crash the process.
  return async (...args: T) => {
    try {
      await Promise.race([
        handler(...args),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`Event handler timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
    } catch (err) {
      const classified = classifyError(err);

      // Extract identifiers from common Discord.js event args for context.
      // This gives us guild/user/channel IDs in logs without the handler
      // having to pass them explicitly.
      const contextIds = extractEventContext(args);

      logger.error(
        {
          evt: "event_error",
          event: eventName,
          ...errorContext(classified, contextIds),
          err,
        },
        `[${eventName}] event handler failed: ${classified.message}`
      );

      // Only report to Sentry if it's worth tracking.
      // Most Discord operational errors (expired interactions, deleted channels)
      // are filtered out by shouldReportToSentry.
      if (shouldReportToSentry(classified)) {
        captureException(err instanceof Error ? err : new Error(String(err)), {
          event: eventName,
          errorKind: classified.kind,
          ...contextIds,
        });
      }

      // IMPORTANT: Never re-throw. The bot must keep running even if one event
      // handler fails. Unhandled promise rejections in event handlers can
      // terminate the process depending on Node.js version and flags.
    }
  };
}

/**
 * Wrap an event handler with error protection and timing.
 *
 * Use this variant for events where you want performance visibility.
 * The 5-second threshold is somewhat arbitrary - tune it based on your
 * typical event handling times.
 *
 * Note: Date.now() is sufficient for this use case. Performance.now()
 * would be more precise but we're measuring wall clock time anyway, and
 * the overhead of Date.now() is negligible compared to async I/O.
 */
export function wrapEventWithTiming<T extends unknown[]>(
  eventName: string,
  handler: EventHandler<T>,
  timeoutMs: number = DEFAULT_EVENT_TIMEOUT_MS
): EventHandler<T> {
  return async (...args: T) => {
    const startMs = Date.now();
    try {
      await Promise.race([
        handler(...args),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`Event handler timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
      const durationMs = Date.now() - startMs;

      // 5 seconds is a long time for an event handler. If you're hitting this
      // regularly, consider deferring expensive work to a background job.
      if (durationMs > 5000) {
        logger.warn(
          { evt: "slow_event", event: eventName, durationMs },
          `[${eventName}] event handler took ${durationMs}ms`
        );
      }
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const classified = classifyError(err);
      const contextIds = extractEventContext(args);

      logger.error(
        {
          evt: "event_error",
          event: eventName,
          durationMs,
          ...errorContext(classified, contextIds),
          err,
        },
        `[${eventName}] event handler failed after ${durationMs}ms: ${classified.message}`
      );

      if (shouldReportToSentry(classified)) {
        captureException(err instanceof Error ? err : new Error(String(err)), {
          event: eventName,
          errorKind: classified.kind,
          durationMs,
          ...contextIds,
        });
      }

      // Never re-throw - keep bot running
    }
  };
}

/**
 * Extract common identifiers from Discord.js event arguments.
 *
 * Discord.js event payloads are polymorphic - different events pass different
 * objects. This function probes for common properties (guildId, user, channelId)
 * that appear on many Discord structures. It's intentionally defensive; unknown
 * object shapes should not throw.
 *
 * The resulting context is attached to error logs and Sentry reports for
 * debugging. Having guild/user/channel IDs makes it much easier to reproduce
 * issues in specific servers.
 */
function extractEventContext(args: unknown[]): Record<string, unknown> {
  const context: Record<string, unknown> = {};

  for (const arg of args) {
    if (!arg || typeof arg !== "object") continue;

    // GuildMember, User, Message, Interaction, etc.
    const obj = arg as Record<string, unknown>;

    if ("guildId" in obj && typeof obj.guildId === "string") {
      context.guildId = obj.guildId;
    }
    if ("guild" in obj && obj.guild && typeof obj.guild === "object") {
      const guild = obj.guild as Record<string, unknown>;
      if ("id" in guild && typeof guild.id === "string") {
        context.guildId = guild.id;
      }
    }
    if ("id" in obj && typeof obj.id === "string") {
      // Don't overwrite guildId with a generic id
      if (!context.entityId) {
        context.entityId = obj.id;
      }
    }
    if ("user" in obj && obj.user && typeof obj.user === "object") {
      const user = obj.user as Record<string, unknown>;
      if ("id" in user && typeof user.id === "string") {
        context.userId = user.id;
      }
    }
    if ("channelId" in obj && typeof obj.channelId === "string") {
      context.channelId = obj.channelId;
    }
  }

  return context;
}

/**
 * Create a rate-limited event handler wrapper.
 *
 * This is a simple sliding window limiter. Use it for high-frequency events
 * like messageCreate where a spam attack could overwhelm the bot.
 *
 * IMPORTANT: This uses in-memory state, so:
 * 1. Limits are per-process, not global (fine for single-instance bots)
 * 2. Limits reset on restart
 * 3. No fairness guarantees - first N callers in the window win
 *
 * For more sophisticated rate limiting (per-user, per-guild, distributed),
 * you'd need Redis or similar.
 *
 * The rateLimitWarned flag prevents log spam - we only log once per window
 * even if we're dropping hundreds of events.
 */
export function wrapEventRateLimited<T extends unknown[]>(
  eventName: string,
  handler: EventHandler<T>,
  windowMs: number = 1000,
  maxPerWindow: number = 10
): EventHandler<T> {
  let invocations = 0;
  let windowStart = Date.now();
  let rateLimitWarned = false;

  return async (...args: T) => {
    const now = Date.now();

    // Reset window if expired
    if (now - windowStart > windowMs) {
      invocations = 0;
      windowStart = now;
      rateLimitWarned = false;
    }

    invocations++;

    // Rate limit exceeded - silently drop the event
    if (invocations > maxPerWindow) {
      if (!rateLimitWarned) {
        rateLimitWarned = true;
        logger.warn(
          { evt: "event_rate_limited", event: eventName, invocations, windowMs },
          `[${eventName}] event rate limited (${invocations} calls in ${windowMs}ms)`
        );
      }
      return; // Drop the event
    }

    // Delegate to wrapped handler with timeout
    return wrapEvent(eventName, handler, 1000)(...args);
  };
}
