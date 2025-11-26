/**
 * Pawtropolis Tech — src/lib/errors.ts
 * WHAT: Discriminated union error types for precise error handling
 * WHY: Enables specific recovery strategies and better observability
 * FLOWS:
 *  - classifyError(err) → ClassifiedError union type
 *  - isRecoverable(err) → boolean (worth retrying)
 *  - shouldReportToSentry(err) → boolean (filter noise)
 * USAGE:
 *  import { classifyError, isRecoverable } from "./errors.js";
 *  const classified = classifyError(err);
 *  if (classified.kind === "discord_api" && classified.code === 10062) { ... }
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// ===== Error Type Definitions =====

/**
 * Base error interface for the discriminated union pattern.
 *
 * The `kind` field is the discriminator - TypeScript uses it to narrow types
 * in switch statements. This is more type-safe than instanceof checks because
 * it works across module boundaries and doesn't depend on prototype chains.
 */
export interface AppError {
  kind: string;
  message: string;
  cause?: Error;
}

/**
 * Database errors (SQLite).
 *
 * The `code` field maps to SQLite error codes. The important ones:
 * - SQLITE_BUSY/SQLITE_LOCKED: Transient, can retry
 * - SQLITE_CONSTRAINT_*: Logic error, don't retry
 * - SQLITE_CORRUPT/SQLITE_NOTADB: Fatal, alert ops immediately
 */
export interface DbError extends AppError {
  kind: "db_error";
  code: string; // SQLITE_CONSTRAINT, SQLITE_BUSY, SQLITE_CORRUPT, etc.
  sql?: string;
  table?: string;
}

/**
 * Discord API errors.
 *
 * Discord uses numeric codes (not HTTP status) to identify specific errors.
 * Common ones that need special handling:
 * - 10062: Unknown Interaction (3s timeout expired, very common)
 * - 40060: Already acknowledged (double-reply, usually harmless)
 * - 50013: Missing Permissions
 * - 50001: Missing Access (can't see channel)
 *
 * See: https://discord.com/developers/docs/topics/opcodes-and-status-codes
 */
export interface DiscordApiError extends AppError {
  kind: "discord_api";
  code: number; // 10062, 50013, 40060, etc.
  httpStatus?: number;
  method?: string;
  path?: string;
}

/** Validation errors (user input) */
export interface ValidationError extends AppError {
  kind: "validation";
  field: string;
  value?: unknown;
}

/** Permission errors (Discord permissions) */
export interface PermissionError extends AppError {
  kind: "permission";
  needed: string[];
  channelId?: string;
  guildId?: string;
}

/**
 * Network errors (transient).
 *
 * These are Node.js system errors, not HTTP errors. They indicate the request
 * never reached the server or the connection dropped mid-flight. Almost always
 * worth retrying after a short delay.
 */
export interface NetworkError extends AppError {
  kind: "network";
  code: string; // ECONNRESET, ETIMEDOUT, ENOTFOUND, ECONNREFUSED
  host?: string;
}

/** Configuration errors */
export interface ConfigError extends AppError {
  kind: "config";
  key: string;
  expected?: string;
}

/** Unknown/unclassified errors */
export interface UnknownError extends AppError {
  kind: "unknown";
}

/** Discriminated union of all error types */
export type ClassifiedError =
  | DbError
  | DiscordApiError
  | ValidationError
  | PermissionError
  | NetworkError
  | ConfigError
  | UnknownError;

// ===== Error Classification =====

/**
 * Classify any caught error into a discriminated union.
 *
 * This is the main entry point - catch blocks should call this immediately.
 * The heuristics here are intentionally ordered from most specific to least:
 * SQLite errors first (they have distinctive markers), then Discord errors,
 * then network errors, then fallback to unknown.
 *
 * The type assertion to Record<string,unknown> is necessary because we're
 * receiving `unknown` and need to probe for properties. It's safe because
 * we check each property exists before using it.
 */
export function classifyError(err: unknown): ClassifiedError {
  if (!err) {
    return { kind: "unknown", message: "Unknown error (null/undefined)" };
  }

  // Handle Error-like objects
  const error = err as Record<string, unknown>;
  const message = (error?.message as string) ?? String(err);
  const code = error?.code;
  const name = error?.name as string | undefined;

  // SQLite errors
  if (
    name === "SqliteError" ||
    (typeof code === "string" && code.startsWith("SQLITE_"))
  ) {
    return {
      kind: "db_error",
      code: (code as string) ?? "UNKNOWN",
      message,
      sql: error?.sql as string | undefined,
      table: extractTableFromSql(error?.sql as string | undefined),
      cause: err instanceof Error ? err : undefined,
    };
  }

  // Discord API errors (DiscordAPIError has numeric code)
  if (
    name === "DiscordAPIError" ||
    (name?.includes("Discord") && typeof code === "number")
  ) {
    return {
      kind: "discord_api",
      code: code as number,
      httpStatus: (error?.httpStatus ?? error?.status) as number | undefined,
      method: error?.method as string | undefined,
      path: (error?.path ?? error?.url) as string | undefined,
      message,
      cause: err instanceof Error ? err : undefined,
    };
  }

  // Network errors - these are Node.js libuv error codes.
  // EAI_AGAIN is DNS resolution failure (transient), often seen during network hiccups.
  if (
    typeof code === "string" &&
    ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EPIPE", "EAI_AGAIN"].includes(code)
  ) {
    return {
      kind: "network",
      code,
      host: (error?.hostname ?? error?.host) as string | undefined,
      message,
      cause: err instanceof Error ? err : undefined,
    };
  }

  // Discord permission error (code 50013 = Missing Permissions)
  // We can't know which permission is missing from the error alone, so we mark it unknown.
  // The caller should check channel.permissionsFor() to get specifics.
  if (code === 50013) {
    return {
      kind: "permission",
      needed: ["Unknown"],
      message,
      cause: err instanceof Error ? err : undefined,
    };
  }

  // Discord missing access (code 50001) - bot can't see the channel at all.
  // This is different from 50013 which means "can see but can't do X".
  if (code === 50001) {
    return {
      kind: "permission",
      needed: ["ViewChannel"],
      message,
      cause: err instanceof Error ? err : undefined,
    };
  }

  // Fallback: unknown error
  return {
    kind: "unknown",
    message,
    cause: err instanceof Error ? err : undefined,
  };
}

// ===== Error Predicates =====

/**
 * Check if error is recoverable (worth retrying).
 *
 * Be conservative here - false positives (retrying non-recoverable errors)
 * waste resources and can amplify outages. False negatives just mean we
 * fail faster, which is usually fine.
 *
 * Note: Discord rate limits (429) are handled by discord.js internally,
 * so we don't need to retry those ourselves.
 */
export function isRecoverable(err: ClassifiedError): boolean {
  switch (err.kind) {
    case "network":
      return true; // Transient, retry

    case "db_error":
      // Only retry database locked errors - these happen when another
      // connection has an exclusive lock. Constraint violations are
      // logic errors and will fail again.
      return err.code === "SQLITE_BUSY" || err.code === "SQLITE_LOCKED";

    case "discord_api":
      // Retry server errors (5xx) - Discord is having a bad day
      const status = err.httpStatus ?? 0;
      return status >= 500 && status < 600;

    default:
      return false;
  }
}

/**
 * Check if error should be reported to Sentry.
 *
 * The goal is signal-to-noise ratio. Sentry alerts should mean "something
 * is actually broken" not "Discord had a hiccup" or "user did something weird".
 *
 * If you're getting paged at 3am for 10062 errors, add them here.
 */
export function shouldReportToSentry(err: ClassifiedError): boolean {
  switch (err.kind) {
    case "discord_api":
      // Ignore expected/common Discord API errors - these are operational,
      // not bugs. We log them for debugging but don't alert on them.
      const ignoredCodes = [
        10062, // Unknown interaction (expired, 3s timeout) - VERY common
        40060, // Interaction already acknowledged - harmless race
        10008, // Unknown message (deleted before we could act)
        10003, // Unknown channel (deleted channel)
        50013, // Missing permissions (guild admin changed bot perms)
      ];
      return !ignoredCodes.includes(err.code);

    case "network":
      return false; // Transient, don't spam Sentry

    case "validation":
      return false; // User error, not a bug

    case "permission":
      return false; // Configuration issue, not a bug

    default:
      return true;
  }
}

/**
 * Check if error is a Discord "interaction expired" error
 */
export function isInteractionExpired(err: ClassifiedError): boolean {
  return err.kind === "discord_api" && err.code === 10062;
}

/**
 * Check if error is a Discord "already acknowledged" error
 */
export function isAlreadyAcknowledged(err: ClassifiedError): boolean {
  return err.kind === "discord_api" && err.code === 40060;
}

/**
 * Check if error is a database constraint violation.
 *
 * These are usually logic errors (duplicate insert, FK violation) but can
 * also indicate race conditions in concurrent code. If you're seeing these
 * unexpectedly, check your transaction boundaries.
 */
export function isConstraintViolation(err: ClassifiedError): boolean {
  return (
    err.kind === "db_error" &&
    (err.code === "SQLITE_CONSTRAINT" ||
      err.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
      err.code === "SQLITE_CONSTRAINT_UNIQUE" ||
      err.code === "SQLITE_CONSTRAINT_FOREIGNKEY")
  );
}

/**
 * Check if error is a database corruption (fatal)
 */
export function isDatabaseCorrupt(err: ClassifiedError): boolean {
  return (
    err.kind === "db_error" &&
    (err.code === "SQLITE_CORRUPT" || err.code === "SQLITE_NOTADB")
  );
}

// ===== Error Context Helpers =====

/**
 * Extract structured context from a classified error for logging
 */
export function errorContext(
  err: ClassifiedError,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const base = {
    errorKind: err.kind,
    errorMessage: err.message,
    ...extra,
  };

  switch (err.kind) {
    case "db_error":
      return {
        ...base,
        sqlCode: err.code,
        sql: err.sql?.slice(0, 100),
        table: err.table,
      };

    case "discord_api":
      return {
        ...base,
        discordCode: err.code,
        httpStatus: err.httpStatus,
        method: err.method,
        path: err.path,
      };

    case "network":
      return {
        ...base,
        networkCode: err.code,
        host: err.host,
      };

    case "permission":
      return {
        ...base,
        neededPerms: err.needed,
        channelId: err.channelId,
        guildId: err.guildId,
      };

    default:
      return base;
  }
}

/**
 * Get a user-friendly error message for display
 */
export function userFriendlyMessage(err: ClassifiedError): string {
  switch (err.kind) {
    case "db_error":
      if (err.code === "SQLITE_BUSY") {
        return "Database is temporarily busy. Please try again.";
      }
      if (isConstraintViolation(err)) {
        return "This operation conflicts with existing data.";
      }
      return "A database error occurred.";

    case "discord_api":
      if (err.code === 10062) {
        return "This interaction has expired. Please try the command again.";
      }
      if (err.code === 50013) {
        return "I don't have permission to do that.";
      }
      if (err.code === 50001) {
        return "I can't access that channel.";
      }
      return "Discord API error occurred.";

    case "network":
      return "Network error. Please check your connection and try again.";

    case "permission":
      return `Missing permissions: ${err.needed.join(", ")}`;

    case "validation":
      return `Invalid ${err.field}: ${err.message}`;

    case "config":
      return `Configuration error: ${err.key} is not set correctly.`;

    default:
      return "An unexpected error occurred.";
  }
}

// ===== Internal Helpers =====

/**
 * Extract table name from SQL query (best effort).
 *
 * This is purely for diagnostics - the regex is simple and won't handle
 * subqueries, CTEs, or quoted identifiers. That's fine; we just want a
 * hint for the error context, not a SQL parser.
 */
function extractTableFromSql(sql: string | undefined): string | undefined {
  if (!sql) return undefined;

  // Match common patterns: FROM table, INTO table, UPDATE table
  const match = sql.match(/(?:FROM|INTO|UPDATE|JOIN)\s+(\w+)/i);
  return match?.[1];
}
