/**
 * Pawtropolis Tech — tests/commands/stats/history.test.ts
 * WHAT: Unit tests for /stats history command handler.
 * WHY: Verify moderator history display, CSV export, and leadership permissions.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockInteraction, createMockUser, createMockGuild, createMockMember } from "../../utils/discordMocks.js";
import { createTestCommandContext } from "../../utils/contextFactory.js";
import type { ChatInputCommandInteraction } from "discord.js";

// Hoisted mocks
const {
  mockPrepare,
  mockGet,
  mockAll,
  mockIsOwner,
  mockHasStaffPermissions,
  mockGetConfig,
  mockIsGuildMember,
  mockComputePercentiles,
  mockDetectModeratorAnomalies,
  mockGenerateModHistoryCsv,
  mockLogActionPretty,
  mockWriteFileSync,
  mockMkdirSync,
} = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockGet: vi.fn(),
  mockAll: vi.fn(),
  mockIsOwner: vi.fn(),
  mockHasStaffPermissions: vi.fn(),
  mockGetConfig: vi.fn(),
  mockIsGuildMember: vi.fn(),
  mockComputePercentiles: vi.fn(),
  mockDetectModeratorAnomalies: vi.fn(),
  mockGenerateModHistoryCsv: vi.fn(),
  mockLogActionPretty: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
}));

// Mock shared module
vi.mock("../../../src/commands/stats/shared.js", async () => {
  const { EmbedBuilder } = await vi.importActual("discord.js");
  return {
    ChatInputCommandInteraction: {},
    EmbedBuilder,
    db: { prepare: mockPrepare },
    isOwner: mockIsOwner,
    hasStaffPermissions: mockHasStaffPermissions,
    getConfig: mockGetConfig,
    isGuildMember: mockIsGuildMember,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock("../../../src/lib/percentiles.js", () => ({
  computePercentiles: mockComputePercentiles,
}));

vi.mock("../../../src/lib/anomaly.js", () => ({
  detectModeratorAnomalies: mockDetectModeratorAnomalies,
}));

vi.mock("../../../src/lib/csv.js", () => ({
  generateModHistoryCsv: mockGenerateModHistoryCsv,
}));

vi.mock("../../../src/logging/pretty.js", () => ({
  logActionPretty: mockLogActionPretty,
}));

vi.mock("node:fs", () => ({
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
}));

vi.mock("node:crypto", () => ({
  randomBytes: vi.fn(() => ({ toString: () => "abcd1234" })),
}));

import { handleHistory } from "../../../src/commands/stats/history.js";

describe("stats/history", () => {
  const mockModeratorUser = createMockUser({ id: "mod-user-123", tag: "TestMod#0001" });

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOwner.mockReturnValue(false);
    mockHasStaffPermissions.mockReturnValue(true);
    mockGetConfig.mockReturnValue(null);
    mockIsGuildMember.mockReturnValue(true);
    mockPrepare.mockReturnValue({ get: mockGet, all: mockAll });
    mockGet.mockReturnValue({ total: 100 });
    mockAll.mockImplementation((query) => {
      if (typeof query === "string") return [];
      return [
        { action: "approve", cnt: 80 },
        { action: "reject", cnt: 15 },
        { action: "kick", cnt: 5 },
      ];
    });
    mockComputePercentiles.mockReturnValue(new Map([[50, 30000], [95, 120000]]));
    mockDetectModeratorAnomalies.mockReturnValue({ isAnomaly: false, score: 0.5, reason: "" });
    mockLogActionPretty.mockResolvedValue(undefined);
  });

  describe("guild validation", () => {
    it("replies with error when used outside a guild", async () => {
      const interaction = createMockInteraction({
        guildId: null,
        options: { getUser: { moderator: mockModeratorUser } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
    });

    it("does not defer reply when guild is missing", async () => {
      const interaction = createMockInteraction({
        guildId: null,
        options: { getUser: { moderator: mockModeratorUser } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.deferReply).not.toHaveBeenCalled();
    });
  });

  describe("leadership permission checks", () => {
    it("allows bot owner", async () => {
      mockIsOwner.mockReturnValue(true);
      mockHasStaffPermissions.mockReturnValue(false);
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.deferReply).toHaveBeenCalled();
    });

    it("allows guild owner", async () => {
      mockIsOwner.mockReturnValue(false);
      mockHasStaffPermissions.mockReturnValue(false);
      const mockGuild = createMockGuild({ ownerId: "user-123" });
      const interaction = createMockInteraction({
        user: { id: "user-123" },
        guild: mockGuild,
        options: { getUser: { moderator: mockModeratorUser } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.deferReply).toHaveBeenCalled();
    });

    it("allows staff permissions", async () => {
      mockHasStaffPermissions.mockReturnValue(true);
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.deferReply).toHaveBeenCalled();
    });

    it("allows leadership role", async () => {
      mockIsOwner.mockReturnValue(false);
      mockHasStaffPermissions.mockReturnValue(false);
      mockGetConfig.mockReturnValue({ leadership_role_id: "leadership-role" });
      mockIsGuildMember.mockReturnValue(true);

      const member = createMockMember();
      (member.roles.cache as Map<string, any>).set("leadership-role", {});

      const interaction = createMockInteraction({
        member,
        options: { getUser: { moderator: mockModeratorUser } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.deferReply).toHaveBeenCalled();
    });

    it("denies without leadership permissions", async () => {
      mockIsOwner.mockReturnValue(false);
      mockHasStaffPermissions.mockReturnValue(false);
      mockGetConfig.mockReturnValue(null);

      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "This command requires leadership role or admin permissions.",
        ephemeral: true,
      });
    });

    it("denies when member permissions is a string", async () => {
      mockIsOwner.mockReturnValue(false);
      const interaction = createMockInteraction({
        member: { permissions: "0" },
        options: { getUser: { moderator: mockModeratorUser } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("leadership") })
      );
    });
  });

  describe("options handling", () => {
    it("uses required moderator option", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(mockGet).toHaveBeenCalled();
    });

    it("uses default days (30) when not provided", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getInteger: { days: null } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      // Check that from timestamp is ~30 days ago
      expect(mockGet).toHaveBeenCalled();
    });

    it("uses provided days value", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getInteger: { days: 60 } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(mockGet).toHaveBeenCalled();
    });

    it("uses default export (false) when not provided", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getBoolean: { export: null } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });

  describe("successful execution", () => {
    it("defers reply ephemerally", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it("replies with embed containing history", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.any(Object)]),
        })
      );
    });

    it("embed contains moderator tag in title", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.title).toContain("TestMod#0001");
    });

    it("embed contains total actions field", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(
        expect.objectContaining({ name: "Total Actions" })
      );
    });

    it("embed contains approvals and rejections", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(expect.objectContaining({ name: "Approvals" }));
      expect(fields).toContainEqual(expect.objectContaining({ name: "Rejections" }));
    });

    it("embed contains reject rate", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(expect.objectContaining({ name: "Reject Rate" }));
    });

    it("embed contains response time percentiles", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(expect.objectContaining({ name: "Response Time (p50)" }));
      expect(fields).toContainEqual(expect.objectContaining({ name: "Response Time (p95)" }));
    });

    it("logs action to pretty logger", async () => {
      const mockGuild = createMockGuild();
      const interaction = createMockInteraction({
        guild: mockGuild,
        user: { id: "leader-123" },
        options: { getUser: { moderator: mockModeratorUser } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(mockLogActionPretty).toHaveBeenCalledWith(
        mockGuild,
        expect.objectContaining({
          action: "stats_history_view",
          actorId: "leader-123",
        })
      );
    });
  });

  describe("anomaly detection", () => {
    it("calls detectModeratorAnomalies with daily counts", async () => {
      mockAll.mockImplementation(() => [
        { day: "2024-01-01", cnt: 10 },
        { day: "2024-01-02", cnt: 15 },
        { day: "2024-01-03", cnt: 12 },
      ]);
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(mockDetectModeratorAnomalies).toHaveBeenCalled();
    });

    it("shows anomaly warning when detected", async () => {
      mockDetectModeratorAnomalies.mockReturnValue({
        isAnomaly: true,
        score: 3.5,
        reason: "Unusually high activity",
      });
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(
        expect.objectContaining({
          name: "Anomaly Detected",
          value: expect.stringContaining("3.50"),
        })
      );
    });

    it("uses warning color when anomaly detected", async () => {
      mockDetectModeratorAnomalies.mockReturnValue({
        isAnomaly: true,
        score: 2.8,
        reason: "Suspicious pattern",
      });
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.color).toBe(0xfaa61a);
    });

    it("uses normal color when no anomaly", async () => {
      mockDetectModeratorAnomalies.mockReturnValue({
        isAnomaly: false,
        score: 0.5,
        reason: "",
      });
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.color).toBe(0x5865f2);
    });
  });

  describe("CSV export", () => {
    beforeEach(() => {
      mockAll.mockReturnValue([
        { id: 1, action: "approve", actor_id: "mod-123", created_at_s: 1700000000 },
        { id: 2, action: "reject", actor_id: "mod-123", created_at_s: 1700000100 },
      ]);
      mockGenerateModHistoryCsv.mockReturnValue("id,action,actor_id\n1,approve,mod-123\n2,reject,mod-123");
    });

    it("creates exports directory", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getBoolean: { export: true } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining("exports"), { recursive: true });
    });

    it("writes CSV file", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getBoolean: { export: true } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it("adds download link to embed", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getBoolean: { export: true } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(
        expect.objectContaining({
          name: "CSV Export",
          value: expect.stringContaining("Download CSV"),
        })
      );
    });

    it("logs export action", async () => {
      const mockGuild = createMockGuild();
      const interaction = createMockInteraction({
        guild: mockGuild,
        user: { id: "leader-456" },
        options: { getUser: { moderator: mockModeratorUser }, getBoolean: { export: true } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(mockLogActionPretty).toHaveBeenCalledWith(
        mockGuild,
        expect.objectContaining({
          action: "stats_history_export",
        })
      );
    });

    it("enforces export row limit", async () => {
      mockGet.mockReturnValue({ total: 60000 }); // Over 50000 limit
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getBoolean: { export: true } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("exceeds limit"),
      });
    });
  });

  describe("high volume warning", () => {
    it("shows sampling note for high volume moderators", async () => {
      mockGet.mockReturnValue({ total: 15000 });
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.description).toContain("sampled");
    });
  });

  describe("error handling", () => {
    it("logs error when query fails", async () => {
      mockPrepare.mockImplementation(() => {
        throw new Error("Database error");
      });
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const { logger } = await import("../../../src/commands/stats/shared.js");
      expect(logger.error).toHaveBeenCalled();
    });

    it("sends user-friendly error message", async () => {
      mockPrepare.mockImplementation(() => {
        throw new Error("Query failed");
      });
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "Failed to fetch moderator history. Please try again later.",
      });
    });
  });

  describe("response time formatting", () => {
    it("shows N/A when no p50 data", async () => {
      mockComputePercentiles.mockReturnValue(new Map());
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const p50Field = call.embeds[0].data.fields.find((f: any) => f.name === "Response Time (p50)");
      expect(p50Field.value).toBe("N/A");
    });

    it("converts ms to seconds for display", async () => {
      mockComputePercentiles.mockReturnValue(new Map([[50, 60000], [95, 180000]]));
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const p50Field = call.embeds[0].data.fields.find((f: any) => f.name === "Response Time (p50)");
      expect(p50Field.value).toBe("60s");
    });
  });

  describe("logging", () => {
    it("logs command execution", async () => {
      const interaction = createMockInteraction({
        user: { id: "leader-789" },
        guildId: "guild-456",
        options: { getUser: { moderator: mockModeratorUser }, getInteger: { days: 14 }, getBoolean: { export: false } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const { logger } = await import("../../../src/commands/stats/shared.js");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          moderatorId: "mod-user-123",
          guildId: "guild-456",
          days: 14,
          exportCsv: false,
        }),
        "[stats:history] command executed"
      );
    });
  });
});
