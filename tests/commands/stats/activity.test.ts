/**
 * Pawtropolis Tech — tests/commands/stats/activity.test.ts
 * WHAT: Unit tests for /stats activity command handler.
 * WHY: Verify activity heatmap generation, permission checks, and error handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockInteraction } from "../../utils/discordMocks.js";
import { createTestCommandContext } from "../../utils/contextFactory.js";
import type { ChatInputCommandInteraction } from "discord.js";

// Hoisted mocks
const { mockFetchActivityData, mockGenerateHeatmap, mockRequireMinRole, mockWithStep } = vi.hoisted(() => ({
  mockFetchActivityData: vi.fn(),
  mockGenerateHeatmap: vi.fn(),
  mockRequireMinRole: vi.fn(),
  mockWithStep: vi.fn(),
}));

// Mock shared module
vi.mock("../../../src/commands/stats/shared.js", async () => {
  const { EmbedBuilder, AttachmentBuilder } = await vi.importActual("discord.js");
  return {
    ChatInputCommandInteraction: {},
    EmbedBuilder,
    AttachmentBuilder,
    withStep: mockWithStep,
    requireMinRole: mockRequireMinRole,
    ROLE_IDS: {
      SENIOR_MOD: "role-senior-mod",
      GATEKEEPER: "role-gk",
      SENIOR_ADMIN: "role-sa",
    },
    classifyError: vi.fn((e) => e),
    userFriendlyMessage: vi.fn(() => "An error occurred"),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock("../../../src/lib/activityHeatmap.js", () => ({
  fetchActivityData: mockFetchActivityData,
  generateHeatmap: mockGenerateHeatmap,
}));

import { handleActivity } from "../../../src/commands/stats/activity.js";

describe("stats/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMinRole.mockReturnValue(true);
    mockWithStep.mockImplementation(async (_ctx, _phase, fn) => fn());
    mockFetchActivityData.mockResolvedValue({
      trends: {
        totalMessages: 1500,
        avgMessagesPerHour: 62.5,
        busiestHours: "6pm - 9pm",
        leastActiveHours: "3am - 6am",
        peakDays: ["Saturday", "Sunday"],
        quietestDays: ["Tuesday", "Wednesday"],
        weekOverWeekGrowth: 5.2,
      },
    });
    mockGenerateHeatmap.mockResolvedValue(Buffer.from("fake-png-data"));
  });

  describe("guild validation", () => {
    it("replies with error when used outside a guild", async () => {
      const interaction = createMockInteraction({ guildId: null } as any);
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
    });

    it("does not defer reply when guild is missing", async () => {
      const interaction = createMockInteraction({ guildId: null } as any);
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      expect(interaction.deferReply).not.toHaveBeenCalled();
    });
  });

  describe("permission checks", () => {
    it("calls requireMinRole with SENIOR_MOD role", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      expect(mockRequireMinRole).toHaveBeenCalledWith(
        interaction,
        "role-senior-mod",
        expect.objectContaining({
          command: "stats activity",
          description: "Views server activity heatmap with trends analysis.",
        })
      );
    });

    it("returns early when permission check fails", async () => {
      mockRequireMinRole.mockReturnValue(false);
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(mockFetchActivityData).not.toHaveBeenCalled();
    });
  });

  describe("options handling", () => {
    it("uses default weeks (1) when not provided", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { weeks: null } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      expect(mockFetchActivityData).toHaveBeenCalledWith("guild-123", 1);
    });

    it("uses provided weeks value", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { weeks: 4 } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      expect(mockFetchActivityData).toHaveBeenCalledWith("guild-123", 4);
    });
  });

  describe("successful execution", () => {
    it("defers reply publicly", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
    });

    it("calls fetchActivityData with correct parameters", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild-456",
        options: { getInteger: { weeks: 2 } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      expect(mockFetchActivityData).toHaveBeenCalledWith("test-guild-456", 2);
    });

    it("calls generateHeatmap with fetched data", async () => {
      const mockData = {
        trends: {
          totalMessages: 2000,
          avgMessagesPerHour: 83.3,
          busiestHours: "8pm - 11pm",
          leastActiveHours: "4am - 7am",
          peakDays: ["Friday"],
          quietestDays: ["Monday"],
        },
      };
      mockFetchActivityData.mockResolvedValue(mockData);
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      expect(mockGenerateHeatmap).toHaveBeenCalledWith(mockData);
    });

    it("replies with embed and attachment", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.any(Object)]),
          files: expect.arrayContaining([expect.any(Object)]),
        })
      );
    });

    it("embed contains correct title", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.title).toBe("Server Activity Report");
    });

    it("embed contains total messages field", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(
        expect.objectContaining({
          name: "Total Messages",
          value: "1,500",
        })
      );
    });

    it("embed contains average messages per hour field", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(
        expect.objectContaining({
          name: "Avg Messages per Hour",
          value: "62.5",
        })
      );
    });

    it("embed contains busiest hours field", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(
        expect.objectContaining({
          name: "Busiest Hours",
          value: "6pm - 9pm",
        })
      );
    });

    it("embed contains week-over-week growth when available", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      const wowField = fields.find((f: any) => f.name === "Week-over-Week");
      expect(wowField).toBeDefined();
      expect(wowField.value).toContain("+5.2%");
    });

    it("shows singular day text for 1 week", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { weeks: 1 } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.description).toContain("7 days");
    });

    it("shows plural weeks text for multiple weeks", async () => {
      const interaction = createMockInteraction({
        options: { getInteger: { weeks: 3 } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.description).toContain("3 weeks");
    });
  });

  describe("week-over-week growth formatting", () => {
    it("shows positive growth with + sign and up arrow", async () => {
      mockFetchActivityData.mockResolvedValue({
        trends: {
          totalMessages: 1000,
          avgMessagesPerHour: 41.6,
          busiestHours: "7pm",
          leastActiveHours: "4am",
          peakDays: ["Sat"],
          quietestDays: ["Mon"],
          weekOverWeekGrowth: 10.5,
        },
      });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      const wowField = fields.find((f: any) => f.name === "Week-over-Week");
      expect(wowField.value).toContain("+10.5%");
    });

    it("shows negative growth with down arrow", async () => {
      mockFetchActivityData.mockResolvedValue({
        trends: {
          totalMessages: 1000,
          avgMessagesPerHour: 41.6,
          busiestHours: "7pm",
          leastActiveHours: "4am",
          peakDays: ["Sat"],
          quietestDays: ["Mon"],
          weekOverWeekGrowth: -8.3,
        },
      });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      const wowField = fields.find((f: any) => f.name === "Week-over-Week");
      expect(wowField.value).toContain("-8.3%");
    });

    it("omits week-over-week field when undefined", async () => {
      mockFetchActivityData.mockResolvedValue({
        trends: {
          totalMessages: 1000,
          avgMessagesPerHour: 41.6,
          busiestHours: "7pm",
          leastActiveHours: "4am",
          peakDays: ["Sat"],
          quietestDays: ["Mon"],
          weekOverWeekGrowth: undefined,
        },
      });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      const wowField = fields.find((f: any) => f.name === "Week-over-Week");
      expect(wowField).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("logs error when heatmap generation fails", async () => {
      const error = new Error("Heatmap generation failed");
      mockFetchActivityData.mockRejectedValue(error);
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      const { logger } = await import("../../../src/commands/stats/shared.js");
      expect(logger.error).toHaveBeenCalled();
    });

    it("sends user-friendly error message", async () => {
      mockGenerateHeatmap.mockRejectedValue(new Error("Canvas error"));
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Error generating activity heatmap"),
      });
    });

    it("handles editReply failure gracefully", async () => {
      mockFetchActivityData.mockRejectedValue(new Error("DB error"));
      const interaction = createMockInteraction();
      (interaction.editReply as any).mockRejectedValue(new Error("Interaction expired"));
      const ctx = createTestCommandContext(interaction);

      // Should not throw
      await expect(handleActivity(ctx)).resolves.not.toThrow();
    });
  });

  describe("withStep instrumentation", () => {
    it("calls withStep for fetch_activity phase", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      expect(mockWithStep).toHaveBeenCalledWith(ctx, "fetch_activity", expect.any(Function));
    });

    it("calls withStep for generate_heatmap phase", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      expect(mockWithStep).toHaveBeenCalledWith(ctx, "generate_heatmap", expect.any(Function));
    });

    it("calls withStep for reply phase", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await handleActivity(ctx);

      expect(mockWithStep).toHaveBeenCalledWith(ctx, "reply", expect.any(Function));
    });
  });
});
