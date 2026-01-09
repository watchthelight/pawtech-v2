/**
 * Pawtropolis Tech — tests/commands/stats/index.test.ts
 * WHAT: Unit tests for /stats command router.
 * WHY: Verify subcommand routing, exports, and fallback handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockInteraction } from "../../utils/discordMocks.js";
import { createTestCommandContext } from "../../utils/contextFactory.js";
import type { ChatInputCommandInteraction } from "discord.js";

// Hoisted mocks for handlers
const {
  mockHandleActivity,
  mockHandleApprovalRate,
  mockHandleLeaderboard,
  mockHandleUser,
  mockHandleExport,
  mockHandleReset,
  mockHandleHistory,
  mockCleanupStatsRateLimiter,
} = vi.hoisted(() => ({
  mockHandleActivity: vi.fn(),
  mockHandleApprovalRate: vi.fn(),
  mockHandleLeaderboard: vi.fn(),
  mockHandleUser: vi.fn(),
  mockHandleExport: vi.fn(),
  mockHandleReset: vi.fn(),
  mockHandleHistory: vi.fn(),
  mockCleanupStatsRateLimiter: vi.fn(),
}));

// Mock all handlers
vi.mock("../../../src/commands/stats/activity.js", () => ({
  handleActivity: mockHandleActivity,
}));

vi.mock("../../../src/commands/stats/approvalRate.js", () => ({
  handleApprovalRate: mockHandleApprovalRate,
}));

vi.mock("../../../src/commands/stats/leaderboard.js", () => ({
  handleLeaderboard: mockHandleLeaderboard,
}));

vi.mock("../../../src/commands/stats/user.js", () => ({
  handleUser: mockHandleUser,
}));

vi.mock("../../../src/commands/stats/export.js", () => ({
  handleExport: mockHandleExport,
}));

vi.mock("../../../src/commands/stats/reset.js", () => ({
  handleReset: mockHandleReset,
  cleanupStatsRateLimiter: mockCleanupStatsRateLimiter,
}));

vi.mock("../../../src/commands/stats/history.js", () => ({
  handleHistory: mockHandleHistory,
}));

vi.mock("../../../src/commands/stats/data.js", () => ({
  data: { name: "stats", description: "Analytics and performance metrics" },
}));

import { execute, data, cleanupStatsRateLimiter } from "../../../src/commands/stats/index.js";

describe("stats/index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("exports", () => {
    it("exports data from data.js", () => {
      expect(data).toBeDefined();
      expect(data.name).toBe("stats");
    });

    it("exports cleanupStatsRateLimiter from reset.js", () => {
      expect(cleanupStatsRateLimiter).toBeDefined();
      expect(cleanupStatsRateLimiter).toBe(mockCleanupStatsRateLimiter);
    });

    it("exports execute function", () => {
      expect(execute).toBeDefined();
      expect(typeof execute).toBe("function");
    });
  });

  describe("subcommand routing", () => {
    it("routes activity subcommand to handleActivity", async () => {
      const interaction = createMockInteraction({
        options: { getSubcommand: "activity" },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockHandleActivity).toHaveBeenCalledWith(ctx);
    });

    it("routes approval-rate subcommand to handleApprovalRate", async () => {
      const interaction = createMockInteraction({
        options: { getSubcommand: "approval-rate" },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockHandleApprovalRate).toHaveBeenCalledWith(ctx);
    });

    it("routes leaderboard subcommand to handleLeaderboard", async () => {
      const interaction = createMockInteraction({
        options: { getSubcommand: "leaderboard" },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockHandleLeaderboard).toHaveBeenCalledWith(interaction);
    });

    it("routes user subcommand to handleUser", async () => {
      const interaction = createMockInteraction({
        options: { getSubcommand: "user" },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockHandleUser).toHaveBeenCalledWith(interaction);
    });

    it("routes export subcommand to handleExport", async () => {
      const interaction = createMockInteraction({
        options: { getSubcommand: "export" },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockHandleExport).toHaveBeenCalledWith(interaction);
    });

    it("routes reset subcommand to handleReset", async () => {
      const interaction = createMockInteraction({
        options: { getSubcommand: "reset" },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockHandleReset).toHaveBeenCalledWith(interaction);
    });

    it("routes history subcommand to handleHistory", async () => {
      const interaction = createMockInteraction({
        options: { getSubcommand: "history" },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockHandleHistory).toHaveBeenCalledWith(ctx);
    });
  });

  describe("unknown subcommand handling", () => {
    it("replies with error for unknown subcommand", async () => {
      const interaction = createMockInteraction({
        options: { getSubcommand: "unknown-subcommand" },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "Unknown subcommand.",
        ephemeral: true,
      });
    });

    it("does not call any handler for unknown subcommand", async () => {
      const interaction = createMockInteraction({
        options: { getSubcommand: "invalid" },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockHandleActivity).not.toHaveBeenCalled();
      expect(mockHandleApprovalRate).not.toHaveBeenCalled();
      expect(mockHandleLeaderboard).not.toHaveBeenCalled();
      expect(mockHandleUser).not.toHaveBeenCalled();
      expect(mockHandleExport).not.toHaveBeenCalled();
      expect(mockHandleReset).not.toHaveBeenCalled();
      expect(mockHandleHistory).not.toHaveBeenCalled();
    });
  });

  describe("handler signatures", () => {
    it("passes ctx to handlers that need CommandContext", async () => {
      const interaction = createMockInteraction({
        options: { getSubcommand: "activity" },
      });
      const ctx = createTestCommandContext(interaction, { traceId: "test-trace" });

      await execute(ctx);

      expect(mockHandleActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          interaction,
          traceId: "test-trace",
        })
      );
    });

    it("passes only interaction to handlers that use interaction directly", async () => {
      const interaction = createMockInteraction({
        options: { getSubcommand: "leaderboard" },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockHandleLeaderboard).toHaveBeenCalledWith(interaction);
    });
  });

  describe("handler isolation", () => {
    it("only calls one handler per execution", async () => {
      const handlers = [
        { subcommand: "activity", mock: mockHandleActivity },
        { subcommand: "approval-rate", mock: mockHandleApprovalRate },
        { subcommand: "leaderboard", mock: mockHandleLeaderboard },
        { subcommand: "user", mock: mockHandleUser },
        { subcommand: "export", mock: mockHandleExport },
        { subcommand: "reset", mock: mockHandleReset },
        { subcommand: "history", mock: mockHandleHistory },
      ];

      for (const { subcommand, mock } of handlers) {
        vi.clearAllMocks();
        const interaction = createMockInteraction({
          options: { getSubcommand: subcommand },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        expect(mock).toHaveBeenCalledTimes(1);
        for (const { mock: otherMock } of handlers.filter((h) => h.mock !== mock)) {
          expect(otherMock).not.toHaveBeenCalled();
        }
      }
    });
  });

  describe("async handling", () => {
    it("awaits handler completion", async () => {
      let handlerCompleted = false;
      mockHandleActivity.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        handlerCompleted = true;
      });

      const interaction = createMockInteraction({
        options: { getSubcommand: "activity" },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(handlerCompleted).toBe(true);
    });

    it("propagates handler errors", async () => {
      mockHandleActivity.mockRejectedValue(new Error("Handler error"));

      const interaction = createMockInteraction({
        options: { getSubcommand: "activity" },
      });
      const ctx = createTestCommandContext(interaction);

      await expect(execute(ctx)).rejects.toThrow("Handler error");
    });
  });
});
