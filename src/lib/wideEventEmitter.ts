/**
 * Pawtropolis Tech — src/lib/wideEventEmitter.ts
 * WHAT: Emits wide events to configured destinations with tail sampling
 * WHY: Keep 100% of errors and timeouts, sample successful requests to control volume
 * FLOWS:
 *  - emitWideEvent(event) → shouldSample() → logger.info/error
 * DOCS:
 *  - https://loggingsucks.com (tail sampling strategy)
 *
 * LOG OUTPUT STRUCTURE:
 * ─────────────────────────────────────────────────────────────────────────────
 * The flattened log output includes these field categories:
 *
 * CORE IDENTITY:
 *   traceId, timestamp, version, env
 *
 * BUILD IDENTITY (for correlating to exact code):
 *   build_sha, build_time, build_deployId, build_node, build_host
 *
 * INTERACTION:
 *   kind, command, subcommand, customId
 *
 * DISCORD:
 *   guildId, channelId, userId, username
 *
 * USER:
 *   isStaff, isAdmin, isOwner, roleCount
 *
 * EXECUTION:
 *   outcome, durationMs, phaseCount, phases, wasDeferred, wasReplied
 *
 * RESPONSE STATE (for debugging interaction response lifecycle):
 *   resp_deferredAt, resp_repliedAt, resp_errorCardSent, resp_failureReason
 *
 * DATABASE:
 *   queryCount, totalDbTimeMs
 *
 * BUSINESS:
 *   feature, action, entityCount, entities
 *
 * ERROR (only when outcome === "error"):
 *   errorKind, errorCode, errorMessage, errorPhase, errorRetriable, sentryEventId
 *
 * CUSTOM:
 *   attr_* (prefixed custom attributes)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { logger } from "./logger.js";
import { env } from "./env.js";
import type { WideEvent, PhaseRecord } from "./wideEvent.js";
import { storeTrace } from "./traceStore.js";

// ===== Configuration =====

// Default 10% sampling for successful requests, configurable via env
const DEFAULT_SAMPLE_RATE = 0.1;

function getSampleRate(): number {
  const envRate = process.env.WIDE_EVENT_SAMPLE_RATE;
  if (!envRate) return DEFAULT_SAMPLE_RATE;

  const parsed = parseFloat(envRate);
  if (isNaN(parsed) || parsed < 0 || parsed > 1) {
    logger.warn(
      { envRate, defaultRate: DEFAULT_SAMPLE_RATE },
      "[wideEvent] Invalid WIDE_EVENT_SAMPLE_RATE, using default"
    );
    return DEFAULT_SAMPLE_RATE;
  }
  return parsed;
}

function isEnabled(): boolean {
  const enabled = process.env.WIDE_EVENT_ENABLED;
  // Default to enabled
  if (!enabled) return true;
  return enabled.toLowerCase() !== "false" && enabled !== "0";
}

// ===== Sampling Logic =====

/**
 * Deterministic hash of traceId to a number in [0, 1).
 * Using traceId ensures the same request always gets the same sampling decision,
 * which is important for correlation across systems.
 */
function hashTraceId(traceId: string): number {
  let hash = 0;
  for (let i = 0; i < traceId.length; i++) {
    hash = (hash << 5) - hash + traceId.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  // Normalize to [0, 1)
  return Math.abs(hash) / 2147483647;
}

/**
 * Tail sampling decision.
 * Always keep errors and timeouts. Sample successes based on rate.
 */
function shouldSample(event: WideEvent): boolean {
  // Always keep errors and timeouts - these are debugging gold
  if (event.outcome === "error") return true;
  if (event.outcome === "timeout") return true;

  // Sample successful requests based on rate
  const sampleRate = getSampleRate();
  if (sampleRate >= 1.0) return true; // Keep all
  if (sampleRate <= 0) return false; // Drop all

  // Deterministic sampling based on traceId
  return hashTraceId(event.traceId) < sampleRate;
}

// ===== Flattening for Logging =====

/**
 * Format phases for logging.
 * Shows execution path like: "enter -> validate -> db_write -> reply"
 */
function formatPhases(phases: PhaseRecord[]): string {
  if (phases.length === 0) return "none";
  return phases.map((p) => p.name).join(" -> ");
}

/**
 * Format phases with timing for error details.
 * Shows: "enter (2ms) -> validate (15ms) -> db_write (X)"
 */
function formatPhasesWithTiming(phases: PhaseRecord[], failedPhase?: string): string {
  if (phases.length === 0) return "none";
  return phases
    .map((p) => {
      const timing = p.durationMs !== null ? `${p.durationMs}ms` : "...";
      const marker = p.name === failedPhase ? "X" : timing;
      return `${p.name} (${marker})`;
    })
    .join(" -> ");
}

/**
 * Flatten WideEvent for structured logging.
 *
 * This creates a flat object that log aggregators can query efficiently.
 * The flattening strategy:
 *   - Core fields are mapped directly
 *   - Build identity fields are included for correlation
 *   - Response state is flattened with "resp_" prefix
 *   - Custom attributes use "attr_" prefix to avoid collisions
 *   - Arrays are converted to counts + compact string representation
 *
 * FIELD NAMING CONVENTIONS:
 * ─────────────────────────────────────────────────────────────────────────────
 *   - Camel case for simple fields (userId, guildId)
 *   - Underscore prefix for categories (build_, resp_, attr_)
 *   - Count suffix for array lengths (phaseCount, queryCount)
 *   - Detail suffix for verbose versions (phasesDetail)
 *
 * This naming makes queries easier:
 *   - Find errors: outcome:"error"
 *   - Find by commit: build_sha:"abc1234"
 *   - Find slow: durationMs:>5000
 *   - Find by feature: feature:"review" action:"approve"
 */
function flattenForLogging(event: WideEvent): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    // ─────────────────────────────────────────────────────────────────────────
    // CORE IDENTITY
    // Essential fields for identifying and correlating requests
    // ─────────────────────────────────────────────────────────────────────────
    traceId: event.traceId,
    timestamp: event.timestamp,
    version: event.serviceVersion,
    env: event.environment,

    // ─────────────────────────────────────────────────────────────────────────
    // BUILD IDENTITY
    // Correlate logs to exact code version and deployment
    // Prefixed with "build_" for clear categorization
    // ─────────────────────────────────────────────────────────────────────────
    build_sha: event.gitSha,
    build_time: event.buildTime,
    build_deployId: event.deployId,
    build_node: event.nodeVersion,
    build_host: event.hostname,

    // ─────────────────────────────────────────────────────────────────────────
    // INTERACTION CONTEXT
    // What Discord interaction triggered this
    // ─────────────────────────────────────────────────────────────────────────
    kind: event.kind,
    command: event.command,
    subcommand: event.subcommand,
    customId: event.customId,

    // ─────────────────────────────────────────────────────────────────────────
    // DISCORD CONTEXT
    // Where in Discord this happened
    // ─────────────────────────────────────────────────────────────────────────
    guildId: event.guildId,
    channelId: event.channelId,
    userId: event.userId,
    username: event.username,

    // ─────────────────────────────────────────────────────────────────────────
    // USER CONTEXT
    // Permissions and authorization state
    // ─────────────────────────────────────────────────────────────────────────
    isStaff: event.isStaff,
    isAdmin: event.isAdmin,
    isOwner: event.isOwner,
    roleCount: event.userRoles.length,

    // ─────────────────────────────────────────────────────────────────────────
    // EXECUTION CONTEXT
    // How the request was processed
    // ─────────────────────────────────────────────────────────────────────────
    outcome: event.outcome,
    durationMs: event.durationMs,
    phaseCount: event.phases.length,
    phases: formatPhases(event.phases),

    // Legacy fields (kept for backward compatibility)
    wasDeferred: event.wasDeferred,
    wasReplied: event.wasReplied,

    // ─────────────────────────────────────────────────────────────────────────
    // RESPONSE STATE
    // Detailed tracking of interaction response lifecycle
    // Prefixed with "resp_" for clear categorization
    // ─────────────────────────────────────────────────────────────────────────
    resp_deferredAt: event.responseState.deferredAt,
    resp_repliedAt: event.responseState.repliedAt,
    resp_errorCardSent: event.responseState.errorCardSent,
    resp_failureReason: event.responseState.failureReason,

    // ─────────────────────────────────────────────────────────────────────────
    // DATABASE CONTEXT
    // Query execution details
    // ─────────────────────────────────────────────────────────────────────────
    queryCount: event.queries.length,
    totalDbTimeMs: event.totalDbTimeMs,

    // ─────────────────────────────────────────────────────────────────────────
    // BUSINESS CONTEXT
    // Feature-specific information
    // ─────────────────────────────────────────────────────────────────────────
    feature: event.feature,
    action: event.action,
    entityCount: event.entitiesAffected.length,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // ERROR CONTEXT
  // Only present when outcome === "error"
  // ─────────────────────────────────────────────────────────────────────────────
  if (event.error) {
    flat.errorKind = event.error.kind;
    flat.errorCode = event.error.code;
    flat.errorMessage = event.error.message?.slice(0, 200); // Truncate for safety
    flat.errorPhase = event.error.phase;
    flat.errorRetriable = event.error.isRetriable;
    flat.sentryEventId = event.error.sentryEventId;
    // Include detailed phase timing for errors - helps identify where time was spent
    flat.phasesDetail = formatPhasesWithTiming(event.phases, event.error.phase);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CUSTOM ATTRIBUTES
  // Feature-specific data added via addAttr()
  // Prefixed with "attr_" to avoid collisions with core fields
  // ─────────────────────────────────────────────────────────────────────────────
  for (const [key, value] of Object.entries(event.attrs)) {
    flat[`attr_${key}`] = value;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ENTITY REFERENCES
  // Compact representation of affected entities
  // Format: "application:A1B2C3, user:123456789"
  // ─────────────────────────────────────────────────────────────────────────────
  if (event.entitiesAffected.length > 0) {
    flat.entities = event.entitiesAffected.map((e) => `${e.type}:${e.code ?? e.id}`).join(", ");
  }

  return flat;
}

// ===== Main Export =====

/**
 * Emit a wide event to the logging system.
 *
 * This is the single point of emission for all wide events.
 * Handles:
 * - Checking if wide events are enabled
 * - Tail sampling (keeps errors, samples successes)
 * - Flattening for structured logging
 * - Log level selection based on outcome
 */
export function emitWideEvent(event: WideEvent): void {
  // Check if wide events are enabled
  if (!isEnabled()) {
    return;
  }

  // Tail sampling decision
  if (!shouldSample(event)) {
    // Optionally log that we're dropping for debugging
    if (env.NODE_ENV === "development" && process.env.DEBUG_WIDE_EVENTS) {
      logger.debug(
        { traceId: event.traceId, outcome: event.outcome },
        "[wideEvent] dropped (sampling)"
      );
    }
    return;
  }

  // Flatten for logging
  const flattened = flattenForLogging(event);

  // Build log message
  const cmdLabel = event.command ?? event.customId ?? event.kind ?? "unknown";
  const message = `[${cmdLabel}] ${event.outcome} in ${event.durationMs}ms`;

  // Log at appropriate level
  if (event.outcome === "error") {
    logger.error({ evt: "wide_event", ...flattened }, message);
  } else if (event.outcome === "timeout") {
    logger.warn({ evt: "wide_event", ...flattened }, message);
  } else {
    logger.info({ evt: "wide_event", ...flattened }, message);
  }

  // Store trace for /developer trace command retrieval
  storeTrace(event);
}

/**
 * Force emit a wide event without sampling.
 * Use for critical events that should always be logged regardless of sampling rate.
 */
export function emitWideEventForced(event: WideEvent): void {
  if (!isEnabled()) return;

  const flattened = flattenForLogging(event);
  const cmdLabel = event.command ?? event.customId ?? event.kind ?? "unknown";
  const message = `[${cmdLabel}] ${event.outcome} in ${event.durationMs}ms (forced)`;

  if (event.outcome === "error") {
    logger.error({ evt: "wide_event", forced: true, ...flattened }, message);
  } else {
    logger.info({ evt: "wide_event", forced: true, ...flattened }, message);
  }

  // Store trace for /developer trace command retrieval
  storeTrace(event);
}
