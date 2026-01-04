/**
 * Pawtropolis Tech — src/lib/wideEvent.ts
 * WHAT: Wide Event data structure and builder for comprehensive request telemetry
 * WHY: Implements "Wide Events" methodology - one rich event per request instead of many small logs
 * FLOWS:
 *  - new WideEventBuilder(traceId) → setInteraction() → setUser() → enterPhase() → finalize()
 *  - enrichEvent(e => e.addAttr("key", value)) from anywhere in request context
 * DOCS:
 *  - https://loggingsucks.com (Wide Events philosophy)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { type ErrorKind, type ClassifiedError, isRecoverable } from "./errors.js";
import { env } from "./env.js";

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
 */
export interface WideEvent {
  // === Request metadata (always present) ===
  timestamp: string; // ISO 8601
  traceId: string; // 11-char base62 correlation ID
  serviceVersion: string; // From package.json
  environment: string; // production/development/test

  // === Interaction context ===
  kind: InteractionKind;
  command: string | null;
  subcommand: string | null;
  customId: string | null; // For buttons/modals

  // === Discord context ===
  guildId: string | null;
  channelId: string | null;
  userId: string | null;
  username: string | null;

  // === User context (enriched) ===
  userRoles: string[]; // Role IDs for debugging
  isStaff: boolean;
  isAdmin: boolean;
  isOwner: boolean;

  // === Execution context ===
  phases: PhaseRecord[];
  durationMs: number;
  wasDeferred: boolean;
  wasReplied: boolean;
  outcome: RequestOutcome;

  // === Database context ===
  queries: QueryRecord[];
  totalDbTimeMs: number;

  // === Business context (feature-specific) ===
  feature: string | null; // gate, review, modmail, audit, etc.
  action: string | null; // accept, reject, claim, relay, etc.
  entitiesAffected: EntityRef[];

  // === Custom attributes (extensible) ===
  attrs: Record<string, unknown>;

  // === Error context (only if outcome === "error") ===
  error: WideEventError | null;
}

// ===== Helper Functions =====

const SERVICE_VERSION = "4.8.0"; // TODO: Read from package.json at build time

/**
 * Create an empty WideEvent with safe defaults.
 */
function createEmptyEvent(traceId: string): WideEvent {
  return {
    timestamp: new Date().toISOString(),
    traceId,
    serviceVersion: SERVICE_VERSION,
    environment: env.NODE_ENV,

    kind: null,
    command: null,
    subcommand: null,
    customId: null,

    guildId: null,
    channelId: null,
    userId: null,
    username: null,

    userRoles: [],
    isStaff: false,
    isAdmin: false,
    isOwner: false,

    phases: [],
    durationMs: 0,
    wasDeferred: false,
    wasReplied: false,
    outcome: "success",

    queries: [],
    totalDbTimeMs: 0,

    feature: null,
    action: null,
    entitiesAffected: [],

    attrs: {},

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
   * Mark that the interaction was deferred.
   */
  markDeferred(): this {
    this.event.wasDeferred = true;
    return this;
  }

  /**
   * Mark that the interaction was replied to.
   */
  markReplied(): this {
    this.event.wasReplied = true;
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
