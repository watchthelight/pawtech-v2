/**
 * Pawtropolis Tech — src/lib/eventWrap.ts
 * WHAT: Safe wrapper for Discord.js event handlers with wide event telemetry
 * WHY: Ensures events never crash the bot, emits comprehensive wide events for observability
 * FLOWS:
 *  - wrapEvent(name, handler) → create WideEvent → execute → emit on completion
 *  - Error classification and Sentry reporting for real errors
 * USAGE:
 *  import { wrapEvent } from "./eventWrap.js";
 *  client.on("guildMemberAdd", wrapEvent("guildMemberAdd", async (member) => { ... }));
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { logger } from "./logger.js";
import { captureException } from "./sentry.js";
import { classifyError, errorContext, shouldReportToSentry } from "./errors.js";
import { newTraceId, runWithCtx } from "./reqctx.js";
import { WideEventBuilder } from "./wideEvent.js";
import { emitWideEvent } from "./wideEventEmitter.js";

/**
 * Generic event handler type.
 * Supports both sync and async handlers since Discord.js events can be either.
 */
type EventHandler<T extends unknown[]> = (...args: T) => Promise<void> | void;

/**
 * Default timeout for event handlers.
 * Discord.js events should generally complete quickly. 10 seconds provides
 * ample safety margin while catching genuinely slow handlers.
 */
const DEFAULT_EVENT_TIMEOUT_MS = parseInt(process.env.EVENT_TIMEOUT_MS ?? "10000", 10);

/**
 * Infer the feature from an event name.
 * Used to set the feature field in wide events.
 */
function inferFeatureFromEvent(eventName: string): string | null {
  // Map common events to features
  const eventFeatureMap: Record<string, string> = {
    guildMemberAdd: "gate",
    guildMemberUpdate: "member",
    messageCreate: "message",
    messageDelete: "message",
    messageUpdate: "message",
    interactionCreate: "interaction",
    guildCreate: "guild",
    guildDelete: "guild",
    userUpdate: "user",
    presenceUpdate: "presence",
  };

  return eventFeatureMap[eventName] ?? null;
}

/**
 * Wrap an event handler with error protection and wide event telemetry.
 *
 * @param eventName - Name of the event for logging
 * @param handler - The actual event handler function
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns Wrapped handler that catches/logs errors and emits wide events
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
  return async (...args: T) => {
    const traceId = newTraceId();
    const wideEvent = new WideEventBuilder(traceId);

    // Set interaction context for event
    wideEvent.setInteraction({
      kind: "event",
      command: eventName,
    });

    // Extract context from event args
    const contextIds = extractEventContext(args);
    if (contextIds.guildId) {
      wideEvent.addAttr("guildId", contextIds.guildId);
    }
    if (contextIds.userId) {
      wideEvent.addAttr("userId", contextIds.userId);
    }
    if (contextIds.channelId) {
      wideEvent.addAttr("channelId", contextIds.channelId);
    }
    if (contextIds.entityId) {
      wideEvent.addAttr("entityId", contextIds.entityId);
    }

    // Set feature based on event name
    const feature = inferFeatureFromEvent(eventName);
    if (feature) {
      wideEvent.setFeature(feature, eventName);
    }

    // Mark entering the handler
    wideEvent.enterPhase("handler");

    try {
      // Run handler within context that carries the wide event
      await runWithCtx({ traceId, kind: "event", wideEvent }, async () => {
        await Promise.race([
          handler(...args),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`Event handler timeout after ${timeoutMs}ms`)), timeoutMs)
          ),
        ]);
      });

      // Success
      wideEvent.setOutcome("success");
      emitWideEvent(wideEvent.finalize());
    } catch (err) {
      const classified = classifyError(err);

      // Check if this is a timeout
      const isTimeout = err instanceof Error && err.message.includes("timeout after");
      if (isTimeout) {
        wideEvent.setOutcome("timeout");
      }

      // Set error on wide event
      let sentryEventId: string | null = null;

      // Report to Sentry if worth tracking
      if (shouldReportToSentry(classified)) {
        sentryEventId = captureException(err instanceof Error ? err : new Error(String(err)), {
          event: eventName,
          traceId,
          errorKind: classified.kind,
          ...contextIds,
        });
      }

      wideEvent.setError(classified, { phase: "handler", sentryEventId });

      // Emit the wide event (errors are always kept)
      emitWideEvent(wideEvent.finalize());

      // IMPORTANT: Never re-throw. The bot must keep running even if one event
      // handler fails. Unhandled promise rejections can terminate the process.
    }
  };
}

/**
 * Extract common identifiers from Discord.js event arguments.
 *
 * Discord.js event payloads are polymorphic - different events pass different
 * objects. This function probes for common properties (guildId, user, channelId)
 * that appear on many Discord structures.
 */
function extractEventContext(args: unknown[]): Record<string, unknown> {
  const context: Record<string, unknown> = {};

  for (const arg of args) {
    if (!arg || typeof arg !== "object") continue;

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

// Re-export for convenience
export { extractEventContext };
