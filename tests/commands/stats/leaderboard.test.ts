/**
 * Pawtropolis Tech — tests/commands/stats/leaderboard.test.ts
 * WHAT: Unit tests for /stats leaderboard command handler.
 * WHY: Verify moderator rankings, CSV export, and image generation.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockInteraction, createMockMember, createMockGuild } from "../../utils/discordMocks.js";
import type { ChatInputCommandInteraction, GuildMember } from "discord.js";

// Hoisted mocks
const { mockPrepare, mockAll, mockRequireMinRole, mockNowUtc, mockGetAvgClaimToDecision, mockGenerateLeaderboardImage } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockAll: vi.fn(),
  mockRequireMinRole: vi.fn(),
  mockNowUtc: vi.fn(),
  mockGetAvgClaimToDecision: vi.fn(),
  mockGenerateLeaderboardImage: vi.fn(),
}));

// Mock shared module
vi.mock("../../../src/commands/stats/shared.js", async () => {
  const { EmbedBuilder, AttachmentBuilder } = await vi.importActual("discord.js");
  return {
    ChatInputCommandInteraction: {},
    EmbedBuilder,
    AttachmentBuilder,
    db: { prepare: mockPrepare },
    nowUtc: mockNowUtc,
    requireMinRole: mockRequireMinRole,
    ROLE_IDS: {
      GATEKEEPER: "role-gatekeeper",
      SENIOR_MOD: "role-sm",
      SENIOR_ADMIN: "role-sa",
    },
    getAvgClaimToDecision: mockGetAvgClaimToDecision,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock("../../../src/lib/leaderboardImage.js", () => ({
  generateLeaderboardImage: mockGenerateLeaderboardImage,
}));

import { handleLeaderboard } from "../../../src/commands/stats/leaderboard.js";

describe("stats/leaderboard", () => {
  const mockRows = [
    { actor_id: "mod-001", total: 150, approvals: 120, rejections: 20, modmail: 5, perm_reject: 3, kicks: 2 },
    { actor_id: "mod-002", total: 100, approvals: 85, rejections: 10, modmail: 3, perm_reject: 1, kicks: 1 },
    { actor_id: "mod-003", total: 75, approvals: 60, rejections: 10, modmail: 2, perm_reject: 2, kicks: 1 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMinRole.mockReturnValue(true);
    mockNowUtc.mockReturnValue(1700000000);
    mockPrepare.mockReturnValue({ all: mockAll });
    mockAll.mockReturnValue(mockRows);
    mockGetAvgClaimToDecision.mockReturnValue(180);
    mockGenerateLeaderboardImage.mockResolvedValue(Buffer.from("fake-png"));
  });

  describe("guild validation", () => {
    it("replies with error when used outside a guild", async () => {
      const interaction = createMockInteraction({ guildId: null } as any);

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "This command must be run in a guild.",
        ephemeral: true,
      });
    });

    it("does not defer reply when guild is missing", async () => {
      const interaction = createMockInteraction({ guildId: null } as any);

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      expect(interaction.deferReply).not.toHaveBeenCalled();
    });
  });

  describe("permission checks", () => {
    it("calls requireMinRole with GATEKEEPER role", async () => {
      const interaction = createMockInteraction();

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      expect(mockRequireMinRole).toHaveBeenCalledWith(
        interaction,
        "role-gatekeeper",
        expect.objectContaining({
          command: "stats leaderboard",
          description: "Views moderator leaderboard.",
        })
      );
    });

    it("returns early when permission check fails", async () => {
      mockRequireMinRole.mockReturnValue(false);
      const interaction = createMockInteraction();

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(mockAll).not.toHaveBeenCalled();
    });
  });

  describe("options handling", () => {
    it("uses default days (30) when not provided", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { days: null }, getBoolean: { export: null } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      expect(mockAll).toHaveBeenCalledWith("guild-123", 1700000000 - 30 * 86400);
    });

    it("uses provided days value", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { days: 60 }, getBoolean: { export: false } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      expect(mockAll).toHaveBeenCalledWith("guild-123", 1700000000 - 60 * 86400);
    });

    it("uses default export (false) when not provided", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { days: 30 }, getBoolean: { export: null } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      // Should generate image, not CSV
      expect(mockGenerateLeaderboardImage).toHaveBeenCalled();
    });
  });

  describe("successful execution - image mode", () => {
    it("defers reply publicly", async () => {
      const interaction = createMockInteraction({
        options: { getBoolean: { export: false } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      expect(interaction.deferReply).toHaveBeenCalledWith();
    });

    it("queries database with correct parameters", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild-456",
        options: { getInteger: { days: 14 } },
      } as any);

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      expect(mockAll).toHaveBeenCalledWith("test-guild-456", 1700000000 - 14 * 86400);
    });

    it("generates leaderboard image", async () => {
      const interaction = createMockInteraction({
        options: { getBoolean: { export: false } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      expect(mockGenerateLeaderboardImage).toHaveBeenCalled();
    });

    it("replies with embed and image attachment", async () => {
      const interaction = createMockInteraction({
        options: { getBoolean: { export: false } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.any(Object)]),
          files: expect.arrayContaining([expect.any(Object)]),
        })
      );
    });

    it("embed contains correct title", async () => {
      const interaction = createMockInteraction({
        options: { getBoolean: { export: false } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.title).toBe("Moderator Leaderboard");
    });

    it("embed contains days in description", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { days: 45 }, getBoolean: { export: false } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.description).toContain("45 days");
    });

    it("shows footer when more than 15 moderators", async () => {
      // Create 20 mock moderators
      const manyRows = Array.from({ length: 20 }, (_, i) => ({
        actor_id: `mod-${String(i).padStart(3, "0")}`,
        total: 100 - i,
        approvals: 80 - i,
        rejections: 10,
        modmail: 5,
        perm_reject: 3,
        kicks: 2,
      }));
      mockAll.mockReturnValue(manyRows);

      const interaction = createMockInteraction({
        options: { getBoolean: { export: false } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.footer.text).toContain("Showing top 15");
      expect(call.embeds[0].data.footer.text).toContain("20 moderators");
    });

    it("limits display to 15 moderators", async () => {
      const manyRows = Array.from({ length: 20 }, (_, i) => ({
        actor_id: `mod-${i}`,
        total: 100 - i,
        approvals: 80,
        rejections: 10,
        modmail: 5,
        perm_reject: 3,
        kicks: 2,
      }));
      mockAll.mockReturnValue(manyRows);

      const interaction = createMockInteraction({
        options: { getBoolean: { export: false } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      // generateLeaderboardImage should be called with only 15 items
      expect(mockGenerateLeaderboardImage).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ rank: 1 })])
      );
      const callArg = mockGenerateLeaderboardImage.mock.calls[0][0];
      expect(callArg.length).toBeLessThanOrEqual(15);
    });
  });

  describe("CSV export mode", () => {
    it("generates CSV when export=true", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { days: 30 }, getBoolean: { export: true } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      expect(mockGenerateLeaderboardImage).not.toHaveBeenCalled();
      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.files[0].name).toMatch(/\.csv$/);
    });

    it("CSV contains moderator count in message", async () => {
      const interaction = createMockInteraction({
        options: { getBoolean: { export: true } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.content).toContain("3 moderators");
    });

    it("CSV filename includes days", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { days: 45 }, getBoolean: { export: true } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.files[0].name).toContain("45d");
    });

    it("calls getAvgClaimToDecision for each moderator in CSV", async () => {
      const interaction = createMockInteraction({
        options: { getBoolean: { export: true } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      expect(mockGetAvgClaimToDecision).toHaveBeenCalledTimes(3);
    });

    it("logs CSV export", async () => {
      const interaction = createMockInteraction({
        options: { getBoolean: { export: true } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      const { logger } = await import("../../../src/commands/stats/shared.js");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ count: 3 }),
        "[stats:leaderboard] CSV export generated"
      );
    });
  });

  describe("empty results handling", () => {
    it("sends message when no data found", async () => {
      mockAll.mockReturnValue([]);
      const interaction = createMockInteraction({
        options: { getInteger: { days: 7 } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "No decisions found in the last 7 days.",
      });
    });

    it("does not generate image when empty", async () => {
      mockAll.mockReturnValue([]);
      const interaction = createMockInteraction();

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      expect(mockGenerateLeaderboardImage).not.toHaveBeenCalled();
    });
  });

  describe("member fetching", () => {
    it("attempts to fetch member info for display names", async () => {
      const mockGuild = createMockGuild();
      (mockGuild.members.fetch as any).mockResolvedValue(new Map());
      const interaction = createMockInteraction({
        guild: mockGuild,
        options: { getBoolean: { export: false } },
      } as any);

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      expect(mockGuild.members.fetch).toHaveBeenCalled();
    });

    it("continues if member fetch fails", async () => {
      const mockGuild = createMockGuild();
      (mockGuild.members.fetch as any).mockRejectedValue(new Error("Fetch failed"));
      const interaction = createMockInteraction({
        guild: mockGuild,
        options: { getBoolean: { export: false } },
      } as any);

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      // Should still generate image with "Unknown" names
      expect(mockGenerateLeaderboardImage).toHaveBeenCalled();
    });

    it("uses displayName from fetched members", async () => {
      const mockGuild = createMockGuild();
      const mockMemberMap = new Map([
        ["mod-001", { displayName: "CoolMod", displayHexColor: "#FF0000" }],
        ["mod-002", { displayName: "SuperMod", displayHexColor: "#00FF00" }],
      ]);
      (mockGuild.members.fetch as any).mockResolvedValue(mockMemberMap);
      const interaction = createMockInteraction({
        guild: mockGuild,
        options: { getBoolean: { export: false } },
      } as any);

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      const callArg = mockGenerateLeaderboardImage.mock.calls[0][0];
      expect(callArg[0].displayName).toBe("CoolMod");
      expect(callArg[1].displayName).toBe("SuperMod");
    });

    it("uses Unknown for missing members", async () => {
      const mockGuild = createMockGuild();
      (mockGuild.members.fetch as any).mockResolvedValue(new Map());
      const interaction = createMockInteraction({
        guild: mockGuild,
        options: { getBoolean: { export: false } },
      } as any);

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      const callArg = mockGenerateLeaderboardImage.mock.calls[0][0];
      expect(callArg[0].displayName).toBe("Unknown");
    });
  });

  describe("ModStats data formatting", () => {
    it("includes correct rank numbers", async () => {
      const interaction = createMockInteraction({
        options: { getBoolean: { export: false } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      const callArg = mockGenerateLeaderboardImage.mock.calls[0][0];
      expect(callArg[0].rank).toBe(1);
      expect(callArg[1].rank).toBe(2);
      expect(callArg[2].rank).toBe(3);
    });

    it("combines rejections, perm_reject, and kicks", async () => {
      const interaction = createMockInteraction({
        options: { getBoolean: { export: false } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      const callArg = mockGenerateLeaderboardImage.mock.calls[0][0];
      // mod-001: rejections=20 + perm_reject=3 + kicks=2 = 25
      expect(callArg[0].rejections).toBe(25);
    });

    it("includes avgTimeSeconds from getAvgClaimToDecision", async () => {
      mockGetAvgClaimToDecision.mockReturnValue(240);
      const interaction = createMockInteraction({
        options: { getBoolean: { export: false } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      const callArg = mockGenerateLeaderboardImage.mock.calls[0][0];
      expect(callArg[0].avgTimeSeconds).toBe(240);
    });

    it("handles null avgTime", async () => {
      mockGetAvgClaimToDecision.mockReturnValue(null);
      const interaction = createMockInteraction({
        options: { getBoolean: { export: false } },
      });

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      const callArg = mockGenerateLeaderboardImage.mock.calls[0][0];
      expect(callArg[0].avgTimeSeconds).toBe(0);
    });
  });

  describe("logging", () => {
    it("logs image display", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild-789",
        options: { getInteger: { days: 14 }, getBoolean: { export: false } },
      } as any);

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      const { logger } = await import("../../../src/commands/stats/shared.js");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "test-guild-789",
          days: 14,
          count: 3,
        }),
        "[stats:leaderboard] displayed"
      );
    });
  });

  describe("database query", () => {
    it("limits to 100 results", async () => {
      const interaction = createMockInteraction();

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      const sqlQuery = mockPrepare.mock.calls[0][0];
      expect(sqlQuery).toContain("LIMIT 100");
    });

    it("orders by total then approvals", async () => {
      const interaction = createMockInteraction();

      await handleLeaderboard(interaction as ChatInputCommandInteraction);

      const sqlQuery = mockPrepare.mock.calls[0][0];
      expect(sqlQuery).toContain("ORDER BY total DESC, approvals DESC");
    });
  });
});
