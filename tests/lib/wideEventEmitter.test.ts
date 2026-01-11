/**
 * Pawtropolis Tech — tests/lib/wideEventEmitter.test.ts
 * WHAT: Unit tests for wide event emission and sampling.
 * WHY: Verify tail sampling, logging, and event flattening.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock env
vi.mock("../../src/lib/env.js", () => ({
  env: { NODE_ENV: "test" },
}));

import { emitWideEvent, emitWideEventForced } from "../../src/lib/wideEventEmitter.js";
import { logger } from "../../src/lib/logger.js";
import type { WideEvent } from "../../src/lib/wideEvent.js";

function createMockEvent(overrides: Partial<WideEvent> = {}): WideEvent {
  return {
    timestamp: "2024-01-15T10:00:00.000Z",
    traceId: "abc12345678",
    serviceVersion: "4.8.0",
    environment: "test",

    // Build identity
    gitSha: "abc1234",
    buildTime: "2024-01-15T09:00:00.000Z",
    deployId: "deploy-20240115-090000-abc1234",
    nodeVersion: "20.10.0",
    hostname: "localhost",

    kind: "slash",
    command: "review",
    subcommand: null,
    customId: null,

    guildId: "guild-123",
    channelId: "channel-456",
    userId: "user-789",
    username: "testuser",

    userRoles: ["role-1", "role-2"],
    isStaff: true,
    isAdmin: false,
    isOwner: false,

    phases: [],
    durationMs: 100,
    wasDeferred: false,
    wasReplied: true,
    outcome: "success",

    // Response state
    responseState: {
      deferredAt: null,
      repliedAt: 100,
      errorCardSent: false,
      failureReason: null,
    },

    queries: [],
    totalDbTimeMs: 0,

    feature: "review",
    action: "accept",
    entitiesAffected: [],

    attrs: {},

    error: null,
    ...overrides,
  };
}

describe("wideEventEmitter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("emitWideEvent", () => {
    describe("enabled check", () => {
      it("emits when enabled is default (not set)", () => {
        delete process.env.WIDE_EVENT_ENABLED;
        process.env.WIDE_EVENT_SAMPLE_RATE = "1"; // Keep all

        const event = createMockEvent();
        emitWideEvent(event);

        expect(logger.info).toHaveBeenCalled();
      });

      it("emits when WIDE_EVENT_ENABLED is true", () => {
        process.env.WIDE_EVENT_ENABLED = "true";
        process.env.WIDE_EVENT_SAMPLE_RATE = "1";

        const event = createMockEvent();
        emitWideEvent(event);

        expect(logger.info).toHaveBeenCalled();
      });

      it("does not emit when WIDE_EVENT_ENABLED is false", () => {
        process.env.WIDE_EVENT_ENABLED = "false";

        const event = createMockEvent();
        emitWideEvent(event);

        expect(logger.info).not.toHaveBeenCalled();
      });

      it("does not emit when WIDE_EVENT_ENABLED is 0", () => {
        process.env.WIDE_EVENT_ENABLED = "0";

        const event = createMockEvent();
        emitWideEvent(event);

        expect(logger.info).not.toHaveBeenCalled();
      });
    });

    describe("tail sampling", () => {
      it("always keeps errors regardless of sample rate", () => {
        process.env.WIDE_EVENT_SAMPLE_RATE = "0"; // Drop all successes

        const event = createMockEvent({
          outcome: "error",
          error: {
            kind: "unknown",
            code: null,
            message: "Test error",
            phase: "handler",
            lastSql: null,
            isRetriable: false,
            sentryEventId: null,
            stack: null,
          },
        });
        emitWideEvent(event);

        expect(logger.error).toHaveBeenCalled();
      });

      it("always keeps timeouts regardless of sample rate", () => {
        process.env.WIDE_EVENT_SAMPLE_RATE = "0";

        const event = createMockEvent({ outcome: "timeout" });
        emitWideEvent(event);

        expect(logger.warn).toHaveBeenCalled();
      });

      it("keeps all events when sample rate is 1", () => {
        process.env.WIDE_EVENT_SAMPLE_RATE = "1";

        const event = createMockEvent({ outcome: "success" });
        emitWideEvent(event);

        expect(logger.info).toHaveBeenCalled();
      });

      it("drops all success events when sample rate is 0", () => {
        process.env.WIDE_EVENT_SAMPLE_RATE = "0";

        const event = createMockEvent({ outcome: "success" });
        emitWideEvent(event);

        expect(logger.info).not.toHaveBeenCalled();
      });

      it("uses default rate when not specified", () => {
        delete process.env.WIDE_EVENT_SAMPLE_RATE;

        // Test that an error event is always kept even with default rate
        const event = createMockEvent({ outcome: "error", error: {
          kind: "unknown",
          code: null,
          message: "Test error",
          phase: "handler",
          lastSql: null,
          isRetriable: false,
          sentryEventId: null,
          stack: null,
        }});
        emitWideEvent(event);

        // Errors are always kept regardless of sample rate
        expect(logger.error).toHaveBeenCalled();
      });

      it("handles invalid sample rate gracefully", () => {
        process.env.WIDE_EVENT_SAMPLE_RATE = "not-a-number";

        const event = createMockEvent({
          outcome: "error",
          error: {
            kind: "unknown",
            code: null,
            message: "Test error",
            phase: "handler",
            lastSql: null,
            isRetriable: false,
            sentryEventId: null,
            stack: null,
          },
        });
        emitWideEvent(event);

        // Should fall back to default and still emit errors
        expect(logger.error).toHaveBeenCalled();
      });

      it("handles out of range sample rate", () => {
        process.env.WIDE_EVENT_SAMPLE_RATE = "2.5";

        const event = createMockEvent({
          outcome: "error",
          error: {
            kind: "unknown",
            code: null,
            message: "Test error",
            phase: "handler",
            lastSql: null,
            isRetriable: false,
            sentryEventId: null,
            stack: null,
          },
        });
        emitWideEvent(event);

        // Still emits error (errors are always kept)
        expect(logger.error).toHaveBeenCalled();
      });
    });

    describe("log level selection", () => {
      beforeEach(() => {
        process.env.WIDE_EVENT_SAMPLE_RATE = "1";
      });

      it("logs success at info level", () => {
        const event = createMockEvent({ outcome: "success" });
        emitWideEvent(event);

        expect(logger.info).toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it("logs error at error level", () => {
        const event = createMockEvent({
          outcome: "error",
          error: {
            kind: "unknown",
            code: null,
            message: "Failed",
            phase: "test",
            lastSql: null,
            isRetriable: false,
            sentryEventId: null,
            stack: null,
          },
        });
        emitWideEvent(event);

        expect(logger.error).toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalled();
      });

      it("logs timeout at warn level", () => {
        const event = createMockEvent({ outcome: "timeout" });
        emitWideEvent(event);

        expect(logger.warn).toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
      });
    });

    describe("event flattening", () => {
      beforeEach(() => {
        process.env.WIDE_EVENT_SAMPLE_RATE = "1";
      });

      it("includes core identity fields", () => {
        const event = createMockEvent();
        emitWideEvent(event);

        const logCall = vi.mocked(logger.info).mock.calls[0][0] as Record<string, unknown>;
        expect(logCall.traceId).toBe("abc12345678");
        expect(logCall.env).toBe("test");
      });

      it("includes interaction context", () => {
        const event = createMockEvent({
          kind: "slash",
          command: "review",
          subcommand: "accept",
        });
        emitWideEvent(event);

        const logCall = vi.mocked(logger.info).mock.calls[0][0] as Record<string, unknown>;
        expect(logCall.kind).toBe("slash");
        expect(logCall.command).toBe("review");
        expect(logCall.subcommand).toBe("accept");
      });

      it("includes Discord context", () => {
        const event = createMockEvent({
          guildId: "guild-123",
          userId: "user-456",
          username: "testmod",
        });
        emitWideEvent(event);

        const logCall = vi.mocked(logger.info).mock.calls[0][0] as Record<string, unknown>;
        expect(logCall.guildId).toBe("guild-123");
        expect(logCall.userId).toBe("user-456");
        expect(logCall.username).toBe("testmod");
      });

      it("includes execution metrics", () => {
        const event = createMockEvent({
          durationMs: 250,
          wasDeferred: true,
          wasReplied: true,
        });
        emitWideEvent(event);

        const logCall = vi.mocked(logger.info).mock.calls[0][0] as Record<string, unknown>;
        expect(logCall.durationMs).toBe(250);
        expect(logCall.wasDeferred).toBe(true);
        expect(logCall.wasReplied).toBe(true);
      });

      it("includes database metrics", () => {
        const event = createMockEvent({
          queries: [
            { sql: "SELECT * FROM users", durationMs: 10, table: "users" },
            { sql: "UPDATE applications", durationMs: 20, table: "applications" },
          ],
          totalDbTimeMs: 30,
        });
        emitWideEvent(event);

        const logCall = vi.mocked(logger.info).mock.calls[0][0] as Record<string, unknown>;
        expect(logCall.queryCount).toBe(2);
        expect(logCall.totalDbTimeMs).toBe(30);
      });

      it("includes business context", () => {
        const event = createMockEvent({
          feature: "gate",
          action: "accept",
          entitiesAffected: [
            { type: "application", id: "app-1", code: "A1B2C3" },
            { type: "user", id: "user-1" },
          ],
        });
        emitWideEvent(event);

        const logCall = vi.mocked(logger.info).mock.calls[0][0] as Record<string, unknown>;
        expect(logCall.feature).toBe("gate");
        expect(logCall.action).toBe("accept");
        expect(logCall.entityCount).toBe(2);
        expect(logCall.entities).toBe("application:A1B2C3, user:user-1");
      });

      it("includes error context when present", () => {
        const event = createMockEvent({
          outcome: "error",
          error: {
            kind: "db",
            code: "SQLITE_BUSY",
            message: "Database locked",
            phase: "db_write",
            lastSql: "INSERT INTO foo",
            isRetriable: true,
            sentryEventId: "sentry-abc",
            stack: null,
          },
        });
        emitWideEvent(event);

        const logCall = vi.mocked(logger.error).mock.calls[0][0] as Record<string, unknown>;
        expect(logCall.errorKind).toBe("db");
        expect(logCall.errorCode).toBe("SQLITE_BUSY");
        expect(logCall.errorMessage).toBe("Database locked");
        expect(logCall.errorPhase).toBe("db_write");
        expect(logCall.errorRetriable).toBe(true);
        expect(logCall.sentryEventId).toBe("sentry-abc");
      });

      it("prefixes custom attributes with attr_", () => {
        const event = createMockEvent({
          attrs: {
            appCode: "A1B2C3",
            customValue: 42,
          },
        });
        emitWideEvent(event);

        const logCall = vi.mocked(logger.info).mock.calls[0][0] as Record<string, unknown>;
        expect(logCall.attr_appCode).toBe("A1B2C3");
        expect(logCall.attr_customValue).toBe(42);
      });

      it("formats phase list", () => {
        const event = createMockEvent({
          phases: [
            { name: "validate", startMs: 0, endMs: 10, durationMs: 10 },
            { name: "db_read", startMs: 10, endMs: 25, durationMs: 15 },
            { name: "reply", startMs: 25, endMs: 50, durationMs: 25 },
          ],
        });
        emitWideEvent(event);

        const logCall = vi.mocked(logger.info).mock.calls[0][0] as Record<string, unknown>;
        expect(logCall.phases).toBe("validate -> db_read -> reply");
        expect(logCall.phaseCount).toBe(3);
      });

      it("shows 'none' for empty phases", () => {
        const event = createMockEvent({ phases: [] });
        emitWideEvent(event);

        const logCall = vi.mocked(logger.info).mock.calls[0][0] as Record<string, unknown>;
        expect(logCall.phases).toBe("none");
      });
    });

    describe("log message format", () => {
      beforeEach(() => {
        process.env.WIDE_EVENT_SAMPLE_RATE = "1";
      });

      it("includes command label and duration", () => {
        const event = createMockEvent({ command: "review", durationMs: 150 });
        emitWideEvent(event);

        const message = vi.mocked(logger.info).mock.calls[0][1];
        expect(message).toContain("[review]");
        expect(message).toContain("success");
        expect(message).toContain("150ms");
      });

      it("uses customId when command is null", () => {
        const event = createMockEvent({ command: null, customId: "approve_123" });
        emitWideEvent(event);

        const message = vi.mocked(logger.info).mock.calls[0][1];
        expect(message).toContain("[approve_123]");
      });

      it("uses kind when both command and customId are null", () => {
        const event = createMockEvent({ command: null, customId: null, kind: "event" });
        emitWideEvent(event);

        const message = vi.mocked(logger.info).mock.calls[0][1];
        expect(message).toContain("[event]");
      });

      it("uses unknown when all identifiers are null", () => {
        const event = createMockEvent({ command: null, customId: null, kind: null });
        emitWideEvent(event);

        const message = vi.mocked(logger.info).mock.calls[0][1];
        expect(message).toContain("[unknown]");
      });
    });

    describe("role count", () => {
      beforeEach(() => {
        process.env.WIDE_EVENT_SAMPLE_RATE = "1";
      });

      it("includes role count in flattened output", () => {
        const event = createMockEvent({
          userRoles: ["role-1", "role-2", "role-3"],
        });
        emitWideEvent(event);

        const logCall = vi.mocked(logger.info).mock.calls[0][0] as Record<string, unknown>;
        expect(logCall.roleCount).toBe(3);
      });
    });
  });

  describe("emitWideEventForced", () => {
    beforeEach(() => {
      process.env.WIDE_EVENT_SAMPLE_RATE = "0"; // Drop all normal events
    });

    it("emits regardless of sample rate", () => {
      const event = createMockEvent({ outcome: "success" });
      emitWideEventForced(event);

      expect(logger.info).toHaveBeenCalled();
    });

    it("includes forced: true in log payload", () => {
      const event = createMockEvent();
      emitWideEventForced(event);

      const logCall = vi.mocked(logger.info).mock.calls[0][0] as Record<string, unknown>;
      expect(logCall.forced).toBe(true);
    });

    it("includes (forced) in message", () => {
      const event = createMockEvent();
      emitWideEventForced(event);

      const message = vi.mocked(logger.info).mock.calls[0][1];
      expect(message).toContain("(forced)");
    });

    it("still respects enabled check", () => {
      process.env.WIDE_EVENT_ENABLED = "false";

      const event = createMockEvent();
      emitWideEventForced(event);

      expect(logger.info).not.toHaveBeenCalled();
    });

    it("logs errors at error level", () => {
      const event = createMockEvent({
        outcome: "error",
        error: {
          kind: "unknown",
          code: null,
          message: "Error",
          phase: "test",
          lastSql: null,
          isRetriable: false,
          sentryEventId: null,
          stack: null,
        },
      });
      emitWideEventForced(event);

      expect(logger.error).toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
