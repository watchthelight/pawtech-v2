/**
 * Pawtropolis Tech — tests/lib/wideEvent.test.ts
 * WHAT: Unit tests for wide event builder and utilities.
 * WHY: Verify wide event construction, phase tracking, and error handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock env
vi.mock("../../src/lib/env.js", () => ({
  env: { NODE_ENV: "test" },
}));

// Mock errors module
vi.mock("../../src/lib/errors.js", () => ({
  isRecoverable: vi.fn((err) => err.kind === "transient"),
}));

import { WideEventBuilder, extractTableFromSql } from "../../src/lib/wideEvent.js";

describe("wideEvent", () => {
  describe("extractTableFromSql", () => {
    it("extracts table from SELECT statement", () => {
      expect(extractTableFromSql("SELECT * FROM users WHERE id = ?")).toBe("users");
    });

    it("extracts table from INSERT statement", () => {
      expect(extractTableFromSql("INSERT INTO review_action (id, value) VALUES (?, ?)")).toBe("review_action");
    });

    it("extracts table from UPDATE statement", () => {
      expect(extractTableFromSql("UPDATE applications SET status = ? WHERE id = ?")).toBe("applications");
    });

    it("extracts table from DELETE statement", () => {
      expect(extractTableFromSql("DELETE FROM sessions WHERE expired = 1")).toBe("sessions");
    });

    it("extracts table from JOIN statement", () => {
      expect(extractTableFromSql("SELECT * FROM users JOIN roles ON users.id = roles.user_id")).toBe("users");
    });

    it("returns null for undefined input", () => {
      expect(extractTableFromSql(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(extractTableFromSql("")).toBeNull();
    });

    it("returns null for non-matching SQL", () => {
      expect(extractTableFromSql("CREATE TABLE foo (id INT)")).toBeNull();
    });

    it("handles case insensitivity", () => {
      expect(extractTableFromSql("select * from USERS")).toBe("USERS");
      expect(extractTableFromSql("SELECT * FROM users")).toBe("users");
    });
  });

  describe("WideEventBuilder", () => {
    let builder: WideEventBuilder;
    const traceId = "abc12345678";

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-15T10:00:00.000Z"));
      builder = new WideEventBuilder(traceId);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe("constructor", () => {
      it("creates event with traceId", () => {
        const event = builder.finalize();
        expect(event.traceId).toBe(traceId);
      });

      it("sets timestamp to current time", () => {
        const event = builder.finalize();
        expect(event.timestamp).toBe("2024-01-15T10:00:00.000Z");
      });

      it("sets environment from env", () => {
        const event = builder.finalize();
        expect(event.environment).toBe("test");
      });

      it("initializes with safe defaults", () => {
        const event = builder.finalize();

        expect(event.kind).toBeNull();
        expect(event.command).toBeNull();
        expect(event.guildId).toBeNull();
        expect(event.userId).toBeNull();
        expect(event.phases).toEqual([]);
        expect(event.queries).toEqual([]);
        expect(event.entitiesAffected).toEqual([]);
        expect(event.outcome).toBe("success");
        expect(event.error).toBeNull();
        expect(event.isStaff).toBe(false);
        expect(event.isAdmin).toBe(false);
        expect(event.isOwner).toBe(false);
      });
    });

    describe("setInteraction", () => {
      it("sets interaction kind", () => {
        builder.setInteraction({ kind: "slash" });
        const event = builder.finalize();
        expect(event.kind).toBe("slash");
      });

      it("sets command and subcommand", () => {
        builder.setInteraction({ kind: "slash", command: "review", subcommand: "accept" });
        const event = builder.finalize();
        expect(event.command).toBe("review");
        expect(event.subcommand).toBe("accept");
      });

      it("sets customId for buttons", () => {
        builder.setInteraction({ kind: "button", customId: "approve_123" });
        const event = builder.finalize();
        expect(event.kind).toBe("button");
        expect(event.customId).toBe("approve_123");
      });

      it("sets Discord context", () => {
        builder.setInteraction({
          kind: "slash",
          guildId: "guild-123",
          channelId: "channel-456",
          userId: "user-789",
        });
        const event = builder.finalize();
        expect(event.guildId).toBe("guild-123");
        expect(event.channelId).toBe("channel-456");
        expect(event.userId).toBe("user-789");
      });

      it("returns this for chaining", () => {
        const result = builder.setInteraction({ kind: "modal" });
        expect(result).toBe(builder);
      });
    });

    describe("setUser", () => {
      it("sets username", () => {
        builder.setUser({ username: "moderator" });
        const event = builder.finalize();
        expect(event.username).toBe("moderator");
      });

      it("sets role flags", () => {
        builder.setUser({ isStaff: true, isAdmin: true, isOwner: false });
        const event = builder.finalize();
        expect(event.isStaff).toBe(true);
        expect(event.isAdmin).toBe(true);
        expect(event.isOwner).toBe(false);
      });

      it("sets user roles array", () => {
        builder.setUser({ roles: ["role-1", "role-2"] });
        const event = builder.finalize();
        expect(event.userRoles).toEqual(["role-1", "role-2"]);
      });

      it("returns this for chaining", () => {
        const result = builder.setUser({ username: "test" });
        expect(result).toBe(builder);
      });
    });

    describe("enterPhase", () => {
      it("adds phase to phases array", () => {
        builder.enterPhase("validate");
        const event = builder.finalize();
        expect(event.phases).toHaveLength(1);
        expect(event.phases[0].name).toBe("validate");
      });

      it("records phase start time", () => {
        const startTime = Date.now();
        builder.enterPhase("validate");
        const event = builder.finalize();
        expect(event.phases[0].startMs).toBe(startTime);
      });

      it("closes previous phase when entering new one", () => {
        builder.enterPhase("phase1");
        vi.advanceTimersByTime(100);
        builder.enterPhase("phase2");

        const event = builder.finalize();

        expect(event.phases).toHaveLength(2);
        expect(event.phases[0].durationMs).toBe(100);
        expect(event.phases[0].endMs).toBe(event.phases[0].startMs + 100);
      });

      it("returns this for chaining", () => {
        const result = builder.enterPhase("test");
        expect(result).toBe(builder);
      });
    });

    describe("getCurrentPhase", () => {
      it("returns unknown when no phase set", () => {
        expect(builder.getCurrentPhase()).toBe("unknown");
      });

      it("returns current phase name", () => {
        builder.enterPhase("db_write");
        expect(builder.getCurrentPhase()).toBe("db_write");
      });

      it("tracks phase changes", () => {
        builder.enterPhase("phase1");
        expect(builder.getCurrentPhase()).toBe("phase1");

        builder.enterPhase("phase2");
        expect(builder.getCurrentPhase()).toBe("phase2");
      });
    });

    describe("recordQuery", () => {
      it("adds query to queries array", () => {
        builder.recordQuery("SELECT * FROM users", 15);
        const event = builder.finalize();

        expect(event.queries).toHaveLength(1);
        expect(event.queries[0].sql).toBe("SELECT * FROM users");
        expect(event.queries[0].durationMs).toBe(15);
      });

      it("extracts table name from query", () => {
        builder.recordQuery("SELECT * FROM applications WHERE id = ?", 10);
        const event = builder.finalize();
        expect(event.queries[0].table).toBe("applications");
      });

      it("truncates long SQL to 200 characters", () => {
        const longSql = "SELECT " + "a".repeat(300) + " FROM users";
        builder.recordQuery(longSql, 5);
        const event = builder.finalize();
        expect(event.queries[0].sql).toHaveLength(200);
      });

      it("accumulates total DB time", () => {
        builder.recordQuery("SELECT 1", 10);
        builder.recordQuery("SELECT 2", 20);
        builder.recordQuery("SELECT 3", 30);

        const event = builder.finalize();
        expect(event.totalDbTimeMs).toBe(60);
      });

      it("returns this for chaining", () => {
        const result = builder.recordQuery("SELECT 1", 5);
        expect(result).toBe(builder);
      });
    });

    describe("setFeature", () => {
      it("sets feature name", () => {
        builder.setFeature("gate");
        const event = builder.finalize();
        expect(event.feature).toBe("gate");
      });

      it("sets feature and action together", () => {
        builder.setFeature("review", "accept");
        const event = builder.finalize();
        expect(event.feature).toBe("review");
        expect(event.action).toBe("accept");
      });

      it("returns this for chaining", () => {
        const result = builder.setFeature("test");
        expect(result).toBe(builder);
      });
    });

    describe("setAction", () => {
      it("sets action independently", () => {
        builder.setFeature("modmail").setAction("send");
        const event = builder.finalize();
        expect(event.action).toBe("send");
      });

      it("returns this for chaining", () => {
        const result = builder.setAction("test");
        expect(result).toBe(builder);
      });
    });

    describe("addEntity", () => {
      it("adds entity to entitiesAffected", () => {
        builder.addEntity({ type: "application", id: "app-123" });
        const event = builder.finalize();

        expect(event.entitiesAffected).toHaveLength(1);
        expect(event.entitiesAffected[0]).toEqual({ type: "application", id: "app-123" });
      });

      it("supports entity with code", () => {
        builder.addEntity({ type: "application", id: "app-123", code: "A1B2C3" });
        const event = builder.finalize();
        expect(event.entitiesAffected[0].code).toBe("A1B2C3");
      });

      it("adds multiple entities", () => {
        builder.addEntity({ type: "user", id: "user-1" });
        builder.addEntity({ type: "ticket", id: "ticket-2" });
        const event = builder.finalize();
        expect(event.entitiesAffected).toHaveLength(2);
      });

      it("returns this for chaining", () => {
        const result = builder.addEntity({ type: "user", id: "123" });
        expect(result).toBe(builder);
      });
    });

    describe("addAttr / addAttrs", () => {
      it("addAttr adds single attribute", () => {
        builder.addAttr("custom_field", "value");
        const event = builder.finalize();
        expect(event.attrs.custom_field).toBe("value");
      });

      it("addAttrs adds multiple attributes", () => {
        builder.addAttrs({ field1: "value1", field2: 42 });
        const event = builder.finalize();
        expect(event.attrs.field1).toBe("value1");
        expect(event.attrs.field2).toBe(42);
      });

      it("attributes accumulate", () => {
        builder.addAttr("a", 1);
        builder.addAttr("b", 2);
        builder.addAttrs({ c: 3, d: 4 });
        const event = builder.finalize();
        expect(event.attrs).toEqual({ a: 1, b: 2, c: 3, d: 4 });
      });

      it("returns this for chaining", () => {
        expect(builder.addAttr("key", "value")).toBe(builder);
        expect(builder.addAttrs({ key: "value" })).toBe(builder);
      });
    });

    describe("setOutcome", () => {
      it("sets outcome to success", () => {
        builder.setOutcome("success");
        const event = builder.finalize();
        expect(event.outcome).toBe("success");
      });

      it("sets outcome to error", () => {
        builder.setOutcome("error");
        const event = builder.finalize();
        expect(event.outcome).toBe("error");
      });

      it("sets outcome to timeout", () => {
        builder.setOutcome("timeout");
        const event = builder.finalize();
        expect(event.outcome).toBe("timeout");
      });

      it("sets outcome to cancelled", () => {
        builder.setOutcome("cancelled");
        const event = builder.finalize();
        expect(event.outcome).toBe("cancelled");
      });

      it("returns this for chaining", () => {
        const result = builder.setOutcome("success");
        expect(result).toBe(builder);
      });
    });

    describe("markDeferred / markReplied", () => {
      it("markDeferred sets wasDeferred to true", () => {
        builder.markDeferred();
        const event = builder.finalize();
        expect(event.wasDeferred).toBe(true);
      });

      it("markReplied sets wasReplied to true", () => {
        builder.markReplied();
        const event = builder.finalize();
        expect(event.wasReplied).toBe(true);
      });

      it("both can be set", () => {
        builder.markDeferred().markReplied();
        const event = builder.finalize();
        expect(event.wasDeferred).toBe(true);
        expect(event.wasReplied).toBe(true);
      });
    });

    describe("setError", () => {
      it("sets error with classified error details", () => {
        const classifiedError = {
          kind: "client" as const,
          message: "User not found",
          cause: new Error("Not found"),
        };

        builder.setError(classifiedError);
        const event = builder.finalize();

        expect(event.outcome).toBe("error");
        expect(event.error).not.toBeNull();
        expect(event.error!.kind).toBe("client");
        expect(event.error!.message).toBe("User not found");
      });

      it("uses current phase by default", () => {
        builder.enterPhase("db_write");
        builder.setError({ kind: "db" as const, message: "Connection lost" });
        const event = builder.finalize();
        expect(event.error!.phase).toBe("db_write");
      });

      it("accepts custom phase", () => {
        builder.enterPhase("validate");
        builder.setError({ kind: "client" as const, message: "Error" }, { phase: "custom_phase" });
        const event = builder.finalize();
        expect(event.error!.phase).toBe("custom_phase");
      });

      it("accepts lastSql", () => {
        builder.setError(
          { kind: "db" as const, message: "Query failed" },
          { lastSql: "INSERT INTO foo" }
        );
        const event = builder.finalize();
        expect(event.error!.lastSql).toBe("INSERT INTO foo");
      });

      it("accepts sentryEventId", () => {
        builder.setError(
          { kind: "unknown" as const, message: "Error" },
          { sentryEventId: "sentry-123" }
        );
        const event = builder.finalize();
        expect(event.error!.sentryEventId).toBe("sentry-123");
      });

      it("extracts error code when present", () => {
        const errorWithCode = {
          kind: "client" as const,
          message: "Error",
          code: "ERR_VALIDATION",
        };
        builder.setError(errorWithCode);
        const event = builder.finalize();
        expect(event.error!.code).toBe("ERR_VALIDATION");
      });

      it("returns this for chaining", () => {
        const result = builder.setError({ kind: "unknown" as const, message: "Error" });
        expect(result).toBe(builder);
      });
    });

    describe("finalize", () => {
      it("calculates total duration", () => {
        vi.advanceTimersByTime(500);
        const event = builder.finalize();
        expect(event.durationMs).toBe(500);
      });

      it("closes current phase", () => {
        builder.enterPhase("test");
        vi.advanceTimersByTime(200);
        const event = builder.finalize();

        expect(event.phases[0].durationMs).toBe(200);
        expect(event.phases[0].endMs).not.toBeNull();
      });

      it("returns frozen object", () => {
        const event = builder.finalize();
        expect(Object.isFrozen(event)).toBe(true);
      });
    });

    describe("snapshot", () => {
      it("returns current state without finalizing", () => {
        builder.setInteraction({ kind: "slash", command: "test" });
        builder.enterPhase("phase1");

        const snapshot = builder.snapshot();

        expect(snapshot.command).toBe("test");
        expect(snapshot.phases).toHaveLength(1);
        // Phase should still be open (no endMs)
        expect(snapshot.phases[0].endMs).toBeNull();
      });

      it("does not freeze the object", () => {
        const snapshot = builder.snapshot();
        expect(Object.isFrozen(snapshot)).toBe(false);
      });
    });

    describe("fluent chaining", () => {
      it("supports full fluent API", () => {
        const event = builder
          .setInteraction({ kind: "slash", command: "review", guildId: "guild-1" })
          .setUser({ username: "mod", isStaff: true })
          .enterPhase("validate")
          .setFeature("review", "accept")
          .addEntity({ type: "application", id: "app-123" })
          .addAttr("appCode", "A1B2C3")
          .recordQuery("SELECT * FROM applications", 10)
          .markDeferred()
          .markReplied()
          .setOutcome("success")
          .finalize();

        expect(event.command).toBe("review");
        expect(event.username).toBe("mod");
        expect(event.isStaff).toBe(true);
        expect(event.phases).toHaveLength(1);
        expect(event.feature).toBe("review");
        expect(event.action).toBe("accept");
        expect(event.entitiesAffected).toHaveLength(1);
        expect(event.attrs.appCode).toBe("A1B2C3");
        expect(event.queries).toHaveLength(1);
        expect(event.wasDeferred).toBe(true);
        expect(event.wasReplied).toBe(true);
        expect(event.outcome).toBe("success");
      });
    });
  });
});
