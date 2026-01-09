/**
 * Pawtropolis Tech — tests/commands/stats/approvalRate.test.ts
 * WHAT: Unit tests for /stats approval-rate command handler.
 * WHY: Verify approval rate analytics, trend calculations, and permission checks.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockInteraction, createMockMember } from "../../utils/discordMocks.js";
import { createTestCommandContext } from "../../utils/contextFactory.js";
import type { ChatInputCommandInteraction, MessageFlags } from "discord.js";

// Hoisted mocks
const { mockGetApprovalRateTrend, mockGetTopRejectionReasons, mockHasStaffPermissions, mockNowUtc, mockCaptureException } = vi.hoisted(() => ({
  mockGetApprovalRateTrend: vi.fn(),
  mockGetTopRejectionReasons: vi.fn(),
  mockHasStaffPermissions: vi.fn(),
  mockNowUtc: vi.fn(),
  mockCaptureException: vi.fn(),
}));

// Mock shared module
vi.mock("../../../src/commands/stats/shared.js", async () => {
  const { EmbedBuilder, MessageFlags: MF } = await vi.importActual("discord.js");
  return {
    ChatInputCommandInteraction: {},
    EmbedBuilder,
    MessageFlags: MF,
    hasStaffPermissions: mockHasStaffPermissions,
    nowUtc: mockNowUtc,
    captureException: mockCaptureException,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock("../../../src/features/analytics/approvalRate.js", () => ({
  getApprovalRateTrend: mockGetApprovalRateTrend,
  getTopRejectionReasons: mockGetTopRejectionReasons,
}));

import { handleApprovalRate } from "../../../src/commands/stats/approvalRate.js";

describe("stats/approvalRate", () => {
  const baseTrend = {
    current: {
      total: 100,
      approvals: 80,
      rejections: 15,
      kicks: 3,
      permRejects: 2,
      approvalPct: 80.0,
      rejectionPct: 15.0,
      kickPct: 3.0,
      permRejectPct: 2.0,
    },
    previous: {
      total: 90,
      approvals: 70,
      rejections: 15,
      kicks: 3,
      permRejects: 2,
      approvalPct: 77.8,
      rejectionPct: 16.7,
      kickPct: 3.3,
      permRejectPct: 2.2,
    },
    approvalRateDelta: 2.2,
    trendDirection: "up" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHasStaffPermissions.mockReturnValue(true);
    mockNowUtc.mockReturnValue(1700000000);
    mockGetApprovalRateTrend.mockReturnValue(baseTrend);
    mockGetTopRejectionReasons.mockReturnValue([
      { reason: "NSFW content", percentage: 45.5 },
      { reason: "Underage", percentage: 30.2 },
      { reason: "Invalid application", percentage: 24.3 },
    ]);
  });

  describe("guild validation", () => {
    it("replies with error when used outside a guild", async () => {
      const interaction = createMockInteraction({ guildId: null } as any);
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "This command must be run in a server.",
      });
    });
  });

  describe("permission checks", () => {
    it("calls hasStaffPermissions with member and guildId", async () => {
      const member = createMockMember();
      const interaction = createMockInteraction({ member } as any);
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      expect(mockHasStaffPermissions).toHaveBeenCalledWith(member, "guild-123");
    });

    it("replies with error when no member", async () => {
      const interaction = createMockInteraction({ member: null } as any);
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "You don't have permission to use this command.",
      });
    });

    it("replies with error when permission check fails", async () => {
      mockHasStaffPermissions.mockReturnValue(false);
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "You don't have permission to use this command.",
      });
    });

    it("does not call analytics when permission denied", async () => {
      mockHasStaffPermissions.mockReturnValue(false);
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      expect(mockGetApprovalRateTrend).not.toHaveBeenCalled();
      expect(mockGetTopRejectionReasons).not.toHaveBeenCalled();
    });
  });

  describe("options handling", () => {
    it("uses default days (30) when not provided", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { days: null } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      expect(mockGetApprovalRateTrend).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "guild-123",
          from: 1700000000 - 30 * 86400,
          to: 1700000000,
        })
      );
    });

    it("uses provided days value", async () => {
      mockNowUtc.mockReturnValue(1700000000);
      const interaction = createMockInteraction({
        options: { getInteger: { days: 60 } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      expect(mockGetApprovalRateTrend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 1700000000 - 60 * 86400,
          to: 1700000000,
        })
      );
    });
  });

  describe("successful execution", () => {
    it("defers reply ephemerally", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      expect(interaction.deferReply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: expect.anything() })
      );
    });

    it("calls getApprovalRateTrend with correct parameters", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild-789",
        options: { getInteger: { days: 14 } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      expect(mockGetApprovalRateTrend).toHaveBeenCalledWith({
        guildId: "test-guild-789",
        from: expect.any(Number),
        to: expect.any(Number),
      });
    });

    it("calls getTopRejectionReasons with limit of 5", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      expect(mockGetTopRejectionReasons).toHaveBeenCalledWith(
        expect.objectContaining({ guildId: "guild-123" }),
        5
      );
    });

    it("replies with embed containing stats", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.any(Object)]),
        })
      );
    });

    it("embed contains correct title with days", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { days: 45 } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.title).toBe("Approval Rate Analytics (Last 45 Days)");
    });

    it("embed contains Overall Stats field", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      const overallField = fields.find((f: any) => f.name === "Overall Stats");
      expect(overallField).toBeDefined();
      expect(overallField.value).toContain("Total Decisions");
      expect(overallField.value).toContain("100");
    });

    it("embed contains Trend field", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      const trendField = fields.find((f: any) => f.name.includes("Trend"));
      expect(trendField).toBeDefined();
      expect(trendField.value).toContain("80.0%");
    });

    it("embed contains Top Rejection Reasons field", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      const reasonsField = fields.find((f: any) => f.name === "Top Rejection Reasons");
      expect(reasonsField).toBeDefined();
      expect(reasonsField.value).toContain("NSFW content");
      expect(reasonsField.value).toContain("46%");
    });
  });

  describe("trend direction formatting", () => {
    it("shows up arrow for positive trend", async () => {
      mockGetApprovalRateTrend.mockReturnValue({
        ...baseTrend,
        trendDirection: "up",
        approvalRateDelta: 5.5,
      });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const trendField = call.embeds[0].data.fields.find((f: any) => f.name.includes("Trend"));
      expect(trendField.value).toContain("\u2191"); // Up arrow
      expect(trendField.value).toContain("+5.5%");
    });

    it("shows down arrow for negative trend", async () => {
      mockGetApprovalRateTrend.mockReturnValue({
        ...baseTrend,
        trendDirection: "down",
        approvalRateDelta: -3.2,
      });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const trendField = call.embeds[0].data.fields.find((f: any) => f.name.includes("Trend"));
      expect(trendField.value).toContain("\u2193"); // Down arrow
      expect(trendField.value).toContain("-3.2%");
    });

    it("shows horizontal arrow for stable trend", async () => {
      mockGetApprovalRateTrend.mockReturnValue({
        ...baseTrend,
        trendDirection: "stable",
        approvalRateDelta: 0,
      });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const trendField = call.embeds[0].data.fields.find((f: any) => f.name.includes("Trend"));
      expect(trendField.value).toContain("\u2194"); // Horizontal arrow
    });

    it("uses green color for positive trend", async () => {
      mockGetApprovalRateTrend.mockReturnValue({
        ...baseTrend,
        trendDirection: "up",
      });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.color).toBe(0x57f287);
    });

    it("uses red color for negative trend", async () => {
      mockGetApprovalRateTrend.mockReturnValue({
        ...baseTrend,
        trendDirection: "down",
      });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.color).toBe(0xed4245);
    });

    it("uses blurple color for stable trend", async () => {
      mockGetApprovalRateTrend.mockReturnValue({
        ...baseTrend,
        trendDirection: "stable",
      });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.color).toBe(0x5865f2);
    });
  });

  describe("rejection reasons handling", () => {
    it("shows no rejections message when empty", async () => {
      mockGetTopRejectionReasons.mockReturnValue([]);
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const reasonsField = call.embeds[0].data.fields.find((f: any) => f.name === "Top Rejection Reasons");
      expect(reasonsField.value).toBe("No rejections in this period");
    });

    it("truncates long rejection reasons", async () => {
      mockGetTopRejectionReasons.mockReturnValue([
        {
          reason: "This is a very long rejection reason that should be truncated at 40 characters",
          percentage: 50,
        },
      ]);
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const reasonsField = call.embeds[0].data.fields.find((f: any) => f.name === "Top Rejection Reasons");
      expect(reasonsField.value).toContain("...");
      expect(reasonsField.value.length).toBeLessThan(100);
    });

    it("numbers rejection reasons", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const reasonsField = call.embeds[0].data.fields.find((f: any) => f.name === "Top Rejection Reasons");
      expect(reasonsField.value).toContain("1.");
      expect(reasonsField.value).toContain("2.");
      expect(reasonsField.value).toContain("3.");
    });
  });

  describe("footer and timestamp", () => {
    it("includes date range in footer", async () => {
      mockNowUtc.mockReturnValue(1700000000);
      const interaction = createMockInteraction({
        options: { getInteger: { days: 30 } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.footer).toBeDefined();
      expect(call.embeds[0].data.footer.text).toContain("Data from");
    });

    it("includes timestamp", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.timestamp).toBeDefined();
    });
  });

  describe("telemetry", () => {
    it("calls captureException for analytics tracking", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { days: 45 } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      expect(mockCaptureException).toHaveBeenCalledWith(null, {
        area: "stats.approval-rate.run",
        tags: expect.objectContaining({
          days: 45,
          guildId: "guild-123",
        }),
      });
    });

    it("logs info after successful render", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const { logger } = await import("../../../src/commands/stats/shared.js");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          render: "stats:approval-rate",
          total: 100,
          approvalPct: 80.0,
          trend: "up",
        }),
        expect.any(String)
      );
    });
  });

  describe("error handling", () => {
    it("logs error when analytics fail", async () => {
      mockGetApprovalRateTrend.mockImplementation(() => {
        throw new Error("Database connection failed");
      });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleApprovalRate(ctx);

      const { logger } = await import("../../../src/commands/stats/shared.js");
      expect(logger.error).toHaveBeenCalled();
    });

    it("sends error message with trace ID", async () => {
      mockGetApprovalRateTrend.mockImplementation(() => {
        throw new Error("Query failed");
      });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction, { traceId: "trace-abc-123" });

      await handleApprovalRate(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("trace-abc-123"),
      });
    });

    it("calls captureException on error", async () => {
      mockGetApprovalRateTrend.mockImplementation(() => {
        throw new Error("Analytics error");
      });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction, { traceId: "trace-xyz" });

      await handleApprovalRate(ctx);

      expect(mockCaptureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          area: "stats.approval-rate.run",
          traceId: "trace-xyz",
        })
      );
    });

    it("handles editReply failure gracefully", async () => {
      mockGetApprovalRateTrend.mockImplementation(() => {
        throw new Error("DB error");
      });
      const interaction = createMockInteraction();
      (interaction.editReply as any).mockRejectedValue(new Error("Expired"));
      const ctx = createTestCommandContext(interaction);

      // Should not throw
      await expect(handleApprovalRate(ctx)).resolves.not.toThrow();
    });
  });
});
