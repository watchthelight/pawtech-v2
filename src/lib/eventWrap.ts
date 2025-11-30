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

/**
 * Default timeout for event handlers.
 *
 * Discord.js events should generally complete quickly. 10 seconds provides
 * ample safety margin while catching genuinely slow handlers that need
 * investigation.
 *
 * Override via EVENT_TIMEOUT_MS environment variable or per-handler timeout
 * parameter if specific events need more time.
 */
const DEFAULT_EVENT_TIMEOUT_MS = parseInt(process.env.EVENT_TIMEOUT_MS ?? "10000", 10);

/**
 * Wrap an event handler with error protection
 *
 * @param eventName - Name of the event for logging
 * @param handler - The actual event handler function
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns Wrapped handler that catches and logs errors
 *
 * @example
 * ```ts
 * // Use default 10-second timeout
 * client.on("guildMemberAdd", wrapEvent("guildMemberAdd", async (member) => {
 *   await processNewMember(member);
 * }));
 *
 * // Override for slow operation
 * client.on("guildCreate", wrapEvent("guildCreate", async (guild) => {
 *   await syncCommandsToGuild(guild.id);
 * }, 20000)); // 20-second timeout
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
