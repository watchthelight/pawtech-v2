/**
 * Pawtropolis Tech — src/lib/errorCardV2.ts
 * WHAT: Redesigned error cards with severity-based colors and rich context from wide events
 * WHY: Users deserve clear, actionable feedback when commands fail. Staff need context to debug.
 * FLOWS:
 *  - getErrorSeverity() → color selection
 *  - getExplanation() → human-readable error description
 *  - formatExecutionPath() → visual phase timeline
 *  - postErrorCardV2() → build and send embed
 * DOCS:
 *  - Wide Events: https://loggingsucks.com
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
} from "discord.js";
import { logger, redact } from "./logger.js";
import { replyOrEdit } from "./cmdWrap.js";
import { ctx as reqCtx } from "./reqctx.js";
import type { WideEvent, WideEventError, PhaseRecord } from "./wideEvent.js";
import type { ClassifiedError, ErrorKind } from "./errors.js";

// ===== Severity System =====

type ErrorSeverity = "critical" | "warning" | "info";

/** Severity color palette */
const SEVERITY_COLORS = {
  critical: 0xed4245, // Red - DB errors, unhandled exceptions
  warning: 0xffa500, // Orange - Discord API errors, timeouts
  info: 0x5865f2, // Blurple - Validation, permission issues
} as const;

/** Severity emoji for titles */
const SEVERITY_EMOJI = {
  critical: "\u274C", // Red X
  warning: "\u26A0\uFE0F", // Warning sign
  info: "\u2139\uFE0F", // Info
} as const;

/**
 * Determine error severity based on error kind and recoverability.
 */
function getErrorSeverity(error: WideEventError | null, errorKind?: ErrorKind): ErrorSeverity {
  const kind = error?.kind ?? errorKind;

  if (!kind) return "warning";

  switch (kind) {
    // Critical: These are bugs or data integrity issues
    case "db_error":
      return "critical";
    case "unknown":
      return "critical";

    // Warning: Operational issues, external failures
    case "discord_api":
      // Non-retriable Discord errors are more serious
      if (error && !error.isRetriable) return "warning";
      return "info";
    case "network":
      return "warning";

    // Info: User errors or expected failures
    case "validation":
      return "info";
    case "permission":
      return "info";
    case "config":
      return "warning";

    default:
      return "warning";
  }
}

// ===== Human-Readable Explanations =====

/**
 * Get a human-readable explanation for the error.
 * These are shown to users - keep them friendly but informative.
 */
function getExplanation(error: WideEventError | null, rawMessage?: string): string {
  if (!error) {
    return rawMessage
      ? `An error occurred: ${redact(rawMessage).slice(0, 150)}`
      : "An unexpected error occurred. Please try again.";
  }

  const { kind, code, message, isRetriable } = error;

  switch (kind) {
    case "db_error":
      if (String(code) === "SQLITE_BUSY") {
        return "The database is temporarily busy. Please try again in a moment.";
      }
      if (String(code).includes("CONSTRAINT")) {
        return "This action conflicts with existing data. The operation may have already been completed.";
      }
      return "A database error occurred. This has been logged for investigation.";

    case "discord_api":
      // Common Discord error codes with user-friendly explanations
      if (code === 10062) {
        return "This interaction expired before the bot could respond. Discord gives us 3 seconds - please try again.";
      }
      if (code === 40060) {
        return "The bot tried to respond twice to this interaction. This is usually harmless.";
      }
      if (code === 50013) {
        return "The bot doesn't have permission to perform this action in this channel.";
      }
      if (code === 50001) {
        return "The bot can't access this channel. Check channel permissions.";
      }
      if (code === 10008) {
        return "The message was deleted before the bot could act on it.";
      }
      if (code === 10003) {
        return "The channel was deleted or is no longer accessible.";
      }
      return isRetriable
        ? "Discord is having issues. Please try again shortly."
        : `Discord API error (${code}): ${redact(message).slice(0, 100)}`;

    case "validation":
      return `Invalid input: ${redact(message).slice(0, 150)}`;

    case "permission":
      return "You don't have permission to perform this action.";

    case "network":
      return "Network error - Discord may be experiencing issues. Please try again.";

    case "config":
      return "There's a configuration issue with the bot. Please contact staff.";

    case "unknown":
    default:
      return "An unexpected error occurred. This has been logged and staff have been notified.";
  }
}

// ===== Execution Path Formatting =====

/**
 * Format execution phases into a visual path.
 * Shows: enter -> validate -> claim -> X update
 * The X marks where the error occurred.
 */
function formatExecutionPath(phases: PhaseRecord[], failedPhase?: string): string {
  if (phases.length === 0) return "No execution data";

  return phases
    .map((p) => {
      const isFailed = p.name === failedPhase;
      return isFailed ? `\u274C ${p.name}` : p.name;
    })
    .join(" \u2192 ");
}

/**
 * Format phases with timing for detailed view.
 */
function formatPhasesWithTiming(phases: PhaseRecord[]): string {
  if (phases.length === 0) return "No timing data";

  return phases
    .map((p) => {
      const timing = p.durationMs !== null ? `${p.durationMs}ms` : "...";
      return `${p.name} (${timing})`;
    })
    .join(" \u2192 ");
}

// ===== SQL Formatting =====

/**
 * Truncate and clean SQL for display.
 */
function truncateSql(sql: string | null | undefined): string {
  if (!sql) return "n/a";
  const cleaned = sql.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 120) return `\`${cleaned}\``;
  return `\`${cleaned.slice(0, 120)}...\``;
}

// ===== User Context Formatting =====

/**
 * Format user context as a compact string.
 */
function formatUserContext(event: WideEvent): string {
  const parts: string[] = [];

  if (event.isOwner) parts.push("Owner");
  else if (event.isAdmin) parts.push("Admin");
  else if (event.isStaff) parts.push("Staff");
  else parts.push("Member");

  if (event.userRoles.length > 0) {
    parts.push(`${event.userRoles.length} roles`);
  }

  return parts.join(" \u2022 ");
}

// ===== Main Export =====

type ReplyCapableInteraction =
  | ChatInputCommandInteraction
  | ModalSubmitInteraction
  | ButtonInteraction;

export interface ErrorCardV2Details {
  /** The finalized wide event (required) */
  wideEvent: WideEvent;
  /** The classified error (for additional context) */
  classified?: ClassifiedError;
  /** Sentry event ID if error was reported */
  sentryEventId?: string | null;
}

/**
 * Post a redesigned error card with rich context from the wide event.
 *
 * Features:
 * - Severity-based colors (critical/warning/info)
 * - Human-readable explanations
 * - Execution path visualization
 * - Database query context
 * - User context summary
 * - Compact trace ID for support
 */
export async function postErrorCardV2(
  interaction: ReplyCapableInteraction,
  details: ErrorCardV2Details
): Promise<void> {
  const { wideEvent, classified, sentryEventId } = details;
  const error = wideEvent.error;

  // Determine severity and styling
  const severity = getErrorSeverity(error, classified?.kind);
  const color = SEVERITY_COLORS[severity];
  const emoji = SEVERITY_EMOJI[severity];

  // Build the embed
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} Command Failed`)
    .setTimestamp();

  // === Section 1: What Happened ===
  const explanation = getExplanation(error, classified?.message);
  embed.setDescription(explanation);

  // === Section 2: Execution Path ===
  if (wideEvent.phases.length > 0) {
    const path = formatExecutionPath(wideEvent.phases, error?.phase);
    const timing = `Duration: ${wideEvent.durationMs}ms`;
    embed.addFields({
      name: "\uD83D\uDCCD Execution Path",
      value: `${path}\n${timing}`,
      inline: false,
    });
  }

  // === Section 3: Database Context (if queries were made) ===
  if (wideEvent.queries.length > 0) {
    const dbSummary = `${wideEvent.queries.length} queries, ${wideEvent.totalDbTimeMs}ms total`;
    const lastSql = error?.lastSql ? `\nFailed: ${truncateSql(error.lastSql)}` : "";
    embed.addFields({
      name: "\uD83D\uDDC4\uFE0F Database",
      value: `${dbSummary}${lastSql}`,
      inline: true,
    });
  }

  // === Section 4: User Context ===
  const userCtx = formatUserContext(wideEvent);
  embed.addFields({
    name: "\uD83D\uDC64 Your Context",
    value: userCtx,
    inline: true,
  });

  // === Section 5: Error Details (for staff debugging) ===
  if (error) {
    const errorCode = error.code ? `Code: ${error.code}` : "";
    const errorKind = `Type: ${error.kind}`;
    const retriable = error.isRetriable ? "Retriable: Yes" : "";
    const details = [errorKind, errorCode, retriable].filter(Boolean).join(" \u2022 ");
    embed.addFields({
      name: "\uD83D\uDD27 Technical Details",
      value: details,
      inline: false,
    });
  }

  // === Footer: Trace ID ===
  const traceInfo = sentryEventId
    ? `Trace: ${wideEvent.traceId} | Sentry: ${sentryEventId.slice(0, 8)}`
    : `Trace: ${wideEvent.traceId}`;
  embed.setFooter({
    text: `${traceInfo} | Report this ID to staff if needed`,
  });

  // Send the error card (public so staff can see if user asks for help)
  try {
    await replyOrEdit(interaction, { embeds: [embed] });
  } catch (err) {
    const code = (err as { code?: unknown })?.code;

    // 10062 = interaction expired - expected in race conditions
    if (code === 10062) {
      logger.warn(
        { err, traceId: wideEvent.traceId, evt: "error_card_v2_expired" },
        "error card skipped; interaction expired"
      );
      return;
    }

    // Any other failure to deliver
    logger.error(
      { err, traceId: wideEvent.traceId, evt: "error_card_v2_fail" },
      "failed to deliver error card v2"
    );
  }
}

/**
 * Build an error card embed without sending (for testing or custom handling).
 */
export function buildErrorCardEmbed(details: ErrorCardV2Details): EmbedBuilder {
  const { wideEvent, classified, sentryEventId } = details;
  const error = wideEvent.error;

  const severity = getErrorSeverity(error, classified?.kind);
  const color = SEVERITY_COLORS[severity];
  const emoji = SEVERITY_EMOJI[severity];

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} Command Failed`)
    .setDescription(getExplanation(error, classified?.message))
    .setTimestamp();

  if (wideEvent.phases.length > 0) {
    embed.addFields({
      name: "\uD83D\uDCCD Execution Path",
      value: `${formatExecutionPath(wideEvent.phases, error?.phase)}\nDuration: ${wideEvent.durationMs}ms`,
      inline: false,
    });
  }

  if (wideEvent.queries.length > 0) {
    embed.addFields({
      name: "\uD83D\uDDC4\uFE0F Database",
      value: `${wideEvent.queries.length} queries, ${wideEvent.totalDbTimeMs}ms total`,
      inline: true,
    });
  }

  embed.addFields({
    name: "\uD83D\uDC64 Your Context",
    value: formatUserContext(wideEvent),
    inline: true,
  });

  const traceInfo = sentryEventId
    ? `Trace: ${wideEvent.traceId} | Sentry: ${sentryEventId.slice(0, 8)}`
    : `Trace: ${wideEvent.traceId}`;
  embed.setFooter({ text: traceInfo });

  return embed;
}

// Re-export severity types for use elsewhere
export { type ErrorSeverity, SEVERITY_COLORS, SEVERITY_EMOJI };
