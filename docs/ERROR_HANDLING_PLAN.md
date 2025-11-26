# Error Handling & Logging Improvement Plan

## Executive Summary

This document outlines a comprehensive plan to improve error handling and logging across the Pawtropolis Tech codebase. The current architecture is solid with good patterns (command wrapping, Sentry integration, structured logging), but there are opportunities to improve error classification, eliminate silent suppressions, and add resilience patterns.

---

## Current State Assessment

### Strengths (Keep These)

| Pattern | Location | Description |
|---------|----------|-------------|
| Command Wrapping | `src/lib/cmdWrap.ts` | All commands wrapped with try/catch, trace IDs, error cards |
| Event Handler Safety | `src/index.ts` | All Discord.js events wrapped, never crash the bot |
| Database Error Logging | `src/db/db.ts` | SQL queries logged with errors |
| Sentry Auto-Capture | `src/lib/logger.ts` | Error-level logs auto-sent to Sentry via Pino hooks |
| Graceful Degradation | `src/logging/pretty.ts` | Falls back to JSON when Discord logging unavailable |
| Permission Validation | `src/features/logger.ts` | Pre-flight permission checks with diagnostics |

### Weaknesses (Fix These)

| Issue | Location | Severity | Impact |
|-------|----------|----------|--------|
| Silent .catch() | `src/lib/logger.ts:88-94` | Low | Sentry import failures invisible |
| No Error Type System | Across codebase | Medium | Generic error handling, no recovery strategies |
| Debug-level Failures | `src/index.ts` messageCreate | Medium | Production failures logged at debug level |
| Schema Check Failures | `src/index.ts:206-233` | Medium | Bot may start with missing schema |

---

## Phase 1: Error Type System (Priority: High)

### 1.1 Create Error Classification Module

**File**: `src/lib/errors.ts`

```typescript
/**
 * Pawtropolis Tech — src/lib/errors.ts
 * WHAT: Discriminated union error types for precise error handling
 * WHY: Enables specific recovery strategies and better observability
 */

// Base error interface
export interface AppError {
  kind: string;
  message: string;
  cause?: Error;
}

// Database errors
export interface DbError extends AppError {
  kind: "db_error";
  code: string; // SQLITE_CONSTRAINT, SQLITE_BUSY, etc.
  sql?: string;
  table?: string;
}

// Discord API errors
export interface DiscordApiError extends AppError {
  kind: "discord_api";
  code: number; // 10062, 50013, 40060, etc.
  httpStatus?: number;
  method?: string;
  path?: string;
}

// Validation errors
export interface ValidationError extends AppError {
  kind: "validation";
  field: string;
  value?: unknown;
}

// Permission errors
export interface PermissionError extends AppError {
  kind: "permission";
  needed: string[];
  channelId?: string;
}

// Network errors
export interface NetworkError extends AppError {
  kind: "network";
  code: string; // ECONNRESET, ETIMEDOUT, ENOTFOUND
  host?: string;
}

// Union type
export type ClassifiedError =
  | DbError
  | DiscordApiError
  | ValidationError
  | PermissionError
  | NetworkError
  | { kind: "unknown"; message: string; cause?: Error };

/**
 * Classify any caught error into a discriminated union
 */
export function classifyError(err: unknown): ClassifiedError {
  if (!err) {
    return { kind: "unknown", message: "Unknown error (null/undefined)" };
  }

  const error = err as any;
  const message = error?.message ?? String(err);

  // SQLite errors
  if (error?.name === "SqliteError" || error?.code?.startsWith("SQLITE_")) {
    return {
      kind: "db_error",
      code: error.code ?? "UNKNOWN",
      message,
      sql: error.sql,
      cause: error,
    };
  }

  // Discord API errors
  if (error?.name === "DiscordAPIError" || error?.code !== undefined && typeof error.code === "number") {
    return {
      kind: "discord_api",
      code: error.code,
      httpStatus: error.httpStatus ?? error.status,
      method: error.method,
      path: error.path ?? error.url,
      message,
      cause: error,
    };
  }

  // Network errors
  if (["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED"].includes(error?.code)) {
    return {
      kind: "network",
      code: error.code,
      host: error.hostname ?? error.host,
      message,
      cause: error,
    };
  }

  // Permission errors (Discord.js DiscordAPIError with code 50013)
  if (error?.code === 50013) {
    return {
      kind: "permission",
      needed: ["Unknown"],
      message,
      cause: error,
    };
  }

  return { kind: "unknown", message, cause: error };
}

/**
 * Check if error is recoverable (worth retrying)
 */
export function isRecoverable(err: ClassifiedError): boolean {
  switch (err.kind) {
    case "network":
      return true; // Transient, retry
    case "db_error":
      return err.code === "SQLITE_BUSY"; // Database locked, retry
    case "discord_api":
      return [500, 502, 503, 504].includes(err.httpStatus ?? 0); // Server errors
    default:
      return false;
  }
}

/**
 * Check if error should be reported to Sentry
 */
export function shouldReportToSentry(err: ClassifiedError): boolean {
  switch (err.kind) {
    case "discord_api":
      // Ignore expected API errors
      return ![10062, 40060, 10008].includes(err.code);
    case "network":
      return false; // Transient, don't spam Sentry
    case "validation":
      return false; // User error, not a bug
    default:
      return true;
  }
}
```

### 1.2 Update Error Handling in cmdWrap.ts

Add error classification to the command wrapper:

```typescript
import { classifyError, shouldReportToSentry } from "./errors.js";

// In the catch block:
catch (err) {
  const classified = classifyError(err);

  logger.error({
    evt: "cmd_error",
    traceId,
    cmd: cmdName,
    errorKind: classified.kind,
    errorCode: "code" in classified ? classified.code : undefined,
    ...
  }, `[${cmdName}] ${classified.message}`);

  if (shouldReportToSentry(classified)) {
    captureException(err, { cmd: cmdName, errorKind: classified.kind });
  }
}
```

---

## Phase 2: Eliminate Silent Suppressions (Priority: High)

### 2.1 Fix Sentry Import Suppression

**File**: `src/lib/logger.ts` (lines 88-94)

**Current**:
```typescript
import("./sentry.js")
  .then(...)
  .catch(() => undefined); // Silent!
```

**Fixed**:
```typescript
import("./sentry.js")
  .then(({ captureException, isSentryEnabled }) => {
    if (isSentryEnabled()) {
      captureException(errorCandidate, { message, level: label });
    }
  })
  .catch((importErr) => {
    // Log once, don't spam
    if (!sentryImportWarned) {
      sentryImportWarned = true;
      console.warn("[logger] Failed to import Sentry module:", importErr?.message);
    }
  });
```

### 2.2 Audit All .catch() Usages

Run this command to find all silent catches:

```bash
grep -rn "\.catch\s*(\s*(\s*)\s*=>" src/ --include="*.ts"
grep -rn "\.catch\s*(\s*_\s*=>" src/ --include="*.ts"
grep -rn "\.catch\s*(\s*(\s*)\s*{\s*}" src/ --include="*.ts"
```

**Decision Matrix for Each**:

| Pattern | Action |
|---------|--------|
| `.catch(() => undefined)` | Replace with `.catch(err => logger.warn({err}, "context"))` |
| `.catch(() => {})` | Same as above |
| `.catch((_err) => { /* intentional */ })` | Add explicit comment explaining why |

---

## Phase 3: Event Handler Resilience (Priority: Medium)

### 3.1 Create Event Handler Wrapper

**File**: `src/lib/eventWrap.ts`

```typescript
/**
 * Pawtropolis Tech — src/lib/eventWrap.ts
 * WHAT: Safe wrapper for Discord.js event handlers
 * WHY: Ensures events never crash the bot, always logged
 */

import { logger } from "./logger.js";
import { captureException } from "./sentry.js";
import { classifyError, shouldReportToSentry } from "./errors.js";

type EventHandler<T extends any[]> = (...args: T) => Promise<void> | void;

/**
 * Wrap an event handler with error protection
 */
export function wrapEvent<T extends any[]>(
  eventName: string,
  handler: EventHandler<T>
): EventHandler<T> {
  return async (...args: T) => {
    try {
      await handler(...args);
    } catch (err) {
      const classified = classifyError(err);

      logger.error(
        {
          evt: "event_error",
          event: eventName,
          errorKind: classified.kind,
          err
        },
        `[${eventName}] event handler failed: ${classified.message}`
      );

      if (shouldReportToSentry(classified)) {
        captureException(err, { event: eventName, errorKind: classified.kind });
      }
      // Never re-throw - keep bot running
    }
  };
}
```

### 3.2 Apply to All Event Handlers

**File**: `src/index.ts`

```typescript
import { wrapEvent } from "./lib/eventWrap.js";

// Before:
client.on("guildMemberAdd", async (member) => { ... });

// After:
client.on("guildMemberAdd", wrapEvent("guildMemberAdd", async (member) => { ... }));
```

---

## Phase 4: Logging Improvements (Priority: Medium)

### 4.1 Standardize Log Levels

| Level | Use Case | Example |
|-------|----------|---------|
| `fatal` | Unrecoverable, process must exit | Database corruption |
| `error` | Unexpected failure, needs investigation | Command crash, API failure |
| `warn` | Expected failure, recoverable | User not found, permission denied |
| `info` | Significant operations | Command executed, role granted |
| `debug` | Detailed debugging | SQL queries, API responses |
| `trace` | Extremely verbose | Function entry/exit |

### 4.2 Fix Debug-Level Failure Logging

**File**: `src/index.ts` (messageCreate handler)

**Current**:
```typescript
} catch (err) {
  logger.debug({ err, messageId }, "[message_activity] failed"); // Too quiet!
}
```

**Fixed**:
```typescript
} catch (err) {
  logger.warn({ err, messageId }, "[message_activity] failed to log message");
}
```

### 4.3 Add Structured Error Context

Create helper for consistent error logging:

```typescript
// src/lib/errorContext.ts
export function errorContext(err: unknown, extra: Record<string, unknown> = {}) {
  const classified = classifyError(err);
  return {
    errorKind: classified.kind,
    errorMessage: classified.message,
    ...(classified.kind === "db_error" && {
      sqlCode: classified.code,
      sql: classified.sql?.slice(0, 100)
    }),
    ...(classified.kind === "discord_api" && {
      discordCode: classified.code,
      httpStatus: classified.httpStatus
    }),
    ...extra,
  };
}

// Usage:
logger.error(errorContext(err, { userId, guildId }), "operation failed");
```

---

## Phase 5: Resilience Patterns (Priority: Low)

### 5.1 Retry Helper for Transient Failures

**File**: `src/lib/retry.ts`

```typescript
/**
 * Retry an async operation with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    shouldRetry?: (err: unknown) => boolean;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 100,
    shouldRetry = (err) => isRecoverable(classifyError(err))
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts || !shouldRetry(err)) {
        throw err;
      }

      const delayMs = initialDelayMs * Math.pow(2, attempt - 1);
      logger.debug({ attempt, delayMs, err }, "[retry] retrying after failure");
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  throw lastError;
}
```

### 5.2 Circuit Breaker for External Services

**File**: `src/lib/circuitBreaker.ts`

```typescript
/**
 * Circuit breaker to prevent cascading failures
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private name: string,
    private threshold = 5,
    private resetTimeMs = 60000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === "open") {
      if (Date.now() - this.lastFailure > this.resetTimeMs) {
        this.state = "half-open";
      } else {
        throw new Error(`Circuit breaker [${this.name}] is open`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = "closed";
  }

  private onFailure() {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.failures >= this.threshold) {
      this.state = "open";
      logger.warn({ breaker: this.name, failures: this.failures },
        "[circuit-breaker] opened due to failures");
    }
  }
}
```

---

## Phase 6: Startup Robustness (Priority: Medium)

### 6.1 Critical Schema Validation

Make schema failures block startup for critical tables:

```typescript
// src/index.ts startup
const CRITICAL_TABLES = ["application", "guild_config", "action_log"];

for (const table of CRITICAL_TABLES) {
  const exists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(table);

  if (!exists) {
    logger.fatal({ table }, "[startup] Critical table missing, cannot start");
    process.exit(1);
  }
}
```

### 6.2 Startup Health Summary

Log a startup health summary:

```typescript
// After all ensure* calls
const health = {
  criticalTables: CRITICAL_TABLES.length,
  loggingChannels: validLoggingChannels,
  sentryEnabled: isSentryEnabled(),
  schemaVersion: getSchemaVersion(),
};

logger.info(health, "[startup] Bot health summary");

if (validLoggingChannels === 0) {
  logger.warn("[startup] No valid logging channels configured");
}
```

---

## Implementation Checklist

### Phase 1: Error Type System
- [ ] Create `src/lib/errors.ts` with error types
- [ ] Add `classifyError()` function
- [ ] Add `isRecoverable()` and `shouldReportToSentry()` helpers
- [ ] Update `cmdWrap.ts` to use error classification
- [ ] Write tests for error classification

### Phase 2: Silent Suppressions
- [ ] Fix `.catch(() => undefined)` in `logger.ts`
- [ ] Audit all `.catch()` usages in codebase
- [ ] Add warning logs for previously silent failures
- [ ] Document intentional suppressions

### Phase 3: Event Handler Resilience
- [ ] Create `src/lib/eventWrap.ts`
- [ ] Apply `wrapEvent()` to all Discord.js event handlers
- [ ] Verify no events can crash the bot
- [ ] Add tests for event error handling

### Phase 4: Logging Improvements
- [ ] Review all `logger.debug()` calls for failure cases
- [ ] Upgrade failure logs to `warn` or `error` level
- [ ] Add `errorContext()` helper
- [ ] Standardize log field names

### Phase 5: Resilience Patterns
- [ ] Create `src/lib/retry.ts`
- [ ] Create `src/lib/circuitBreaker.ts`
- [ ] Apply retry to Discord API calls where appropriate
- [ ] Add circuit breaker for Sentry (already partially done)

### Phase 6: Startup Robustness
- [ ] Add critical table validation
- [ ] Add startup health summary
- [ ] Add schema version logging
- [ ] Consider blocking startup for missing critical config

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Silent .catch() suppressions | ~5 | 0 |
| Event handlers without try/catch | 0 | 0 (maintain) |
| Error type coverage | 0% | 100% |
| Sentry error noise (ignored) | Low | Lower |
| Startup validation coverage | Medium | High |

---

## Appendix: Error Code Reference

### Discord API Error Codes

| Code | Meaning | Handling |
|------|---------|----------|
| 10062 | Unknown interaction (expired) | Ignore, log debug |
| 40060 | Interaction already acknowledged | Ignore, log debug |
| 50013 | Missing permissions | Log warn, show user error |
| 10008 | Unknown message | Log debug, may be deleted |
| 50001 | Missing access | Log warn, check channel perms |

### SQLite Error Codes

| Code | Meaning | Handling |
|------|---------|----------|
| SQLITE_BUSY | Database locked | Retry with backoff |
| SQLITE_CONSTRAINT | Constraint violation | Log error, don't retry |
| SQLITE_CORRUPT | Database corruption | Fatal, alert immediately |

---

*Last updated: 2025-11-26*
