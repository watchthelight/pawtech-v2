/**
 * Pawtropolis Tech -- tests/lib/errors.test.ts
 * WHAT: Tests for the error classification system.
 * WHY: Error handling is critical for reliability; these tests ensure errors
 *      are correctly classified, reported, and presented to users.
 *
 * The error system uses discriminated unions to enable type-safe error handling.
 * Each error kind has specific properties and behaviors for recovery, reporting,
 * and user-facing messages.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import {
  classifyError,
  isRecoverable,
  shouldReportToSentry,
  isConstraintViolation,
  errorContext,
  userFriendlyMessage,
  type ClassifiedError,
} from "../../src/lib/errors.js";
import {
  createDiscordAPIError,
  createNetworkError,
  createSqliteError,
} from "../utils/discordMocks.js";

// ===== classifyError Tests =====

describe("classifyError", () => {
  describe("null/undefined handling", () => {
    it("classifies null as unknown", () => {
      const result = classifyError(null);
      expect(result.kind).toBe("unknown");
      expect(result.message).toBe("Unknown error (null/undefined)");
    });

    it("classifies undefined as unknown", () => {
      const result = classifyError(undefined);
      expect(result.kind).toBe("unknown");
      expect(result.message).toBe("Unknown error (null/undefined)");
    });
  });

  describe("SQLite error classification", () => {
    it("classifies SqliteError by name", () => {
      const err = createSqliteError("SQLITE_CONSTRAINT", "UNIQUE constraint failed");
      const result = classifyError(err);

      expect(result.kind).toBe("db_error");
      expect(result).toMatchObject({
        kind: "db_error",
        code: "SQLITE_CONSTRAINT",
        message: "UNIQUE constraint failed",
      });
    });

    it("classifies error by SQLITE_ code prefix", () => {
      const err = new Error("database is locked") as Error & { code: string };
      err.code = "SQLITE_BUSY";

      const result = classifyError(err);
      expect(result.kind).toBe("db_error");
      expect((result as { code: string }).code).toBe("SQLITE_BUSY");
    });

    it("extracts table name from SQL", () => {
      const err = createSqliteError(
        "SQLITE_CONSTRAINT_UNIQUE",
        "UNIQUE constraint failed: application.id",
        "INSERT INTO application (id, guild_id) VALUES (?, ?)"
      );

      const result = classifyError(err);
      expect(result.kind).toBe("db_error");
      expect((result as { table?: string }).table).toBe("application");
    });

    it("extracts table name from UPDATE statement", () => {
      const err = createSqliteError(
        "SQLITE_ERROR",
        "no such column",
        "UPDATE guild_config SET foo = ? WHERE guild_id = ?"
      );

      const result = classifyError(err);
      expect((result as { table?: string }).table).toBe("guild_config");
    });

    it("handles missing SQL gracefully", () => {
      const err = createSqliteError("SQLITE_CORRUPT", "database disk image is malformed");

      const result = classifyError(err);
      expect(result.kind).toBe("db_error");
      expect((result as { sql?: string }).sql).toBeUndefined();
      expect((result as { table?: string }).table).toBeUndefined();
    });
  });

  describe("Discord API error classification", () => {
    it("classifies DiscordAPIError by name", () => {
      const err = createDiscordAPIError(10062, "Unknown interaction");

      const result = classifyError(err);
      expect(result.kind).toBe("discord_api");
      expect((result as { code: number }).code).toBe(10062);
    });

    it("captures HTTP status from Discord errors", () => {
      const err = createDiscordAPIError(50013, "Missing Permissions", 403);

      const result = classifyError(err);
      expect(result.kind).toBe("discord_api");
      expect((result as { httpStatus?: number }).httpStatus).toBe(403);
    });

    it("handles Discord error with name containing Discord", () => {
      const err = new Error("Rate limited") as Error & { name: string; code: number };
      err.name = "DiscordHTTPError";
      err.code = 429;

      const result = classifyError(err);
      expect(result.kind).toBe("discord_api");
      expect((result as { code: number }).code).toBe(429);
    });
  });

  describe("Network error classification", () => {
    it("classifies ECONNRESET as network error", () => {
      const err = createNetworkError("ECONNRESET");

      const result = classifyError(err);
      expect(result.kind).toBe("network");
      expect((result as { code: string }).code).toBe("ECONNRESET");
    });

    it("classifies ETIMEDOUT as network error", () => {
      const err = createNetworkError("ETIMEDOUT");

      const result = classifyError(err);
      expect(result.kind).toBe("network");
    });

    it("classifies ENOTFOUND as network error", () => {
      const err = createNetworkError("ENOTFOUND");

      const result = classifyError(err);
      expect(result.kind).toBe("network");
    });

    it("classifies ECONNREFUSED as network error", () => {
      const err = createNetworkError("ECONNREFUSED");

      const result = classifyError(err);
      expect(result.kind).toBe("network");
    });

    it("classifies EPIPE as network error", () => {
      const err = createNetworkError("EPIPE");

      const result = classifyError(err);
      expect(result.kind).toBe("network");
    });

    it("classifies EAI_AGAIN as network error", () => {
      const err = createNetworkError("EAI_AGAIN");

      const result = classifyError(err);
      expect(result.kind).toBe("network");
    });

    it("captures hostname from network errors", () => {
      const err = createNetworkError("ENOTFOUND") as Error & { code: string; hostname: string };
      err.hostname = "discord.com";

      const result = classifyError(err);
      expect(result.kind).toBe("network");
      expect((result as { host?: string }).host).toBe("discord.com");
    });
  });

  describe("Permission error classification", () => {
    it("classifies code 50013 as permission error", () => {
      const err = { code: 50013, message: "Missing Permissions" };

      const result = classifyError(err);
      expect(result.kind).toBe("permission");
      expect((result as { needed: string[] }).needed).toContain("Unknown");
    });

    it("classifies code 50001 as permission error with ViewChannel", () => {
      const err = { code: 50001, message: "Missing Access" };

      const result = classifyError(err);
      expect(result.kind).toBe("permission");
      expect((result as { needed: string[] }).needed).toContain("ViewChannel");
    });
  });

  describe("Unknown error classification", () => {
    it("classifies plain Error as unknown", () => {
      const err = new Error("Something went wrong");

      const result = classifyError(err);
      expect(result.kind).toBe("unknown");
      expect(result.message).toBe("Something went wrong");
    });

    it("classifies string as unknown", () => {
      const result = classifyError("string error");

      expect(result.kind).toBe("unknown");
      expect(result.message).toBe("string error");
    });

    it("classifies number as unknown", () => {
      const result = classifyError(42);

      expect(result.kind).toBe("unknown");
      expect(result.message).toBe("42");
    });

    it("preserves cause for Error instances", () => {
      const cause = new Error("root cause");
      const err = new Error("wrapped error");
      (err as { cause?: Error }).cause = cause;

      const result = classifyError(err);
      expect(result.cause).toBe(err);
    });
  });
});

// ===== isRecoverable Tests =====

describe("isRecoverable", () => {
  it("returns true for network errors", () => {
    const err = classifyError(createNetworkError("ECONNRESET"));
    expect(isRecoverable(err)).toBe(true);
  });

  it("returns true for SQLITE_BUSY", () => {
    const err = classifyError(createSqliteError("SQLITE_BUSY", "database is locked"));
    expect(isRecoverable(err)).toBe(true);
  });

  it("returns true for SQLITE_LOCKED", () => {
    const err = classifyError(createSqliteError("SQLITE_LOCKED", "database table is locked"));
    expect(isRecoverable(err)).toBe(true);
  });

  it("returns false for SQLITE_CONSTRAINT", () => {
    const err = classifyError(createSqliteError("SQLITE_CONSTRAINT", "constraint failed"));
    expect(isRecoverable(err)).toBe(false);
  });

  it("returns false for SQLITE_CORRUPT", () => {
    const err = classifyError(createSqliteError("SQLITE_CORRUPT", "database disk image is malformed"));
    expect(isRecoverable(err)).toBe(false);
  });

  it("returns true for Discord 5xx errors", () => {
    const err = classifyError(createDiscordAPIError(0, "Internal Server Error", 500));
    expect(isRecoverable(err)).toBe(true);
  });

  it("returns true for Discord 503 errors", () => {
    const err = classifyError(createDiscordAPIError(0, "Service Unavailable", 503));
    expect(isRecoverable(err)).toBe(true);
  });

  it("returns false for Discord 4xx errors", () => {
    const err = classifyError(createDiscordAPIError(50013, "Missing Permissions", 403));
    expect(isRecoverable(err)).toBe(false);
  });

  it("returns false for unknown errors", () => {
    const err = classifyError(new Error("mystery"));
    expect(isRecoverable(err)).toBe(false);
  });

  it("returns false for validation errors", () => {
    const err: ClassifiedError = {
      kind: "validation",
      field: "username",
      message: "too long",
    };
    expect(isRecoverable(err)).toBe(false);
  });

  it("returns false for permission errors", () => {
    const err: ClassifiedError = {
      kind: "permission",
      needed: ["ManageRoles"],
      message: "Missing permissions",
    };
    expect(isRecoverable(err)).toBe(false);
  });
});

// ===== shouldReportToSentry Tests =====

describe("shouldReportToSentry", () => {
  describe("Discord API errors", () => {
    it("filters out 10062 (Unknown interaction)", () => {
      const err = classifyError(createDiscordAPIError(10062, "Unknown interaction"));
      expect(shouldReportToSentry(err)).toBe(false);
    });

    it("filters out 40060 (Interaction already acknowledged)", () => {
      const err = classifyError(createDiscordAPIError(40060, "Interaction has already been acknowledged"));
      expect(shouldReportToSentry(err)).toBe(false);
    });

    it("filters out 10008 (Unknown message)", () => {
      const err = classifyError(createDiscordAPIError(10008, "Unknown Message"));
      expect(shouldReportToSentry(err)).toBe(false);
    });

    it("filters out 10003 (Unknown channel)", () => {
      const err = classifyError(createDiscordAPIError(10003, "Unknown Channel"));
      expect(shouldReportToSentry(err)).toBe(false);
    });

    it("filters out 50013 (Missing permissions)", () => {
      const err = classifyError(createDiscordAPIError(50013, "Missing Permissions"));
      expect(shouldReportToSentry(err)).toBe(false);
    });

    it("reports unexpected Discord API errors", () => {
      const err = classifyError(createDiscordAPIError(50035, "Invalid Form Body"));
      expect(shouldReportToSentry(err)).toBe(true);
    });
  });

  describe("Network errors", () => {
    it("does not report network errors", () => {
      const err = classifyError(createNetworkError("ECONNRESET"));
      expect(shouldReportToSentry(err)).toBe(false);
    });
  });

  describe("Validation errors", () => {
    it("does not report validation errors", () => {
      const err: ClassifiedError = {
        kind: "validation",
        field: "input",
        message: "invalid",
      };
      expect(shouldReportToSentry(err)).toBe(false);
    });
  });

  describe("Permission errors", () => {
    it("does not report permission errors", () => {
      const err: ClassifiedError = {
        kind: "permission",
        needed: ["ManageGuild"],
        message: "Missing permission",
      };
      expect(shouldReportToSentry(err)).toBe(false);
    });
  });

  describe("Database errors", () => {
    it("reports database errors by default", () => {
      const err = classifyError(createSqliteError("SQLITE_ERROR", "syntax error"));
      expect(shouldReportToSentry(err)).toBe(true);
    });
  });

  describe("Unknown errors", () => {
    it("reports unknown errors", () => {
      const err = classifyError(new Error("unexpected"));
      expect(shouldReportToSentry(err)).toBe(true);
    });
  });
});

// ===== Error Predicate Tests =====

describe("isConstraintViolation", () => {
  it("returns true for SQLITE_CONSTRAINT", () => {
    const err = classifyError(createSqliteError("SQLITE_CONSTRAINT", "constraint failed"));
    expect(isConstraintViolation(err)).toBe(true);
  });

  it("returns true for SQLITE_CONSTRAINT_PRIMARYKEY", () => {
    const err = classifyError(createSqliteError("SQLITE_CONSTRAINT_PRIMARYKEY", "PRIMARY KEY constraint failed"));
    expect(isConstraintViolation(err)).toBe(true);
  });

  it("returns true for SQLITE_CONSTRAINT_UNIQUE", () => {
    const err = classifyError(createSqliteError("SQLITE_CONSTRAINT_UNIQUE", "UNIQUE constraint failed"));
    expect(isConstraintViolation(err)).toBe(true);
  });

  it("returns true for SQLITE_CONSTRAINT_FOREIGNKEY", () => {
    const err = classifyError(createSqliteError("SQLITE_CONSTRAINT_FOREIGNKEY", "FOREIGN KEY constraint failed"));
    expect(isConstraintViolation(err)).toBe(true);
  });

  it("returns false for SQLITE_BUSY", () => {
    const err = classifyError(createSqliteError("SQLITE_BUSY", "database is locked"));
    expect(isConstraintViolation(err)).toBe(false);
  });

  it("returns false for non-database errors", () => {
    const err = classifyError(new Error("not a db error"));
    expect(isConstraintViolation(err)).toBe(false);
  });
});

// ===== errorContext Tests =====

describe("errorContext", () => {
  it("includes base fields for all errors", () => {
    const err = classifyError(new Error("test"));
    const ctx = errorContext(err);

    expect(ctx.errorKind).toBe("unknown");
    expect(ctx.errorMessage).toBe("test");
  });

  it("includes db-specific fields for database errors", () => {
    const err = classifyError(
      createSqliteError("SQLITE_CONSTRAINT", "constraint failed", "INSERT INTO foo VALUES (?)")
    );
    const ctx = errorContext(err);

    expect(ctx.sqlCode).toBe("SQLITE_CONSTRAINT");
    expect(ctx.sql).toContain("INSERT INTO foo");
    expect(ctx.table).toBe("foo");
  });

  it("truncates long SQL in context", () => {
    const longSql = "SELECT " + "a".repeat(200) + " FROM table";
    const err = classifyError(createSqliteError("SQLITE_ERROR", "error", longSql));
    const ctx = errorContext(err);

    expect((ctx.sql as string).length).toBeLessThanOrEqual(100);
  });

  it("includes Discord-specific fields for Discord errors", () => {
    const err = classifyError(createDiscordAPIError(50013, "Missing Permissions", 403));
    const ctx = errorContext(err);

    expect(ctx.discordCode).toBe(50013);
    expect(ctx.httpStatus).toBe(403);
  });

  it("includes network-specific fields for network errors", () => {
    const networkErr = createNetworkError("ECONNRESET") as Error & { code: string; host: string };
    networkErr.host = "discord.com";
    const err = classifyError(networkErr);
    const ctx = errorContext(err);

    expect(ctx.networkCode).toBe("ECONNRESET");
    expect(ctx.host).toBe("discord.com");
  });

  it("includes permission-specific fields for permission errors", () => {
    const err: ClassifiedError = {
      kind: "permission",
      needed: ["ManageGuild", "ManageRoles"],
      channelId: "channel-123",
      guildId: "guild-456",
      message: "Missing permissions",
    };
    const ctx = errorContext(err);

    expect(ctx.neededPerms).toEqual(["ManageGuild", "ManageRoles"]);
    expect(ctx.channelId).toBe("channel-123");
    expect(ctx.guildId).toBe("guild-456");
  });

  it("merges extra fields into context", () => {
    const err = classifyError(new Error("test"));
    const ctx = errorContext(err, { customField: "value", traceId: "trace-123" });

    expect(ctx.customField).toBe("value");
    expect(ctx.traceId).toBe("trace-123");
  });
});

// ===== userFriendlyMessage Tests =====

describe("userFriendlyMessage", () => {
  describe("database errors", () => {
    it("returns busy message for SQLITE_BUSY", () => {
      const err = classifyError(createSqliteError("SQLITE_BUSY", "database is locked"));
      expect(userFriendlyMessage(err)).toBe("Database is temporarily busy. Please try again.");
    });

    it("returns conflict message for constraint violations", () => {
      const err = classifyError(createSqliteError("SQLITE_CONSTRAINT", "UNIQUE constraint failed"));
      expect(userFriendlyMessage(err)).toBe("This operation conflicts with existing data.");
    });

    it("returns generic message for other db errors", () => {
      const err = classifyError(createSqliteError("SQLITE_ERROR", "syntax error"));
      expect(userFriendlyMessage(err)).toBe("A database error occurred.");
    });
  });

  describe("Discord API errors", () => {
    it("returns expired message for 10062", () => {
      const err = classifyError(createDiscordAPIError(10062, "Unknown interaction"));
      expect(userFriendlyMessage(err)).toBe("This interaction has expired. Please try the command again.");
    });

    it("returns permission message for 50013", () => {
      const err = classifyError(createDiscordAPIError(50013, "Missing Permissions"));
      expect(userFriendlyMessage(err)).toBe("I don't have permission to do that.");
    });

    it("returns access message for 50001", () => {
      const err = classifyError(createDiscordAPIError(50001, "Missing Access"));
      expect(userFriendlyMessage(err)).toBe("I can't access that channel.");
    });

    it("returns generic message for other Discord errors", () => {
      const err = classifyError(createDiscordAPIError(50035, "Invalid Form Body"));
      expect(userFriendlyMessage(err)).toBe("Discord API error occurred.");
    });
  });

  describe("network errors", () => {
    it("returns network message", () => {
      const err = classifyError(createNetworkError("ECONNRESET"));
      expect(userFriendlyMessage(err)).toBe("Network error. Please check your connection and try again.");
    });
  });

  describe("permission errors", () => {
    it("lists needed permissions", () => {
      const err: ClassifiedError = {
        kind: "permission",
        needed: ["ManageGuild", "ManageRoles"],
        message: "Missing permissions",
      };
      expect(userFriendlyMessage(err)).toBe("Missing permissions: ManageGuild, ManageRoles");
    });
  });

  describe("validation errors", () => {
    it("includes field name and message", () => {
      const err: ClassifiedError = {
        kind: "validation",
        field: "username",
        message: "must be at least 3 characters",
      };
      expect(userFriendlyMessage(err)).toBe("Invalid username: must be at least 3 characters");
    });
  });

  describe("config errors", () => {
    it("includes key name", () => {
      const err: ClassifiedError = {
        kind: "config",
        key: "DISCORD_TOKEN",
        message: "not set",
      };
      expect(userFriendlyMessage(err)).toBe("Configuration error: DISCORD_TOKEN is not set correctly.");
    });
  });

  describe("unknown errors", () => {
    it("returns generic message", () => {
      const err = classifyError(new Error("mystery"));
      expect(userFriendlyMessage(err)).toBe("An unexpected error occurred.");
    });
  });
});
