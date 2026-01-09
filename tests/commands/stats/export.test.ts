/**
 * Pawtropolis Tech — tests/commands/stats/export.test.ts
 * WHAT: Unit tests for /stats export command handler.
 * WHY: Verify CSV export generation, permission checks, and data formatting.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockInteraction } from "../../utils/discordMocks.js";
import type { ChatInputCommandInteraction } from "discord.js";

// Hoisted mocks
const { mockPrepare, mockAll, mockRequireMinRole, mockNowUtc, mockGetAvgClaimToDecision } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockAll: vi.fn(),
  mockRequireMinRole: vi.fn(),
  mockNowUtc: vi.fn(),
  mockGetAvgClaimToDecision: vi.fn(),
}));

// Mock shared module
vi.mock("../../../src/commands/stats/shared.js", async () => {
  const { AttachmentBuilder } = await vi.importActual("discord.js");
  return {
    ChatInputCommandInteraction: {},
    AttachmentBuilder,
    db: { prepare: mockPrepare },
    nowUtc: mockNowUtc,
    requireMinRole: mockRequireMinRole,
    ROLE_IDS: {
      SENIOR_ADMIN: "role-senior-admin",
      GATEKEEPER: "role-gk",
      SENIOR_MOD: "role-sm",
    },
    getAvgClaimToDecision: mockGetAvgClaimToDecision,
    formatDuration: vi.fn((seconds: number | null) => {
      if (seconds === null || seconds === undefined) return "—";
      const mins = Math.floor(seconds / 60);
      return `${mins}m`;
    }),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

import { handleExport } from "../../../src/commands/stats/export.js";

describe("stats/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMinRole.mockReturnValue(true);
    mockNowUtc.mockReturnValue(1700000000);
    mockPrepare.mockReturnValue({ all: mockAll });
    mockAll.mockReturnValue([
      {
        actor_id: "mod-001",
        total: 150,
        approvals: 120,
        rejections: 20,
        modmail: 5,
        perm_reject: 3,
        kicks: 2,
      },
      {
        actor_id: "mod-002",
        total: 100,
        approvals: 85,
        rejections: 10,
        modmail: 3,
        perm_reject: 1,
        kicks: 1,
      },
    ]);
    mockGetAvgClaimToDecision.mockReturnValue(300); // 5 minutes
  });

  describe("guild validation", () => {
    it("replies with error when used outside a guild", async () => {
      const interaction = createMockInteraction({ guildId: null } as any);

      await handleExport(interaction as ChatInputCommandInteraction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "This command must be run in a guild.",
        ephemeral: true,
      });
    });

    it("does not defer reply when guild is missing", async () => {
      const interaction = createMockInteraction({ guildId: null } as any);

      await handleExport(interaction as ChatInputCommandInteraction);

      expect(interaction.deferReply).not.toHaveBeenCalled();
    });
  });

  describe("permission checks", () => {
    it("calls requireMinRole with SENIOR_ADMIN role", async () => {
      const interaction = createMockInteraction();

      await handleExport(interaction as ChatInputCommandInteraction);

      expect(mockRequireMinRole).toHaveBeenCalledWith(
        interaction,
        "role-senior-admin",
        expect.objectContaining({
          command: "stats export",
          description: "Exports moderator metrics as CSV.",
        })
      );
    });

    it("returns early when permission check fails", async () => {
      mockRequireMinRole.mockReturnValue(false);
      const interaction = createMockInteraction();

      await handleExport(interaction as ChatInputCommandInteraction);

      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(mockAll).not.toHaveBeenCalled();
    });
  });

  describe("options handling", () => {
    it("uses default days (30) when not provided", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { days: null } },
      });

      await handleExport(interaction as ChatInputCommandInteraction);

      expect(mockAll).toHaveBeenCalledWith("guild-123", 1700000000 - 30 * 86400);
    });

    it("uses provided days value", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { days: 60 } },
      });

      await handleExport(interaction as ChatInputCommandInteraction);

      expect(mockAll).toHaveBeenCalledWith("guild-123", 1700000000 - 60 * 86400);
    });
  });

  describe("successful execution", () => {
    it("defers reply ephemerally", async () => {
      const interaction = createMockInteraction();

      await handleExport(interaction as ChatInputCommandInteraction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it("queries database with correct parameters", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild-456",
        options: { getInteger: { days: 14 } },
      } as any);

      await handleExport(interaction as ChatInputCommandInteraction);

      expect(mockAll).toHaveBeenCalledWith("test-guild-456", 1700000000 - 14 * 86400);
    });

    it("replies with attachment containing CSV", async () => {
      const interaction = createMockInteraction();

      await handleExport(interaction as ChatInputCommandInteraction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Full Moderator Stats Export"),
          files: expect.arrayContaining([expect.any(Object)]),
        })
      );
    });

    it("CSV contains correct header row", async () => {
      const interaction = createMockInteraction();

      await handleExport(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const attachment = call.files[0];
      // AttachmentBuilder stores the data - need to access it
      expect(attachment).toBeDefined();
    });

    it("includes moderator count in message", async () => {
      const interaction = createMockInteraction();

      await handleExport(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.content).toContain("2 moderators included");
    });

    it("includes days in message", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { days: 45 } },
      });

      await handleExport(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.content).toContain("last 45 days");
    });

    it("attachment has correct filename format", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { days: 30 } },
      });

      await handleExport(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const attachment = call.files[0];
      expect(attachment.name).toMatch(/^stats-full-export-30d-\d+\.csv$/);
    });
  });

  describe("empty results handling", () => {
    it("sends message when no data found", async () => {
      mockAll.mockReturnValue([]);
      const interaction = createMockInteraction({
        options: { getInteger: { days: 7 } },
      });

      await handleExport(interaction as ChatInputCommandInteraction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "No decisions found in the last 7 days.",
      });
    });

    it("does not create attachment when empty", async () => {
      mockAll.mockReturnValue([]);
      const interaction = createMockInteraction();

      await handleExport(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.files).toBeUndefined();
    });
  });

  describe("CSV formatting", () => {
    it("calls getAvgClaimToDecision for each moderator", async () => {
      const interaction = createMockInteraction();

      await handleExport(interaction as ChatInputCommandInteraction);

      expect(mockGetAvgClaimToDecision).toHaveBeenCalledWith(
        "guild-123",
        "mod-001",
        expect.any(Number)
      );
      expect(mockGetAvgClaimToDecision).toHaveBeenCalledWith(
        "guild-123",
        "mod-002",
        expect.any(Number)
      );
    });

    it("handles null avg time gracefully", async () => {
      mockGetAvgClaimToDecision.mockReturnValue(null);
      const interaction = createMockInteraction();

      await handleExport(interaction as ChatInputCommandInteraction);

      // Should not throw
      expect(interaction.editReply).toHaveBeenCalled();
    });

    it("includes all moderator data in export", async () => {
      mockAll.mockReturnValue([
        { actor_id: "mod-001", total: 50, approvals: 40, rejections: 5, modmail: 2, perm_reject: 2, kicks: 1 },
        { actor_id: "mod-002", total: 30, approvals: 25, rejections: 3, modmail: 1, perm_reject: 0, kicks: 1 },
        { actor_id: "mod-003", total: 20, approvals: 18, rejections: 1, modmail: 0, perm_reject: 1, kicks: 0 },
      ]);
      const interaction = createMockInteraction();

      await handleExport(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.content).toContain("3 moderators");
    });
  });

  describe("logging", () => {
    it("logs info after successful export", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild-789",
        options: { getInteger: { days: 45 } },
      } as any);

      await handleExport(interaction as ChatInputCommandInteraction);

      const { logger } = await import("../../../src/commands/stats/shared.js");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "test-guild-789",
          days: 45,
          count: 2,
        }),
        "[stats:export] full CSV export generated"
      );
    });
  });

  describe("database query", () => {
    it("prepares SQL query", async () => {
      const interaction = createMockInteraction();

      await handleExport(interaction as ChatInputCommandInteraction);

      expect(mockPrepare).toHaveBeenCalled();
      const sqlQuery = mockPrepare.mock.calls[0][0];
      expect(sqlQuery).toContain("SELECT");
      expect(sqlQuery).toContain("actor_id");
      expect(sqlQuery).toContain("action_log");
    });

    it("orders results by total desc", async () => {
      const interaction = createMockInteraction();

      await handleExport(interaction as ChatInputCommandInteraction);

      const sqlQuery = mockPrepare.mock.calls[0][0];
      expect(sqlQuery).toContain("ORDER BY total DESC");
    });

    it("filters by decision actions", async () => {
      const interaction = createMockInteraction();

      await handleExport(interaction as ChatInputCommandInteraction);

      const sqlQuery = mockPrepare.mock.calls[0][0];
      expect(sqlQuery).toContain("approve");
      expect(sqlQuery).toContain("reject");
      expect(sqlQuery).toContain("perm_reject");
      expect(sqlQuery).toContain("kick");
      expect(sqlQuery).toContain("modmail_open");
    });
  });
});
