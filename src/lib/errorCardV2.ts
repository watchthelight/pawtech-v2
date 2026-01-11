/**
 * Pawtropolis Tech — src/lib/errorCardV2.ts
 * WHAT: Redesigned error cards with severity-based colors and rich context from wide events
 * WHY: Users deserve clear, actionable feedback when commands fail. Staff need context to debug.
 * FLOWS:
 *  - getErrorSeverity() → color selection
 *  - getExplanation() → human-readable error description
 *  - formatExecutionPath() → visual phase timeline
 *  - formatBuildIdentity() → version + SHA + build age
 *  - formatResponseState() → deferred/replied/error card status
 *  - postErrorCardV2() → build and send embed
 * DOCS:
 *  - Wide Events: https://loggingsucks.com
 *
 * ERROR CARD SECTIONS:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. DESCRIPTION - Human-readable explanation of what went wrong
 *    → "The database is temporarily busy. Please try again."
 *
 * 2. EXECUTION PATH - Visual timeline of phases with failure marker
 *    → "enter → validate → ❌ db_write"
 *
 * 3. DATABASE - Query count and failed SQL (if applicable)
 *    → "3 queries, 45ms total / Failed: SELECT * FROM..."
 *
 * 4. YOUR CONTEXT - User permissions and role count
 *    → "Staff • 5 roles"
 *
 * 5. BUILD IDENTITY - Version, git SHA, build age, node version
 *    → "v4.9.2 (abc1234) • Built 2h ago • Node 20.10.0"
 *
 * 6. RESPONSE STATE - What the user saw (or didn't)
 *    → "Deferred: No (error before defer) • Replied: No • Error Card: ✓ Sent"
 *
 * 7. TECHNICAL DETAILS - Error kind, code, retriable flag
 *    → "Type: discord_api • Code: 50013 • Retriable: No"
 *
 * 8. FOOTER - Trace ID, Sentry ID, version+SHA for support
 *    → "Trace: ABC123 | Sentry: 12345678 | v4.9.2+abc1234"
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
import type { WideEvent, WideEventError, PhaseRecord, ResponseState } from "./wideEvent.js";
import type { ClassifiedError, ErrorKind } from "./errors.js";
import { getBuildInfo, getBuildAge, getShortBuildId } from "./buildInfo.js";

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

// ===== Build Identity Formatting =====

/**
 * Format build identity as a compact string for the error card.
 *
 * Shows:
 *   - Version + short SHA: "v4.9.2 (abc1234)"
 *   - Build age: "Built 2h ago"
 *   - Node version: "Node 20.10.0"
 *
 * WHY SHOW BUILD INFO:
 * When debugging production issues, you need to know:
 *   1. What version of the code is running?
 *   2. Is it a recent deployment or old code?
 *   3. What runtime environment?
 *
 * This helps staff quickly identify if an error is from stale code
 * or if a recent deployment introduced a regression.
 */
function formatBuildIdentity(event: WideEvent): string {
  const parts: string[] = [];

  // Version + SHA (most important)
  const sha = event.gitSha ?? "dev";
  parts.push(`v${event.serviceVersion} (${sha})`);

  // Build age (if available)
  const buildAge = getBuildAge();
  if (buildAge) {
    parts.push(`Built ${buildAge}`);
  }

  // Node version
  parts.push(`Node ${event.nodeVersion}`);

  return parts.join(" \u2022 ");
}

// ===== Response State Formatting =====

/**
 * Format response state as a multi-line summary.
 *
 * Shows:
 *   - Deferred: Yes/No (with reason if no)
 *   - Replied: Yes/No (with timing if yes)
 *   - Error Card: Sent/Failed
 *
 * WHY SHOW RESPONSE STATE:
 * When debugging, you need to know what the user actually saw:
 *   - Did we acknowledge in time? (deferred)
 *   - Did we send a response? (replied)
 *   - If error, did they see the error card with trace ID?
 *
 * If all three are "No", the user saw Discord's generic "interaction failed"
 * with no way to report the issue - that's the worst case scenario.
 */
function formatResponseState(event: WideEvent): string {
  const rs = event.responseState;
  const lines: string[] = [];

  // Deferred status
  if (rs.deferredAt) {
    // Calculate how long after request start we deferred
    const requestStart = new Date(event.timestamp).getTime();
    const deferDelay = rs.deferredAt - requestStart;
    lines.push(`Deferred: Yes (+${deferDelay}ms)`);
  } else if (rs.failureReason) {
    // We tried to respond but failed
    lines.push(`Deferred: No (${rs.failureReason})`);
  } else {
    // Either we replied directly (fast) or crashed before deferring
    lines.push("Deferred: No (direct reply or error before defer)");
  }

  // Replied status
  if (rs.repliedAt) {
    const requestStart = new Date(event.timestamp).getTime();
    const replyDelay = rs.repliedAt - requestStart;
    lines.push(`Replied: Yes (+${replyDelay}ms)`);
  } else {
    lines.push("Replied: No");
  }

  // Error card status (only relevant for errors)
  if (event.outcome === "error") {
    if (rs.errorCardSent) {
      lines.push("Error Card: \u2713 Sent");
    } else {
      lines.push("Error Card: \u2717 Failed");
    }
  }

  return lines.join("\n");
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

  // === Section 5: Build Identity ===
  // Shows version, git SHA, build age, and node version
  // Helps staff identify which code version caused the error
  const buildIdentity = formatBuildIdentity(wideEvent);
  embed.addFields({
    name: "\uD83C\uDFD7\uFE0F Build Identity",
    value: buildIdentity,
    inline: true,
  });

  // === Section 6: Response State ===
  // Shows what the user actually saw (deferred, replied, error card)
  // Critical for debugging "interaction failed" scenarios
  const responseState = formatResponseState(wideEvent);
  embed.addFields({
    name: "\uD83D\uDCE1 Response State",
    value: responseState,
    inline: true,
  });

  // === Section 7: Error Details (for staff debugging) ===
  if (error) {
    const errorCode = error.code ? `Code: ${error.code}` : "";
    const errorKind = `Type: ${error.kind}`;
    const retriable = error.isRetriable ? "Retriable: Yes" : "Retriable: No";
    const details = [errorKind, errorCode, retriable].filter(Boolean).join(" \u2022 ");
    embed.addFields({
      name: "\uD83D\uDD27 Technical Details",
      value: details,
      inline: false,
    });
  }

  // === Footer: Trace ID + Version ===
  // Include version+SHA in footer for quick reference when reporting issues
  const shortBuild = getShortBuildId();
  const traceInfo = sentryEventId
    ? `Trace: ${wideEvent.traceId} | Sentry: ${sentryEventId.slice(0, 8)} | ${shortBuild}`
    : `Trace: ${wideEvent.traceId} | ${shortBuild}`;
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
