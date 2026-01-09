/**
 * Pawtropolis Tech — tests/commands/stats/user.test.ts
 * WHAT: Unit tests for /stats user command handler.
 * WHY: Verify individual moderator stats display and calculations.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockInteraction, createMockUser } from "../../utils/discordMocks.js";
import type { ChatInputCommandInteraction } from "discord.js";

// Hoisted mocks
const { mockPrepare, mockGet, mockRequireMinRole, mockNowUtc, mockGetAvgClaimToDecision, mockGetAvgSubmitToFirstClaim, mockFormatDuration } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockGet: vi.fn(),
  mockRequireMinRole: vi.fn(),
  mockNowUtc: vi.fn(),
  mockGetAvgClaimToDecision: vi.fn(),
  mockGetAvgSubmitToFirstClaim: vi.fn(),
  mockFormatDuration: vi.fn(),
}));

// Mock shared module
vi.mock("../../../src/commands/stats/shared.js", async () => {
  const { EmbedBuilder } = await vi.importActual("discord.js");
  return {
    ChatInputCommandInteraction: {},
    EmbedBuilder,
    db: { prepare: mockPrepare },
    nowUtc: mockNowUtc,
    requireMinRole: mockRequireMinRole,
    ROLE_IDS: {
      GATEKEEPER: "role-gatekeeper",
      SENIOR_MOD: "role-sm",
      SENIOR_ADMIN: "role-sa",
    },
    SAFE_ALLOWED_MENTIONS: { parse: [] },
    getAvgClaimToDecision: mockGetAvgClaimToDecision,
    getAvgSubmitToFirstClaim: mockGetAvgSubmitToFirstClaim,
    formatDuration: mockFormatDuration,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

import { handleUser } from "../../../src/commands/stats/user.js";

describe("stats/user", () => {
  const mockModeratorUser = createMockUser({ id: "mod-user-123", tag: "TestMod#0001" });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMinRole.mockReturnValue(true);
    mockNowUtc.mockReturnValue(1700000000);
    mockPrepare.mockReturnValue({ get: mockGet });
    mockGet.mockReturnValue({
      total: 150,
      approvals: 120,
      rejections: 20,
      modmail: 5,
      perm_reject: 3,
      kicks: 2,
    });
    mockGetAvgClaimToDecision.mockReturnValue(180);
    mockGetAvgSubmitToFirstClaim.mockReturnValue(300);
    mockFormatDuration.mockImplementation((s: number | null) => {
      if (s === null) return "—";
      return `${Math.floor(s / 60)}m`;
    });
  });

  describe("guild validation", () => {
    it("replies with error when used outside a guild", async () => {
      const interaction = createMockInteraction({ guildId: null } as any);

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "This command must be run in a guild.",
        ephemeral: true,
      });
    });

    it("does not defer reply when guild is missing", async () => {
      const interaction = createMockInteraction({ guildId: null } as any);

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(interaction.deferReply).not.toHaveBeenCalled();
    });
  });

  describe("permission checks", () => {
    it("calls requireMinRole with GATEKEEPER role", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(mockRequireMinRole).toHaveBeenCalledWith(
        interaction,
        "role-gatekeeper",
        expect.objectContaining({
          command: "stats user",
          description: "Views individual moderator stats.",
        })
      );
    });

    it("returns early when permission check fails", async () => {
      mockRequireMinRole.mockReturnValue(false);
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  describe("options handling", () => {
    it("uses required moderator option", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(mockGet).toHaveBeenCalledWith("guild-123", "mod-user-123", expect.any(Number));
    });

    it("uses default days (30) when not provided", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getInteger: { days: null } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(mockGet).toHaveBeenCalledWith("guild-123", "mod-user-123", 1700000000 - 30 * 86400);
    });

    it("uses provided days value", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getInteger: { days: 60 } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(mockGet).toHaveBeenCalledWith("guild-123", "mod-user-123", 1700000000 - 60 * 86400);
    });
  });

  describe("successful execution", () => {
    it("defers reply publicly", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(interaction.deferReply).toHaveBeenCalledWith();
    });

    it("queries database with correct parameters", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild-456",
        options: { getUser: { moderator: mockModeratorUser }, getInteger: { days: 14 } },
      } as any);

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(mockGet).toHaveBeenCalledWith("test-guild-456", "mod-user-123", expect.any(Number));
    });

    it("replies with embed containing stats", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.any(Object)]),
        })
      );
    });

    it("embed contains correct title with moderator tag", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.title).toBe("Moderator Stats: TestMod#0001");
    });

    it("embed contains days in description", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getInteger: { days: 45 } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.description).toContain("45 days");
    });

    it("sets thumbnail using moderator avatar", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      // The embed should have called displayAvatarURL on the moderator
      expect(mockModeratorUser.displayAvatarURL).toHaveBeenCalled();
    });

    it("embed contains decision count field", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(
        expect.objectContaining({ name: "Decisions", value: "**150**" })
      );
    });

    it("embed contains accepted count field", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(
        expect.objectContaining({ name: "Accepted", value: "120" })
      );
    });

    it("embed combines rejections with perm_reject and kicks", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      // rejections=20 + perm_reject=3 + kicks=2 = 25
      expect(fields).toContainEqual(
        expect.objectContaining({ name: "Rejected", value: "25" })
      );
    });

    it("embed contains modmail count field", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(
        expect.objectContaining({ name: "Modmail", value: "5" })
      );
    });

    it("embed contains avg claim to decision field", async () => {
      mockFormatDuration.mockReturnValue("3m");
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(
        expect.objectContaining({ name: "Avg Claim to Decision", value: "3m" })
      );
    });

    it("embed contains server avg submit to first claim field", async () => {
      mockFormatDuration.mockReturnValue("5m");
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(
        expect.objectContaining({ name: "Server Avg: Submit to First Claim" })
      );
    });

    it("uses SAFE_ALLOWED_MENTIONS in reply", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedMentions: { parse: [] },
        })
      );
    });
  });

  describe("no data handling", () => {
    it("sends message when moderator has no decisions (undefined row)", async () => {
      mockGet.mockReturnValue(undefined);
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getInteger: { days: 7 } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "TestMod#0001 has no decisions in the last 7 days.",
      });
    });

    it("sends message when moderator has zero total", async () => {
      mockGet.mockReturnValue({
        total: 0,
        approvals: 0,
        rejections: 0,
        modmail: 0,
        perm_reject: 0,
        kicks: 0,
      });
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getInteger: { days: 14 } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "TestMod#0001 has no decisions in the last 14 days.",
      });
    });

    it("does not call timing functions when no data", async () => {
      mockGet.mockReturnValue(undefined);
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(mockGetAvgClaimToDecision).not.toHaveBeenCalled();
      expect(mockGetAvgSubmitToFirstClaim).not.toHaveBeenCalled();
    });
  });

  describe("timing calculations", () => {
    it("calls getAvgClaimToDecision with correct parameters", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild-789",
        options: { getUser: { moderator: mockModeratorUser }, getInteger: { days: 45 } },
      } as any);

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(mockGetAvgClaimToDecision).toHaveBeenCalledWith(
        "test-guild-789",
        "mod-user-123",
        1700000000 - 45 * 86400
      );
    });

    it("calls getAvgSubmitToFirstClaim with correct parameters", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild-789",
        options: { getUser: { moderator: mockModeratorUser }, getInteger: { days: 45 } },
      } as any);

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(mockGetAvgSubmitToFirstClaim).toHaveBeenCalledWith(
        "test-guild-789",
        1700000000 - 45 * 86400
      );
    });

    it("calls formatDuration with claim to decision time", async () => {
      mockGetAvgClaimToDecision.mockReturnValue(240);
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(mockFormatDuration).toHaveBeenCalledWith(240);
    });

    it("calls formatDuration with submit to first claim time", async () => {
      mockGetAvgSubmitToFirstClaim.mockReturnValue(360);
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      expect(mockFormatDuration).toHaveBeenCalledWith(360);
    });
  });

  describe("logging", () => {
    it("logs info after successful display", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild-789",
        options: { getUser: { moderator: mockModeratorUser }, getInteger: { days: 14 } },
      } as any);

      await handleUser(interaction as ChatInputCommandInteraction);

      const { logger } = await import("../../../src/commands/stats/shared.js");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "test-guild-789",
          moderatorId: "mod-user-123",
          days: 14,
        }),
        "[stats:user] displayed"
      );
    });
  });

  describe("embed styling", () => {
    it("uses blurple color", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.color).toBe(0x5865f2);
    });

    it("includes timestamp", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.timestamp).toBeDefined();
    });

    it("all fields are inline", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });

      await handleUser(interaction as ChatInputCommandInteraction);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      for (const field of fields) {
        expect(field.inline).toBe(true);
      }
    });
  });
});
