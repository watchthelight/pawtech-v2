/**
 * Pawtropolis Tech — tests/lib/errorCardV2.test.ts
 * WHAT: Unit tests for error card V2 module.
 * WHY: Verify severity classification, explanations, and embed building.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmbedBuilder } from "discord.js";

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  redact: vi.fn((s: string) => s),
}));

vi.mock("../../src/lib/cmdWrap.js", () => ({
  replyOrEdit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/reqctx.js", () => ({
  ctx: {},
}));

import {
  buildErrorCardEmbed,
  SEVERITY_COLORS,
  SEVERITY_EMOJI,
  type ErrorCardV2Details,
} from "../../src/lib/errorCardV2.js";
import type { WideEvent, WideEventError, PhaseRecord } from "../../src/lib/wideEvent.js";

describe("lib/errorCardV2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("SEVERITY_COLORS", () => {
    it("has critical color as red", () => {
      expect(SEVERITY_COLORS.critical).toBe(0xed4245);
    });

    it("has warning color as orange", () => {
      expect(SEVERITY_COLORS.warning).toBe(0xffa500);
    });

    it("has info color as blurple", () => {
      expect(SEVERITY_COLORS.info).toBe(0x5865f2);
    });
  });

  describe("SEVERITY_EMOJI", () => {
    it("has critical emoji as red X", () => {
      expect(SEVERITY_EMOJI.critical).toBe("\u274C");
    });

    it("has warning emoji as warning sign", () => {
      expect(SEVERITY_EMOJI.warning).toBe("\u26A0\uFE0F");
    });

    it("has info emoji as info symbol", () => {
      expect(SEVERITY_EMOJI.info).toBe("\u2139\uFE0F");
    });
  });

  describe("buildErrorCardEmbed", () => {
    function createMockWideEvent(overrides: Partial<WideEvent> = {}): WideEvent {
      return {
        traceId: "TEST1234",
        command: "test-cmd",
        userId: "user-123",
        guildId: "guild-123",
        channelId: "chan-123",
        isOwner: false,
        isAdmin: false,
        isStaff: false,
        userRoles: [],
        phases: [],
        queries: [],
        durationMs: 100,
        totalDbTimeMs: 0,
        error: null,
        outcome: "success",
        ...overrides,
      };
    }

    describe("basic embed properties", () => {
      it("returns an EmbedBuilder instance", () => {
        const event = createMockWideEvent();
        const embed = buildErrorCardEmbed({ wideEvent: event });
        expect(embed).toBeInstanceOf(EmbedBuilder);
      });

      it("sets title with Command Failed", () => {
        const event = createMockWideEvent();
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.title).toContain("Command Failed");
      });

      it("includes trace ID in footer", () => {
        const event = createMockWideEvent({ traceId: "ABCD1234" });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.footer?.text).toContain("ABCD1234");
      });

      it("includes sentry ID in footer when provided", () => {
        const event = createMockWideEvent();
        const embed = buildErrorCardEmbed({
          wideEvent: event,
          sentryEventId: "sentry-12345678-abcd",
        });
        const data = embed.toJSON();
        expect(data.footer?.text).toContain("Sentry:");
      });
    });

    describe("severity-based styling", () => {
      it("uses critical color for db_error", () => {
        const error: WideEventError = {
          kind: "db_error",
          message: "Database error",
          isRetriable: false,
          code: null,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.color).toBe(SEVERITY_COLORS.critical);
      });

      it("uses critical color for unknown errors", () => {
        const error: WideEventError = {
          kind: "unknown",
          message: "Unknown error",
          isRetriable: false,
          code: null,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.color).toBe(SEVERITY_COLORS.critical);
      });

      it("uses info color for validation errors", () => {
        const error: WideEventError = {
          kind: "validation",
          message: "Invalid input",
          isRetriable: false,
          code: null,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.color).toBe(SEVERITY_COLORS.info);
      });

      it("uses info color for permission errors", () => {
        const error: WideEventError = {
          kind: "permission",
          message: "Permission denied",
          isRetriable: false,
          code: null,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.color).toBe(SEVERITY_COLORS.info);
      });

      it("uses warning color for network errors", () => {
        const error: WideEventError = {
          kind: "network",
          message: "Network failed",
          isRetriable: true,
          code: null,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.color).toBe(SEVERITY_COLORS.warning);
      });

      it("uses warning color for config errors", () => {
        const error: WideEventError = {
          kind: "config",
          message: "Config error",
          isRetriable: false,
          code: null,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.color).toBe(SEVERITY_COLORS.warning);
      });

      it("uses info color for retriable discord_api errors", () => {
        const error: WideEventError = {
          kind: "discord_api",
          message: "Rate limited",
          isRetriable: true,
          code: 429,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.color).toBe(SEVERITY_COLORS.info);
      });

      it("uses warning color for non-retriable discord_api errors", () => {
        const error: WideEventError = {
          kind: "discord_api",
          message: "Permission error",
          isRetriable: false,
          code: 50013,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.color).toBe(SEVERITY_COLORS.warning);
      });
    });

    describe("execution path field", () => {
      it("adds execution path field when phases exist", () => {
        const phases: PhaseRecord[] = [
          { name: "validate", startMs: 0, durationMs: 10 },
          { name: "execute", startMs: 10, durationMs: 50 },
        ];
        const event = createMockWideEvent({ phases, durationMs: 60 });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();

        const pathField = data.fields?.find((f) => f.name.includes("Execution Path"));
        expect(pathField).toBeDefined();
        expect(pathField?.value).toContain("validate");
        expect(pathField?.value).toContain("execute");
        expect(pathField?.value).toContain("Duration:");
      });

      it("marks failed phase with X", () => {
        const phases: PhaseRecord[] = [
          { name: "validate", startMs: 0, durationMs: 10 },
          { name: "execute", startMs: 10, durationMs: null },
        ];
        const error: WideEventError = {
          kind: "db_error",
          message: "Failed",
          isRetriable: false,
          code: null,
          phase: "execute",
          lastSql: null,
        };
        const event = createMockWideEvent({ phases, error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();

        const pathField = data.fields?.find((f) => f.name.includes("Execution Path"));
        expect(pathField?.value).toContain("\u274C execute");
      });

      it("omits execution path when no phases", () => {
        const event = createMockWideEvent({ phases: [] });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();

        const pathField = data.fields?.find((f) => f.name.includes("Execution Path"));
        expect(pathField).toBeUndefined();
      });
    });

    describe("database context field", () => {
      it("adds database field when queries exist", () => {
        const event = createMockWideEvent({
          queries: [
            { sql: "SELECT * FROM users", durationMs: 5 },
            { sql: "UPDATE users SET...", durationMs: 10 },
          ],
          totalDbTimeMs: 15,
        });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();

        const dbField = data.fields?.find((f) => f.name.includes("Database"));
        expect(dbField).toBeDefined();
        expect(dbField?.value).toContain("2 queries");
        expect(dbField?.value).toContain("15ms");
      });

      it("omits database field when no queries", () => {
        const event = createMockWideEvent({ queries: [] });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();

        const dbField = data.fields?.find((f) => f.name.includes("Database"));
        expect(dbField).toBeUndefined();
      });
    });

    describe("user context field", () => {
      it("shows Owner for bot owners", () => {
        const event = createMockWideEvent({ isOwner: true });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();

        const userField = data.fields?.find((f) => f.name.includes("Your Context"));
        expect(userField?.value).toContain("Owner");
      });

      it("shows Admin for admins", () => {
        const event = createMockWideEvent({ isAdmin: true });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();

        const userField = data.fields?.find((f) => f.name.includes("Your Context"));
        expect(userField?.value).toContain("Admin");
      });

      it("shows Staff for staff", () => {
        const event = createMockWideEvent({ isStaff: true });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();

        const userField = data.fields?.find((f) => f.name.includes("Your Context"));
        expect(userField?.value).toContain("Staff");
      });

      it("shows Member for regular users", () => {
        const event = createMockWideEvent();
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();

        const userField = data.fields?.find((f) => f.name.includes("Your Context"));
        expect(userField?.value).toContain("Member");
      });

      it("shows role count", () => {
        const event = createMockWideEvent({ userRoles: ["role1", "role2", "role3"] });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();

        const userField = data.fields?.find((f) => f.name.includes("Your Context"));
        expect(userField?.value).toContain("3 roles");
      });
    });

    describe("error explanations", () => {
      it("explains SQLITE_BUSY", () => {
        const error: WideEventError = {
          kind: "db_error",
          message: "Database busy",
          isRetriable: true,
          code: "SQLITE_BUSY",
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.description).toContain("temporarily busy");
      });

      it("explains constraint violations", () => {
        const error: WideEventError = {
          kind: "db_error",
          message: "UNIQUE CONSTRAINT failed",
          isRetriable: false,
          code: "SQLITE_CONSTRAINT",
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.description).toContain("conflicts");
      });

      it("explains interaction expired (10062)", () => {
        const error: WideEventError = {
          kind: "discord_api",
          message: "Unknown interaction",
          isRetriable: false,
          code: 10062,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.description).toContain("expired");
        expect(data.description).toContain("3 seconds");
      });

      it("explains already acknowledged (40060)", () => {
        const error: WideEventError = {
          kind: "discord_api",
          message: "Already acknowledged",
          isRetriable: false,
          code: 40060,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.description).toContain("twice");
      });

      it("explains missing permissions (50013)", () => {
        const error: WideEventError = {
          kind: "discord_api",
          message: "Missing permissions",
          isRetriable: false,
          code: 50013,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.description).toContain("permission");
      });

      it("explains missing access (50001)", () => {
        const error: WideEventError = {
          kind: "discord_api",
          message: "Missing access",
          isRetriable: false,
          code: 50001,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.description).toContain("access");
      });

      it("explains unknown message (10008)", () => {
        const error: WideEventError = {
          kind: "discord_api",
          message: "Unknown message",
          isRetriable: false,
          code: 10008,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.description).toContain("deleted");
      });

      it("explains unknown channel (10003)", () => {
        const error: WideEventError = {
          kind: "discord_api",
          message: "Unknown channel",
          isRetriable: false,
          code: 10003,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.description).toContain("channel");
      });

      it("explains validation errors", () => {
        const error: WideEventError = {
          kind: "validation",
          message: "Invalid user ID format",
          isRetriable: false,
          code: null,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.description).toContain("Invalid input");
      });

      it("explains permission errors", () => {
        const error: WideEventError = {
          kind: "permission",
          message: "Not authorized",
          isRetriable: false,
          code: null,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.description).toContain("permission");
      });

      it("explains network errors", () => {
        const error: WideEventError = {
          kind: "network",
          message: "ETIMEDOUT",
          isRetriable: true,
          code: null,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.description).toContain("Network");
      });

      it("explains config errors", () => {
        const error: WideEventError = {
          kind: "config",
          message: "Missing config",
          isRetriable: false,
          code: null,
          phase: null,
          lastSql: null,
        };
        const event = createMockWideEvent({ error });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.description).toContain("configuration");
      });

      it("provides fallback for no error", () => {
        const event = createMockWideEvent({ error: null });
        const embed = buildErrorCardEmbed({ wideEvent: event });
        const data = embed.toJSON();
        expect(data.description).toContain("unexpected");
      });
    });
  });
});
