/**
 * Pawtropolis Tech — src/lib/wideEvent.ts
 * WHAT: Wide Event data structure and builder for comprehensive request telemetry
 * WHY: Implements "Wide Events" methodology - one rich event per request instead of many small logs
 * FLOWS:
 *  - new WideEventBuilder(traceId) → setInteraction() → setUser() → enterPhase() → finalize()
 *  - enrichEvent(e => e.addAttr("key", value)) from anywhere in request context
 * DOCS:
 *  - https://loggingsucks.com (Wide Events philosophy)
 *
 * BUILD IDENTITY:
 * ─────────────────────────────────────────────────────────────────────────────
 * Every wide event includes comprehensive build identity information:
 *   - serviceVersion: Package version (e.g., "4.9.2")
 *   - gitSha: Git commit SHA for exact code identification
 *   - buildTime: When the build was created
 *   - deployId: Unique deployment identifier
 *   - nodeVersion: Node.js runtime version
 *   - hostname: Server/container hostname
 *
 * This allows correlating any log/error to the exact code that produced it.
 * See src/lib/buildInfo.ts for the build identity system design.
 *
 * RESPONSE STATE TRACKING:
 * ─────────────────────────────────────────────────────────────────────────────
 * The responseState field provides clarity on Discord interaction lifecycle:
 *   - deferredAt: When deferReply() was called (null if not deferred)
 *   - repliedAt: When reply/editReply was called (null if not replied)
 *   - errorCardSent: Whether the error fallback was successfully posted
 *   - failureReason: Why defer/reply failed (e.g., "10062: Interaction expired")
 *
 * This answers the critical debugging question: "Did the user see anything?"
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { type ErrorKind, type ClassifiedError, isRecoverable } from "./errors.js";
import { env } from "./env.js";
import { getBuildInfo } from "./buildInfo.js";

// ===== Core Types =====

/** Record of a single execution phase */
export interface PhaseRecord {
  name: string;
  startMs: number;
  endMs: number | null;
  durationMs: number | null;
}

/** Record of a database query */
export interface QueryRecord {
  sql: string; // Truncated to 200 chars
  durationMs: number;
  table: string | null;
}

/** Reference to an entity affected by this request */
export interface EntityRef {
  type: "application" | "user" | "ticket" | "message" | "role" | "channel" | "guild";
  id: string;
  code?: string; // Short code for applications (e.g., "A1B2C3")
}

/**
 * Response state tracking for Discord interactions.
 *
 * Discord interactions have a strict 3-second SLA for the initial response.
 * This structure tracks the full lifecycle of our response attempts:
 *
 * LIFECYCLE:
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  Interaction received                                                  │
 * │       ↓                                                                │
 * │  [Option A] Fast response (<3s): reply() directly                     │
 * │       → repliedAt = timestamp                                          │
 * │                                                                        │
 * │  [Option B] Slow operation: deferReply() first                        │
 * │       → deferredAt = timestamp                                         │
 * │       → ... do work ...                                                │
 * │       → editReply() with result                                        │
 * │       → repliedAt = timestamp                                          │
 * │                                                                        │
 * │  [On Error] Show error card as fallback                               │
 * │       → errorCardSent = true/false                                     │
 * │                                                                        │
 * │  [On Failure] Capture why we couldn't respond                         │
 * │       → failureReason = "10062: Interaction expired"                   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * WHY THIS MATTERS:
 * When debugging, you need to know:
 *   1. Did we acknowledge the interaction in time?
 *   2. Did we send the actual response?
 *   3. If error, did the user at least see an error message?
 *   4. If nothing worked, why?
 */
export interface ResponseState {
  /**
   * Timestamp when deferReply() was called.
   * Null if we didn't defer (either replied directly or failed before deferring).
   *
   * If this is null and repliedAt is also null, it means we failed before
   * even acknowledging the interaction (very bad - user saw "interaction failed").
   */
  deferredAt: number | null;

  /**
   * Timestamp when reply/editReply/followUp was called.
   * Null if we never sent a response (interaction timed out or failed).
   *
   * Note: This is when WE sent the reply, not when Discord delivered it.
   * Network latency between us and Discord is usually <100ms.
   */
  repliedAt: number | null;

  /**
   * Whether the error card fallback was successfully posted.
   * Only relevant when outcome === "error".
   *
   * If true: User saw an error message with trace ID (they can report it)
   * If false: User saw Discord's generic "interaction failed" (bad UX)
   */
  errorCardSent: boolean;

  /**
   * Why we failed to respond (if applicable).
   * Examples:
   *   - "10062: Interaction expired" (we were too slow)
   *   - "50013: Missing permissions" (can't send to that channel)
   *   - "Error thrown before defer" (code crashed early)
   *
   * Null if we successfully responded.
   */
  failureReason: string | null;
}

/** Error context attached to failed requests */
export interface WideEventError {
  kind: ErrorKind;
  code: string | number | null;
  message: string;
  phase: string;
  lastSql: string | null;
  isRetriable: boolean;
  sentryEventId: string | null;
  stack: string | null; // Only in development
}

/** Outcome of a request */
export type RequestOutcome = "success" | "error" | "timeout" | "cancelled";

/** Interaction kind */
export type InteractionKind = "slash" | "button" | "modal" | "select" | "autocomplete" | "contextMenu" | "event" | null;

/**
 * Wide Event - comprehensive telemetry for a single request.
 *
 * Instead of logging many small messages throughout request handling,
 * we build ONE wide event with ALL context and emit it at completion.
 * This enables single-query debugging and proper observability.
 *
 * FIELD CATEGORIES:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. REQUEST METADATA - When/where/what version
 *    → Answers: "What request is this and what code handled it?"
 *
 * 2. BUILD IDENTITY - Git SHA, build time, node version, hostname
 *    → Answers: "What exact code was running and where?"
 *
 * 3. INTERACTION CONTEXT - Command, buttons, modals
 *    → Answers: "What Discord interaction triggered this?"
 *
 * 4. DISCORD CONTEXT - Guild, channel, user
 *    → Answers: "Who/where in Discord?"
 *
 * 5. USER CONTEXT - Roles, permissions
 *    → Answers: "What permissions did the user have?"
 *
 * 6. EXECUTION CONTEXT - Phases, duration, outcome
 *    → Answers: "How did execution flow and how long did it take?"
 *
 * 7. RESPONSE STATE - Deferred, replied, error card sent
 *    → Answers: "What did the user actually see?"
 *
 * 8. DATABASE CONTEXT - Queries, timing
 *    → Answers: "What database operations happened?"
 *
 * 9. BUSINESS CONTEXT - Feature, action, entities
 *    → Answers: "What feature/action was being performed?"
 *
 * 10. ERROR CONTEXT - Kind, code, message, phase
 *     → Answers: "What went wrong and where?"
 */
export interface WideEvent {
  // ═══════════════════════════════════════════════════════════════════════════
  // REQUEST METADATA
  // Always present - identifies this specific request
  // ═══════════════════════════════════════════════════════════════════════════

  /** ISO 8601 timestamp when the request started */
  timestamp: string;

  /** 11-character base62 correlation ID for tracing */
  traceId: string;

  /** Package version from package.json (e.g., "4.9.2") */
  serviceVersion: string;

  /** Runtime environment: production/development/test */
  environment: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD IDENTITY
  // Identifies the exact code version and deployment
  // See src/lib/buildInfo.ts for the full build identity system
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Git commit SHA (short 7-char format).
   * Null in local development if build script wasn't run.
   *
   * This is the most critical field for debugging production issues.
   * With this, you can: git show <sha>, git checkout <sha>, git log <sha>..HEAD
   */
  gitSha: string | null;

  /**
   * ISO 8601 timestamp when the build was created.
   * Null if build script wasn't run.
   *
   * Useful for: "Is this running the fix we deployed?"
   */
  buildTime: string | null;

  /**
   * Unique deployment identifier.
   * Format: "deploy-YYYYMMDD-HHMMSS-<sha>"
   * Null if not injected at deploy time.
   */
  deployId: string | null;

  /**
   * Node.js version (without 'v' prefix).
   * Always available from process.version.
   */
  nodeVersion: string;

  /**
   * Hostname of the machine running the bot.
   * Useful for multi-server deployments.
   */
  hostname: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERACTION CONTEXT
  // What Discord interaction triggered this request
  // ═══════════════════════════════════════════════════════════════════════════

  /** Type of interaction: slash, button, modal, etc. */
  kind: InteractionKind;

  /** Slash command name (e.g., "review", "gate") */
  command: string | null;

  /** Subcommand name if applicable (e.g., "approve", "reject") */
  subcommand: string | null;

  /** Custom ID for buttons/modals/selects */
  customId: string | null;

  // ═══════════════════════════════════════════════════════════════════════════
  // DISCORD CONTEXT
  // Where in Discord this happened
  // ═══════════════════════════════════════════════════════════════════════════

  /** Guild (server) ID */
  guildId: string | null;

  /** Channel ID where interaction occurred */
  channelId: string | null;

  /** User ID who triggered the interaction */
  userId: string | null;

  /** Username for debugging (not for display - use ID for that) */
  username: string | null;

  // ═══════════════════════════════════════════════════════════════════════════
  // USER CONTEXT
  // Permissions and roles of the user
  // ═══════════════════════════════════════════════════════════════════════════

  /** Role IDs for debugging permission issues */
  userRoles: string[];

  /** Whether user has staff role */
  isStaff: boolean;

  /** Whether user has admin/manage guild permission */
  isAdmin: boolean;

  /** Whether user is a bot owner (bypass all checks) */
  isOwner: boolean;

  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTION CONTEXT
  // How the request was processed
  // ═══════════════════════════════════════════════════════════════════════════

  /** Execution phases with timing (e.g., enter → validate → db_write → reply) */
  phases: PhaseRecord[];

  /** Total request duration in milliseconds */
  durationMs: number;

  /**
   * Whether deferReply() was called.
   * @deprecated Use responseState.deferredAt !== null instead
   */
  wasDeferred: boolean;

  /**
   * Whether reply/editReply/followUp was called.
   * @deprecated Use responseState.repliedAt !== null instead
   */
  wasReplied: boolean;

  /** Request outcome: success, error, timeout, cancelled */
  outcome: RequestOutcome;

  // ═══════════════════════════════════════════════════════════════════════════
  // RESPONSE STATE
  // Detailed tracking of Discord interaction response lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Detailed response state tracking.
   * Answers: "What did the user actually see?"
   *
   * See ResponseState interface for full documentation.
   */
  responseState: ResponseState;

  // ═══════════════════════════════════════════════════════════════════════════
  // DATABASE CONTEXT
  // SQL queries and timing
  // ═══════════════════════════════════════════════════════════════════════════

  /** All database queries executed (truncated to 200 chars each) */
  queries: QueryRecord[];

  /** Total time spent in database operations (ms) */
  totalDbTimeMs: number;

  // ═══════════════════════════════════════════════════════════════════════════
  // BUSINESS CONTEXT
  // Feature-specific information
  // ═══════════════════════════════════════════════════════════════════════════

  /** Feature being used: gate, review, modmail, audit, etc. */
  feature: string | null;

  /** Action being performed: accept, reject, claim, relay, etc. */
  action: string | null;

  /** Entities affected by this request (applications, users, tickets, etc.) */
  entitiesAffected: EntityRef[];

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM ATTRIBUTES
  // Extensible key-value pairs for feature-specific data
  // ═══════════════════════════════════════════════════════════════════════════

  /** Custom attributes added via addAttr() - prefixed with "attr_" in logs */
  attrs: Record<string, unknown>;

  // ═══════════════════════════════════════════════════════════════════════════
  // ERROR CONTEXT
  // Only present when outcome === "error"
  // ═══════════════════════════════════════════════════════════════════════════

  /** Error details if outcome === "error", null otherwise */
  error: WideEventError | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an empty WideEvent with safe defaults.
 *
 * This function is called once per request when the WideEventBuilder is created.
 * It populates build identity from getBuildInfo() and sets sensible defaults
 * for all other fields.
 *
 * BUILD IDENTITY:
 * The build identity fields (gitSha, buildTime, deployId, nodeVersion, hostname)
 * are populated from getBuildInfo(), which caches the values at startup.
 * This means every event from the same process will have identical build identity.
 *
 * RESPONSE STATE:
 * The responseState is initialized with all nulls/false - these are populated
 * as the request progresses through defer → reply → (error card if needed).
 */
function createEmptyEvent(traceId: string): WideEvent {
  // Get build identity (cached after first call)
  const buildInfo = getBuildInfo();

  return {
    // ─────────────────────────────────────────────────────────────────────────
    // REQUEST METADATA
    // ─────────────────────────────────────────────────────────────────────────
    timestamp: new Date().toISOString(),
    traceId,
    serviceVersion: buildInfo.version,
    environment: buildInfo.environment,

    // ─────────────────────────────────────────────────────────────────────────
    // BUILD IDENTITY
    // All sourced from getBuildInfo() which reads from env + runtime
    // ─────────────────────────────────────────────────────────────────────────
    gitSha: buildInfo.gitSha,
    buildTime: buildInfo.buildTime,
    deployId: buildInfo.deployId,
    nodeVersion: buildInfo.nodeVersion,
    hostname: buildInfo.hostname,

    // ─────────────────────────────────────────────────────────────────────────
    // INTERACTION CONTEXT
    // Populated by setInteraction()
    // ─────────────────────────────────────────────────────────────────────────
    kind: null,
    command: null,
    subcommand: null,
    customId: null,

    // ─────────────────────────────────────────────────────────────────────────
    // DISCORD CONTEXT
    // Populated by setInteraction()
    // ─────────────────────────────────────────────────────────────────────────
    guildId: null,
    channelId: null,
    userId: null,
    username: null,

    // ─────────────────────────────────────────────────────────────────────────
    // USER CONTEXT
    // Populated by setUser()
    // ─────────────────────────────────────────────────────────────────────────
    userRoles: [],
    isStaff: false,
    isAdmin: false,
    isOwner: false,

    // ─────────────────────────────────────────────────────────────────────────
    // EXECUTION CONTEXT
    // Populated by enterPhase(), finalize()
    // ─────────────────────────────────────────────────────────────────────────
    phases: [],
    durationMs: 0,
    wasDeferred: false, // @deprecated - use responseState.deferredAt
    wasReplied: false, // @deprecated - use responseState.repliedAt
    outcome: "success",

    // ─────────────────────────────────────────────────────────────────────────
    // RESPONSE STATE
    // Populated by markDeferred(), markReplied(), setErrorCardSent()
    // ─────────────────────────────────────────────────────────────────────────
    responseState: {
      deferredAt: null,
      repliedAt: null,
      errorCardSent: false,
      failureReason: null,
    },

    // ─────────────────────────────────────────────────────────────────────────
    // DATABASE CONTEXT
    // Populated by recordQuery()
    // ─────────────────────────────────────────────────────────────────────────
    queries: [],
    totalDbTimeMs: 0,

    // ─────────────────────────────────────────────────────────────────────────
    // BUSINESS CONTEXT
    // Populated by setFeature(), addEntity()
    // ─────────────────────────────────────────────────────────────────────────
    feature: null,
    action: null,
    entitiesAffected: [],

    // ─────────────────────────────────────────────────────────────────────────
    // CUSTOM ATTRIBUTES
    // Populated by addAttr(), addAttrs()
    // ─────────────────────────────────────────────────────────────────────────
    attrs: {},

    // ─────────────────────────────────────────────────────────────────────────
    // ERROR CONTEXT
    // Populated by setError()
    // ─────────────────────────────────────────────────────────────────────────
    error: null,
  };
}

/**
 * Extract table name from SQL query (best effort).
 * Simple regex - won't handle subqueries or CTEs, but good enough for diagnostics.
 */
export function extractTableFromSql(sql: string | undefined): string | null {
  if (!sql) return null;
  const match = sql.match(/(?:FROM|INTO|UPDATE|JOIN)\s+(\w+)/i);
  return match?.[1] ?? null;
}

// ===== WideEventBuilder Class =====

/**
 * Builder for progressively constructing wide events.
 *
 * Design goals:
 * 1. Fluent API for chaining: event.addContext().addMetric().setOutcome()
 * 2. Safe defaults - never throws, always produces valid output
 * 3. Immutable snapshots - finalize() returns frozen copy
 *
 * Usage:
 *   const builder = new WideEventBuilder(traceId);
 *   builder.setInteraction({ kind: "slash", command: "review" });
 *   builder.setUser({ username: "mod", isStaff: true });
 *   builder.enterPhase("validate");
 *   // ... do work ...
 *   builder.setOutcome("success");
 *   const event = builder.finalize();
 */
export class WideEventBuilder {
  private event: WideEvent;
  private currentPhase: PhaseRecord | null = null;
  private startTime: number;

  constructor(traceId: string) {
    this.event = createEmptyEvent(traceId);
    this.startTime = Date.now();
  }

  // ===== Interaction Context =====

  setInteraction(opts: {
    kind: InteractionKind;
    command?: string | null;
    subcommand?: string | null;
    customId?: string | null;
    guildId?: string | null;
    channelId?: string | null;
    userId?: string | null;
  }): this {
    this.event.kind = opts.kind;
    if (opts.command !== undefined) this.event.command = opts.command;
    if (opts.subcommand !== undefined) this.event.subcommand = opts.subcommand;
    if (opts.customId !== undefined) this.event.customId = opts.customId;
    if (opts.guildId !== undefined) this.event.guildId = opts.guildId;
    if (opts.channelId !== undefined) this.event.channelId = opts.channelId;
    if (opts.userId !== undefined) this.event.userId = opts.userId;
    return this;
  }

  // ===== User Context =====

  setUser(opts: {
    username?: string | null;
    roles?: string[];
    isStaff?: boolean;
    isAdmin?: boolean;
    isOwner?: boolean;
  }): this {
    if (opts.username !== undefined) this.event.username = opts.username;
    if (opts.roles !== undefined) this.event.userRoles = opts.roles;
    if (opts.isStaff !== undefined) this.event.isStaff = opts.isStaff;
    if (opts.isAdmin !== undefined) this.event.isAdmin = opts.isAdmin;
    if (opts.isOwner !== undefined) this.event.isOwner = opts.isOwner;
    return this;
  }

  // ===== Phase Tracking =====

  /**
   * Mark entering a new execution phase.
   * Automatically closes the previous phase with duration.
   */
  enterPhase(name: string): this {
    const now = Date.now();

    // Close current phase if open
    if (this.currentPhase && this.currentPhase.endMs === null) {
      this.currentPhase.endMs = now;
      this.currentPhase.durationMs = now - this.currentPhase.startMs;
    }

    // Start new phase
    this.currentPhase = {
      name,
      startMs: now,
      endMs: null,
      durationMs: null,
    };
    this.event.phases.push(this.currentPhase);

    return this;
  }

  /**
   * Get the name of the current phase (for error context).
   */
  getCurrentPhase(): string {
    return this.currentPhase?.name ?? "unknown";
  }

  // ===== Database Tracking =====

  /**
   * Record a database query with timing.
   */
  recordQuery(sql: string, durationMs: number): this {
    this.event.queries.push({
      sql: sql.slice(0, 200), // Truncate for safety
      durationMs,
      table: extractTableFromSql(sql),
    });
    this.event.totalDbTimeMs += durationMs;
    return this;
  }

  // ===== Business Context =====

  /**
   * Set the feature and optional action being performed.
   */
  setFeature(feature: string, action?: string): this {
    this.event.feature = feature;
    if (action !== undefined) this.event.action = action;
    return this;
  }

  /**
   * Set just the action (if feature was already set).
   */
  setAction(action: string): this {
    this.event.action = action;
    return this;
  }

  /**
   * Add an entity affected by this request.
   */
  addEntity(entity: EntityRef): this {
    this.event.entitiesAffected.push(entity);
    return this;
  }

  // ===== Custom Attributes =====

  /**
   * Add a single custom attribute.
   */
  addAttr(key: string, value: unknown): this {
    this.event.attrs[key] = value;
    return this;
  }

  /**
   * Add multiple custom attributes at once.
   */
  addAttrs(attrs: Record<string, unknown>): this {
    Object.assign(this.event.attrs, attrs);
    return this;
  }

  // ===== Outcome & State =====

  /**
   * Set the request outcome.
   */
  setOutcome(outcome: RequestOutcome): this {
    this.event.outcome = outcome;
    return this;
  }

  /**
   * Mark that the interaction was deferred with deferReply().
   *
   * WHEN TO CALL:
   * Call this immediately after a successful deferReply() call.
   * The timestamp is recorded for response state tracking.
   *
   * WHY THIS MATTERS:
   * If the bot crashes after deferring but before replying, the user sees
   * a loading state that eventually times out. By tracking when we deferred,
   * we can debug these scenarios: "We deferred at T+500ms but crashed at T+2000ms"
   *
   * @example
   * ```typescript
   * await interaction.deferReply();
   * enrichEvent(e => e.markDeferred());
   * ```
   */
  markDeferred(): this {
    this.event.wasDeferred = true;
    this.event.responseState.deferredAt = Date.now();
    return this;
  }

  /**
   * Mark that the interaction was replied to.
   *
   * WHEN TO CALL:
   * Call this after successfully calling reply(), editReply(), or followUp().
   * The timestamp is recorded for response state tracking.
   *
   * WHY THIS MATTERS:
   * This confirms the user saw SOMETHING (even if it was an error card).
   * Combined with deferredAt, we can calculate how long users waited.
   *
   * @example
   * ```typescript
   * await interaction.editReply({ content: "Done!" });
   * enrichEvent(e => e.markReplied());
   * ```
   */
  markReplied(): this {
    this.event.wasReplied = true;
    this.event.responseState.repliedAt = Date.now();
    return this;
  }

  /**
   * Mark that the error card fallback was successfully posted.
   *
   * WHEN TO CALL:
   * Call this after postErrorCardV2() succeeds in the error handler.
   *
   * WHY THIS MATTERS:
   * When outcome is "error", we need to know if the user at least saw
   * an error message with a trace ID they can report. If errorCardSent
   * is false, they saw Discord's generic "interaction failed" - bad UX.
   *
   * @param sent - Whether the error card was successfully posted
   *
   * @example
   * ```typescript
   * try {
   *   await postErrorCardV2(interaction, opts);
   *   wideEvent.setErrorCardSent(true);
   * } catch {
   *   wideEvent.setErrorCardSent(false);
   * }
   * ```
   */
  setErrorCardSent(sent: boolean): this {
    this.event.responseState.errorCardSent = sent;
    // If error card was sent, we did reply (even if the original reply failed)
    if (sent) {
      this.event.wasReplied = true;
      this.event.responseState.repliedAt = Date.now();
    }
    return this;
  }

  /**
   * Record why we failed to respond to the interaction.
   *
   * WHEN TO CALL:
   * Call this when deferReply(), reply(), or editReply() fails.
   * Pass the error code/message so we know what went wrong.
   *
   * COMMON FAILURE REASONS:
   *   - "10062: Interaction expired" - We were too slow (>3s for first response)
   *   - "50013: Missing permissions" - Can't send to that channel
   *   - "40060: Already acknowledged" - Double-response bug in our code
   *   - "Error thrown before defer" - Code crashed before we could respond
   *
   * @param reason - Human-readable failure reason
   *
   * @example
   * ```typescript
   * try {
   *   await interaction.deferReply();
   * } catch (err) {
   *   enrichEvent(e => e.setResponseFailure(`${err.code}: ${err.message}`));
   * }
   * ```
   */
  setResponseFailure(reason: string): this {
    this.event.responseState.failureReason = reason;
    return this;
  }

  // ===== Error Context =====

  /**
   * Set error context from a classified error.
   */
  setError(
    err: ClassifiedError,
    opts?: {
      phase?: string;
      lastSql?: string | null;
      sentryEventId?: string | null;
    }
  ): this {
    this.event.outcome = "error";
    this.event.error = {
      kind: err.kind,
      code: "code" in err ? (err as { code?: string | number }).code ?? null : null,
      message: err.message,
      phase: opts?.phase ?? this.getCurrentPhase(),
      lastSql: opts?.lastSql ?? null,
      isRetriable: isRecoverable(err),
      sentryEventId: opts?.sentryEventId ?? null,
      // Only include stack in development to avoid exposing internals
      stack: env.NODE_ENV === "development" ? (err.cause?.stack ?? null) : null,
    };
    return this;
  }

  // ===== Finalization =====

  /**
   * Finalize the event and return a frozen copy.
   * Closes any open phase and calculates total duration.
   */
  finalize(): WideEvent {
    const now = Date.now();

    // Close current phase if open
    if (this.currentPhase && this.currentPhase.endMs === null) {
      this.currentPhase.endMs = now;
      this.currentPhase.durationMs = now - this.currentPhase.startMs;
    }

    // Calculate total duration
    this.event.durationMs = now - this.startTime;

    // Return frozen copy
    return Object.freeze({ ...this.event });
  }

  /**
   * Get a snapshot of the current event state (for error cards).
   * Does NOT close phases or finalize duration.
   */
  snapshot(): WideEvent {
    return { ...this.event };
  }
}
