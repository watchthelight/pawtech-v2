/**
 * Pawtropolis Tech — tests/commands/review/setNotifyConfig.test.ts
 * WHAT: Unit tests for /review-set-notify-config command.
 * WHY: Verify notification config updates and validation.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockInteraction, createMockGuild, createMockRole, createMockChannel } from "../../utils/discordMocks.js";
import { createTestCommandContext } from "../../utils/contextFactory.js";
import type { ChatInputCommandInteraction } from "discord.js";

// Hoisted mocks
const { mockGetNotifyConfig, mockSetNotifyConfig, mockRequireAdminOrLeadership, mockLogActionPretty, mockPrepare, mockRun } = vi.hoisted(() => ({
  mockGetNotifyConfig: vi.fn(),
  mockSetNotifyConfig: vi.fn(),
  mockRequireAdminOrLeadership: vi.fn(),
  mockLogActionPretty: vi.fn(),
  mockPrepare: vi.fn(),
  mockRun: vi.fn(),
}));

vi.mock("../../../src/features/notifyConfig.js", () => ({
  getNotifyConfig: mockGetNotifyConfig,
  setNotifyConfig: mockSetNotifyConfig,
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

import { execute, data } from "../../../src/commands/review/setNotifyConfig.js";

describe("review/setNotifyConfig", () => {
  const defaultConfig = {
    notify_mode: "post",
    notify_role_id: "role-123",
    forum_channel_id: "forum-456",
    notification_channel_id: null,
    notify_cooldown_seconds: 5,
    notify_max_per_hour: 10,
  };

  const mockRole = createMockRole({ id: "new-role-789", name: "Reviewers" });
  const mockForum = createMockChannel({ id: "new-forum-456", name: "applications" });
  const mockNotifChannel = createMockChannel({ id: "notif-channel-123", name: "notifications" });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminOrLeadership.mockResolvedValue(true);
    mockGetNotifyConfig.mockReturnValue(defaultConfig);
    mockSetNotifyConfig.mockReturnValue(undefined);
    mockPrepare.mockReturnValue({ run: mockRun });
    mockLogActionPretty.mockResolvedValue(undefined);
  });

  describe("data (slash command builder)", () => {
    it("has correct name", () => {
      expect(data.name).toBe("review-set-notify-config");
    });

    it("has correct description", () => {
      expect(data.description).toBe("Configure forum post notification settings (admin only)");
    });

    it("is not usable in DMs", () => {
      expect(data.dm_permission).toBe(false);
    });

    it("has mode option with choices", () => {
      const modeOption = data.options.find((opt: any) => opt.name === "mode");
      expect(modeOption).toBeDefined();
      expect(modeOption?.choices).toHaveLength(2);
    });

    it("has role option", () => {
      const roleOption = data.options.find((opt: any) => opt.name === "role");
      expect(roleOption).toBeDefined();
    });

    it("has forum option", () => {
      const forumOption = data.options.find((opt: any) => opt.name === "forum");
      expect(forumOption).toBeDefined();
    });

    it("has channel option", () => {
      const channelOption = data.options.find((opt: any) => opt.name === "channel");
      expect(channelOption).toBeDefined();
    });

    it("has cooldown option with min/max", () => {
      const cooldownOption = data.options.find((opt: any) => opt.name === "cooldown");
      expect(cooldownOption).toBeDefined();
      expect(cooldownOption?.min_value).toBe(1);
      expect(cooldownOption?.max_value).toBe(300);
    });

    it("has max_per_hour option with min/max", () => {
      const maxOption = data.options.find((opt: any) => opt.name === "max_per_hour");
      expect(maxOption).toBeDefined();
      expect(maxOption?.min_value).toBe(1);
      expect(maxOption?.max_value).toBe(100);
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
  });

  describe("authorization", () => {
    it("calls requireAdminOrLeadership", async () => {
      const interaction = createMockInteraction({
        options: { getString: { mode: "post" } },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockRequireAdminOrLeadership).toHaveBeenCalledWith(interaction);
    });

    it("replies with error when not authorized", async () => {
      mockRequireAdminOrLeadership.mockResolvedValue(false);
      const interaction = createMockInteraction({
        options: { getString: { mode: "post" } },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("must be a server administrator"),
        ephemeral: true,
      });
    });
  });

  describe("validation", () => {
    it("requires at least one option", async () => {
      const interaction = createMockInteraction({
        options: {
          getString: { mode: null },
          getRole: { role: null },
          getChannel: { forum: null, channel: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("at least one configuration option"),
      });
    });

    it("requires channel when mode=channel and no existing channel", async () => {
      mockGetNotifyConfig.mockReturnValue({ ...defaultConfig, notification_channel_id: null });
      const interaction = createMockInteraction({
        options: {
          getString: { mode: "channel" },
          getChannel: { channel: null, forum: null },
          getRole: { role: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("must specify a notification channel"),
      });
    });

    it("allows mode=channel when channel already configured", async () => {
      mockGetNotifyConfig.mockReturnValue({ ...defaultConfig, notification_channel_id: "existing-channel" });
      const interaction = createMockInteraction({
        options: {
          getString: { mode: "channel" },
          getChannel: { channel: null, forum: null },
          getRole: { role: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockSetNotifyConfig).toHaveBeenCalled();
    });

    it("allows mode=channel when channel provided", async () => {
      mockGetNotifyConfig.mockReturnValue({ ...defaultConfig, notification_channel_id: null });
      const interaction = createMockInteraction({
        options: {
          getString: { mode: "channel" },
          getChannel: { channel: mockNotifChannel, forum: null },
          getRole: { role: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockSetNotifyConfig).toHaveBeenCalled();
    });
  });

  describe("successful execution", () => {
    it("defers reply ephemerally", async () => {
      const interaction = createMockInteraction({
        options: {
          getString: { mode: "post" },
          getRole: { role: null },
          getChannel: { forum: null, channel: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it("calls setNotifyConfig with mode update", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild",
        options: {
          getString: { mode: "channel" },
          getChannel: { channel: mockNotifChannel, forum: null },
          getRole: { role: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockSetNotifyConfig).toHaveBeenCalledWith(
        "test-guild",
        expect.objectContaining({ notify_mode: "channel", notification_channel_id: "notif-channel-123" })
      );
    });

    it("calls setNotifyConfig with role update", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild",
        options: {
          getString: { mode: null },
          getRole: { role: mockRole },
          getChannel: { forum: null, channel: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockSetNotifyConfig).toHaveBeenCalledWith(
        "test-guild",
        expect.objectContaining({ notify_role_id: "new-role-789" })
      );
    });

    it("calls setNotifyConfig with forum update", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild",
        options: {
          getString: { mode: null },
          getRole: { role: null },
          getChannel: { forum: mockForum, channel: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockSetNotifyConfig).toHaveBeenCalledWith(
        "test-guild",
        expect.objectContaining({ forum_channel_id: "new-forum-456" })
      );
    });

    it("calls setNotifyConfig with cooldown update", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild",
        options: {
          getString: { mode: null },
          getRole: { role: null },
          getChannel: { forum: null, channel: null },
          getInteger: { cooldown: 30, max_per_hour: null },
        },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockSetNotifyConfig).toHaveBeenCalledWith(
        "test-guild",
        expect.objectContaining({ notify_cooldown_seconds: 30 })
      );
    });

    it("calls setNotifyConfig with max_per_hour update", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild",
        options: {
          getString: { mode: null },
          getRole: { role: null },
          getChannel: { forum: null, channel: null },
          getInteger: { cooldown: null, max_per_hour: 25 },
        },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockSetNotifyConfig).toHaveBeenCalledWith(
        "test-guild",
        expect.objectContaining({ notify_max_per_hour: 25 })
      );
    });

    it("replies with success summary", async () => {
      const interaction = createMockInteraction({
        options: {
          getString: { mode: "post" },
          getRole: { role: null },
          getChannel: { forum: null, channel: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.content).toContain("config updated");
      expect(call.content).toContain("Mode:");
    });

    it("includes role mention in summary", async () => {
      mockGetNotifyConfig
        .mockReturnValueOnce(defaultConfig)
        .mockReturnValueOnce({ ...defaultConfig, notify_role_id: "new-role-789" });
      const interaction = createMockInteraction({
        options: {
          getString: { mode: null },
          getRole: { role: mockRole },
          getChannel: { forum: null, channel: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.content).toContain("<@&new-role-789>");
    });
  });

  describe("logging", () => {
    it("logs action to pretty logger", async () => {
      const mockGuild = createMockGuild();
      const interaction = createMockInteraction({
        guild: mockGuild,
        user: { id: "admin-123" },
        options: {
          getString: { mode: "post" },
          getRole: { role: null },
          getChannel: { forum: null, channel: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockLogActionPretty).toHaveBeenCalledWith(
        mockGuild,
        expect.objectContaining({
          actorId: "admin-123",
          action: "forum_post_ping",
          reason: "Updated forum post notification configuration",
        })
      );
    });

    it("includes old and new config in log meta", async () => {
      const mockGuild = createMockGuild();
      const newConfig = { ...defaultConfig, notify_mode: "channel" };
      mockGetNotifyConfig
        .mockReturnValueOnce(defaultConfig)
        .mockReturnValueOnce(newConfig);
      const interaction = createMockInteraction({
        guild: mockGuild,
        options: {
          getString: { mode: "channel" },
          getChannel: { channel: mockNotifChannel, forum: null },
          getRole: { role: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockLogActionPretty).toHaveBeenCalledWith(
        mockGuild,
        expect.objectContaining({
          meta: expect.objectContaining({
            old_config: defaultConfig,
            new_config: newConfig,
            updated_fields: expect.arrayContaining(["notify_mode"]),
          }),
        })
      );
    });

    it("inserts action_log entry", async () => {
      const interaction = createMockInteraction({
        guildId: "guild-789",
        user: { id: "user-456" },
        options: {
          getString: { mode: "post" },
          getRole: { role: null },
          getChannel: { forum: null, channel: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalledWith(
        "guild-789",
        "user-456",
        "forum_post_ping",
        "Updated forum post notification configuration",
        expect.any(String),
        expect.any(Number)
      );
    });

    it("logs info message", async () => {
      const interaction = createMockInteraction({
        guildId: "guild-abc",
        user: { id: "user-def" },
        options: {
          getString: { mode: "post" },
          getRole: { role: null },
          getChannel: { forum: null, channel: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const { logger } = await import("../../../src/lib/logger.js");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "guild-abc",
          userId: "user-def",
        }),
        "[setNotifyConfig] config updated by admin"
      );
    });
  });

  describe("error handling", () => {
    it("logs error when update fails", async () => {
      mockSetNotifyConfig.mockImplementation(() => {
        throw new Error("Database error");
      });
      const interaction = createMockInteraction({
        options: {
          getString: { mode: "post" },
          getRole: { role: null },
          getChannel: { forum: null, channel: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const { logger } = await import("../../../src/lib/logger.js");
      expect(logger.error).toHaveBeenCalled();
    });

    it("sends error message to user", async () => {
      mockSetNotifyConfig.mockImplementation(() => {
        throw new Error("Update failed");
      });
      const interaction = createMockInteraction({
        options: {
          getString: { mode: "post" },
          getRole: { role: null },
          getChannel: { forum: null, channel: null },
          getInteger: { cooldown: null, max_per_hour: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to update notification config"),
      });
    });
  });

  describe("partial updates", () => {
    it("only includes explicitly provided fields", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild",
        options: {
          getString: { mode: null },
          getRole: { role: null },
          getChannel: { forum: null, channel: null },
          getInteger: { cooldown: 15, max_per_hour: null },
        },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const setCall = mockSetNotifyConfig.mock.calls[0];
      expect(setCall[1]).toEqual({ notify_cooldown_seconds: 15 });
    });

    it("handles multiple fields at once", async () => {
      const interaction = createMockInteraction({
        guildId: "test-guild",
        options: {
          getString: { mode: "post" },
          getRole: { role: mockRole },
          getChannel: { forum: mockForum, channel: null },
          getInteger: { cooldown: 10, max_per_hour: 20 },
        },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const setCall = mockSetNotifyConfig.mock.calls[0];
      expect(setCall[1]).toEqual({
        notify_mode: "post",
        notify_role_id: "new-role-789",
        forum_channel_id: "new-forum-456",
        notify_cooldown_seconds: 10,
        notify_max_per_hour: 20,
      });
    });
  });
});
