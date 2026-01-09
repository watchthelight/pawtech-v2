/**
 * Pawtropolis Tech — tests/commands/review/getNotifyConfig.test.ts
 * WHAT: Unit tests for /review-get-notify-config command.
 * WHY: Verify notification config display and authorization.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockInteraction, createMockGuild } from "../../utils/discordMocks.js";
import { createTestCommandContext } from "../../utils/contextFactory.js";
import type { ChatInputCommandInteraction, PermissionFlagsBits as PFB } from "discord.js";

// Hoisted mocks
const { mockGetNotifyConfig, mockRequireAdminOrLeadership, mockLogActionPretty, mockPrepare, mockRun } = vi.hoisted(() => ({
  mockGetNotifyConfig: vi.fn(),
  mockRequireAdminOrLeadership: vi.fn(),
  mockLogActionPretty: vi.fn(),
  mockPrepare: vi.fn(),
  mockRun: vi.fn(),
}));

vi.mock("../../../src/features/notifyConfig.js", () => ({
  getNotifyConfig: mockGetNotifyConfig,
}));

vi.mock("../../../src/lib/config.js", () => ({
  requireAdminOrLeadership: mockRequireAdminOrLeadership,
}));

vi.mock("../../../src/logging/pretty.js", () => ({
  logActionPretty: mockLogActionPretty,
}));

vi.mock("../../../src/db/db.js", () => ({
  db: { prepare: mockPrepare },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { execute, data } from "../../../src/commands/review/getNotifyConfig.js";

describe("review/getNotifyConfig", () => {
  const defaultConfig = {
    notify_mode: "post",
    notify_role_id: "role-123",
    forum_channel_id: "forum-456",
    notification_channel_id: null,
    notify_cooldown_seconds: 5,
    notify_max_per_hour: 10,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminOrLeadership.mockResolvedValue(true);
    mockGetNotifyConfig.mockReturnValue(defaultConfig);
    mockPrepare.mockReturnValue({ run: mockRun });
    mockLogActionPretty.mockResolvedValue(undefined);
  });

  describe("data (slash command builder)", () => {
    it("has correct name", () => {
      expect(data.name).toBe("review-get-notify-config");
    });

    it("has correct description", () => {
      expect(data.description).toBe("View current forum post notification settings (admin only)");
    });

    it("is not usable in DMs", () => {
      expect(data.dm_permission).toBe(false);
    });

    it("requires Administrator permission by default", () => {
      expect(data.default_member_permissions).toBeDefined();
    });
  });

  describe("guild validation", () => {
    it("replies with error when used outside a guild", async () => {
      const interaction = createMockInteraction({ guildId: null } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("only be used in a server"),
        ephemeral: true,
      });
    });

    it("does not defer reply when guild is missing", async () => {
      const interaction = createMockInteraction({ guildId: null } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.deferReply).not.toHaveBeenCalled();
    });
  });

  describe("authorization", () => {
    it("calls requireAdminOrLeadership", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockRequireAdminOrLeadership).toHaveBeenCalledWith(interaction);
    });

    it("replies with error when not authorized", async () => {
      mockRequireAdminOrLeadership.mockResolvedValue(false);
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("must be a server administrator"),
        ephemeral: true,
      });
    });

    it("does not fetch config when not authorized", async () => {
      mockRequireAdminOrLeadership.mockResolvedValue(false);
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockGetNotifyConfig).not.toHaveBeenCalled();
    });
  });

  describe("successful execution", () => {
    it("defers reply ephemerally", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it("calls getNotifyConfig with guildId", async () => {
      const interaction = createMockInteraction({ guildId: "test-guild-123" } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockGetNotifyConfig).toHaveBeenCalledWith("test-guild-123");
    });

    it("replies with embed containing config", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.any(Object)]),
        })
      );
    });

    it("embed contains correct title", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.title).toContain("Forum Post Notification Configuration");
    });

    it("embed shows mode field", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(
        expect.objectContaining({ name: "Mode" })
      );
    });

    it("shows In-thread for post mode", async () => {
      mockGetNotifyConfig.mockReturnValue({ ...defaultConfig, notify_mode: "post" });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const modeField = call.embeds[0].data.fields.find((f: any) => f.name === "Mode");
      expect(modeField.value).toContain("In-thread");
    });

    it("shows Separate channel for channel mode", async () => {
      mockGetNotifyConfig.mockReturnValue({ ...defaultConfig, notify_mode: "channel" });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const modeField = call.embeds[0].data.fields.find((f: any) => f.name === "Mode");
      expect(modeField.value).toContain("Separate channel");
    });

    it("shows enabled status when role configured", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const statusField = call.embeds[0].data.fields.find((f: any) => f.name === "Status");
      expect(statusField.value).toContain("Enabled");
    });

    it("shows not configured status when no role", async () => {
      mockGetNotifyConfig.mockReturnValue({ ...defaultConfig, notify_role_id: null });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const statusField = call.embeds[0].data.fields.find((f: any) => f.name === "Status");
      expect(statusField.value).toContain("Not configured");
    });

    it("shows role mention when configured", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const roleField = call.embeds[0].data.fields.find((f: any) => f.name === "Role");
      expect(roleField.value).toContain("<@&role-123>");
    });

    it("shows not set for role when null", async () => {
      mockGetNotifyConfig.mockReturnValue({ ...defaultConfig, notify_role_id: null });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const roleField = call.embeds[0].data.fields.find((f: any) => f.name === "Role");
      expect(roleField.value).toContain("Not set");
    });

    it("shows forum channel when configured", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const forumField = call.embeds[0].data.fields.find((f: any) => f.name === "Forum Channel");
      expect(forumField.value).toContain("<#forum-456>");
    });

    it("shows all forums when no specific forum", async () => {
      mockGetNotifyConfig.mockReturnValue({ ...defaultConfig, forum_channel_id: null });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const forumField = call.embeds[0].data.fields.find((f: any) => f.name === "Forum Channel");
      expect(forumField.value).toContain("All forums");
    });

    it("shows rate limits", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const rateLimitsField = call.embeds[0].data.fields.find((f: any) => f.name === "Rate Limits");
      expect(rateLimitsField.value).toContain("5s");
      expect(rateLimitsField.value).toContain("10");
    });

    it("includes footer with set command hint", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.footer.text).toContain("/review-set-notify-config");
    });
  });

  describe("logging", () => {
    it("logs action to pretty logger", async () => {
      const mockGuild = createMockGuild();
      const interaction = createMockInteraction({
        guild: mockGuild,
        user: { id: "admin-123" },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockLogActionPretty).toHaveBeenCalledWith(
        mockGuild,
        expect.objectContaining({
          actorId: "admin-123",
          action: "forum_post_ping",
          reason: "Viewed forum post notification configuration",
        })
      );
    });

    it("inserts action_log entry", async () => {
      const interaction = createMockInteraction({
        guildId: "guild-789",
        user: { id: "user-456" },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalledWith(
        "guild-789",
        "user-456",
        "forum_post_ping",
        "Viewed forum post notification configuration",
        expect.any(String),
        expect.any(Number)
      );
    });

    it("logs info message", async () => {
      const interaction = createMockInteraction({
        guildId: "guild-abc",
        user: { id: "user-def" },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const { logger } = await import("../../../src/lib/logger.js");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "guild-abc",
          userId: "user-def",
        }),
        "[getNotifyConfig] config viewed by admin"
      );
    });
  });

  describe("error handling", () => {
    it("logs error when config fetch fails", async () => {
      mockGetNotifyConfig.mockImplementation(() => {
        throw new Error("Database error");
      });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const { logger } = await import("../../../src/lib/logger.js");
      expect(logger.error).toHaveBeenCalled();
    });

    it("sends error message to user", async () => {
      mockGetNotifyConfig.mockImplementation(() => {
        throw new Error("Config error");
      });
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to retrieve notification config"),
      });
    });
  });

  describe("embed styling", () => {
    it("uses blurple color", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.color).toBe(0x5865f2);
    });

    it("includes timestamp", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.timestamp).toBeDefined();
    });

    it("all fields are inline", async () => {
      const interaction = createMockInteraction();
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      for (const field of fields) {
        expect(field.inline).toBe(true);
      }
    });
  });
});
