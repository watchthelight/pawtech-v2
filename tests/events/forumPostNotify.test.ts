/**
 * Pawtropolis Tech — tests/events/forumPostNotify.test.ts
 * WHAT: Unit tests for forum post notification handler.
 * WHY: Verify thread filtering, rate limiting, and notification sending.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelType } from "discord.js";

// Mock dependencies
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/features/notifyConfig.js", () => ({
  getNotifyConfig: vi.fn(),
}));

vi.mock("../../src/lib/notifyLimiter.js", () => ({
  notifyLimiter: {
    canNotify: vi.fn(),
    recordNotify: vi.fn(),
  },
}));

vi.mock("../../src/lib/constants.js", () => ({
  DISCORD_RETRY_DELAY_MS: 10, // Speed up tests
  SAFE_ALLOWED_MENTIONS: { parse: [] },
}));

import { forumPostNotify } from "../../src/events/forumPostNotify.js";
import { logger } from "../../src/lib/logger.js";
import { logActionPretty } from "../../src/logging/pretty.js";
import { getNotifyConfig } from "../../src/features/notifyConfig.js";
import { notifyLimiter } from "../../src/lib/notifyLimiter.js";

const mockGetNotifyConfig = getNotifyConfig as ReturnType<typeof vi.fn>;
const mockCanNotify = notifyLimiter.canNotify as ReturnType<typeof vi.fn>;
const mockRecordNotify = notifyLimiter.recordNotify as ReturnType<typeof vi.fn>;
const mockLogActionPretty = logActionPretty as ReturnType<typeof vi.fn>;

function createMockThread(overrides: Record<string, unknown> = {}) {
  return {
    id: "thread123",
    guildId: "guild456",
    parentId: "forum789",
    name: "Test Thread",
    parent: {
      type: ChannelType.GuildForum,
    },
    guild: { id: "guild456" },
    client: {
      channels: {
        fetch: vi.fn(),
      },
    },
    fetchStarterMessage: vi.fn().mockResolvedValue({
      id: "msg123",
      author: { id: "user789", bot: false },
    }),
    send: vi.fn().mockResolvedValue({ id: "sent123" }),
    ...overrides,
  };
}

describe("forumPostNotify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNotifyConfig.mockReturnValue({
      notify_role_id: "role123",
      forum_channel_id: "forum789",
      notify_mode: "post",
    });
    mockCanNotify.mockReturnValue({ ok: true });
  });

  describe("channel filtering", () => {
    it("skips non-forum channels", async () => {
      const thread = createMockThread({
        parent: { type: ChannelType.GuildText },
      });

      await forumPostNotify(thread as any);

      expect(mockGetNotifyConfig).not.toHaveBeenCalled();
    });

    it("processes GuildForum channels", async () => {
      const thread = createMockThread();

      await forumPostNotify(thread as any);

      expect(mockGetNotifyConfig).toHaveBeenCalledWith("guild456");
    });

    it("processes GuildMedia channels", async () => {
      const thread = createMockThread({
        parent: { type: ChannelType.GuildMedia },
      });

      await forumPostNotify(thread as any);

      expect(mockGetNotifyConfig).toHaveBeenCalledWith("guild456");
    });

    it("skips when parent is null", async () => {
      const thread = createMockThread({ parent: null });

      await forumPostNotify(thread as any);

      expect(mockGetNotifyConfig).not.toHaveBeenCalled();
    });

    it("skips when guildId is missing", async () => {
      const thread = createMockThread({ guildId: null });

      await forumPostNotify(thread as any);

      expect(thread.fetchStarterMessage).not.toHaveBeenCalled();
    });
  });

  describe("config checks", () => {
    it("skips when notify_role_id is not configured", async () => {
      mockGetNotifyConfig.mockReturnValue({ notify_role_id: null });
      const thread = createMockThread();

      await forumPostNotify(thread as any);

      expect(thread.fetchStarterMessage).not.toHaveBeenCalled();
    });

    it("skips when forum_channel_id is set but does not match", async () => {
      mockGetNotifyConfig.mockReturnValue({
        notify_role_id: "role123",
        forum_channel_id: "other-forum",
      });
      const thread = createMockThread();

      await forumPostNotify(thread as any);

      expect(thread.fetchStarterMessage).not.toHaveBeenCalled();
    });

    it("processes when forum_channel_id is not set (all forums allowed)", async () => {
      mockGetNotifyConfig.mockReturnValue({
        notify_role_id: "role123",
        forum_channel_id: null,
      });
      const thread = createMockThread();

      await forumPostNotify(thread as any);

      expect(thread.fetchStarterMessage).toHaveBeenCalled();
    });
  });

  describe("starter message handling", () => {
    it("fetches starter message", async () => {
      const thread = createMockThread();

      await forumPostNotify(thread as any);

      expect(thread.fetchStarterMessage).toHaveBeenCalled();
    });

    it("retries on 10008 error (message not ready)", async () => {
      const thread = createMockThread();
      const error10008 = { code: 10008 };
      thread.fetchStarterMessage
        .mockRejectedValueOnce(error10008)
        .mockResolvedValueOnce({ id: "msg123", author: { bot: false } });

      await forumPostNotify(thread as any);

      expect(thread.fetchStarterMessage).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: "thread123" }),
        expect.stringContaining("not ready")
      );
    });

    it("logs warning on retry failure", async () => {
      const thread = createMockThread();
      const error10008 = { code: 10008 };
      thread.fetchStarterMessage.mockRejectedValue(error10008);

      await forumPostNotify(thread as any);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: "thread123" }),
        expect.stringContaining("after retry")
      );
    });

    it("logs warning on non-10008 error", async () => {
      const thread = createMockThread();
      thread.fetchStarterMessage.mockRejectedValue({ code: 50001, message: "Missing access" });

      await forumPostNotify(thread as any);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: "thread123" }),
        expect.stringContaining("failed to fetch")
      );
    });

    it("skips bot-authored posts", async () => {
      const thread = createMockThread();
      thread.fetchStarterMessage.mockResolvedValue({
        id: "msg123",
        author: { id: "bot789", bot: true },
      });

      await forumPostNotify(thread as any);

      expect(mockCanNotify).not.toHaveBeenCalled();
    });

    it("skips when starter message is null", async () => {
      const thread = createMockThread();
      thread.fetchStarterMessage.mockResolvedValue(null);

      await forumPostNotify(thread as any);

      expect(mockCanNotify).not.toHaveBeenCalled();
    });
  });

  describe("rate limiting", () => {
    it("checks rate limit before sending", async () => {
      const thread = createMockThread();

      await forumPostNotify(thread as any);

      expect(mockCanNotify).toHaveBeenCalledWith("guild456", expect.any(Object));
    });

    it("skips and logs when rate limited", async () => {
      mockCanNotify.mockReturnValue({ ok: false, reason: "cooldown_active" });
      const thread = createMockThread();

      await forumPostNotify(thread as any);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "cooldown_active" }),
        expect.stringContaining("rate limit")
      );
      expect(thread.send).not.toHaveBeenCalled();
    });

    it("logs rate limit failure to action log", async () => {
      mockCanNotify.mockReturnValue({ ok: false, reason: "hourly_cap" });
      const thread = createMockThread();

      await forumPostNotify(thread as any);

      expect(mockLogActionPretty).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "forum_post_ping_fail",
          reason: "hourly_cap",
        })
      );
    });

    it("records notify on success", async () => {
      const thread = createMockThread();

      await forumPostNotify(thread as any);

      expect(mockRecordNotify).toHaveBeenCalledWith("guild456");
    });
  });

  describe("notification sending", () => {
    it("sends ping in thread by default (post mode)", async () => {
      const thread = createMockThread();

      await forumPostNotify(thread as any);

      expect(thread.send).toHaveBeenCalledWith({
        content: expect.stringContaining("<@&role123>"),
        allowedMentions: expect.objectContaining({ roles: ["role123"] }),
      });
    });

    it("includes thread URL in message", async () => {
      const thread = createMockThread();

      await forumPostNotify(thread as any);

      expect(thread.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("discord.com/channels/guild456/thread123"),
        })
      );
    });

    it("sends to notification channel when mode is channel", async () => {
      mockGetNotifyConfig.mockReturnValue({
        notify_role_id: "role123",
        forum_channel_id: "forum789",
        notify_mode: "channel",
        notification_channel_id: "notify-channel",
      });

      const mockNotifyChannel = {
        id: "notify-channel",
        isTextBased: () => true,
        send: vi.fn().mockResolvedValue({ id: "sent123" }),
      };

      const thread = createMockThread();
      thread.client.channels.fetch.mockResolvedValue(mockNotifyChannel);

      await forumPostNotify(thread as any);

      expect(mockNotifyChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("<@&role123>"),
        })
      );
    });

    it("falls back to thread if notification channel fetch fails", async () => {
      mockGetNotifyConfig.mockReturnValue({
        notify_role_id: "role123",
        forum_channel_id: "forum789",
        notify_mode: "channel",
        notification_channel_id: "notify-channel",
      });

      const thread = createMockThread();
      thread.client.channels.fetch.mockRejectedValue(new Error("Channel not found"));

      await forumPostNotify(thread as any);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: "notify-channel" }),
        expect.stringContaining("fallback")
      );
      expect(thread.send).toHaveBeenCalled();
    });

    it("logs success after sending ping", async () => {
      const thread = createMockThread();

      await forumPostNotify(thread as any);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ guildId: "guild456", threadId: "thread123", roleId: "role123" }),
        expect.stringContaining("ping sent")
      );
    });

    it("logs to action log on success", async () => {
      const thread = createMockThread();

      await forumPostNotify(thread as any);

      expect(mockLogActionPretty).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "forum_post_ping",
        })
      );
    });
  });

  describe("error handling", () => {
    it("logs error on send failure", async () => {
      const thread = createMockThread();
      thread.send.mockRejectedValue({ code: 50013, message: "Missing Permissions" });

      await forumPostNotify(thread as any);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ guildId: "guild456", threadId: "thread123" }),
        expect.stringContaining("failed to send")
      );
    });

    it("detects missing_permissions failure", async () => {
      const thread = createMockThread();
      thread.send.mockRejectedValue({ code: 50013 });

      await forumPostNotify(thread as any);

      expect(mockLogActionPretty).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "forum_post_ping_fail",
          reason: expect.stringContaining("missing_permissions"),
        })
      );
    });

    it("detects role_not_mentionable failure", async () => {
      const thread = createMockThread();
      thread.send.mockRejectedValue({ message: "Role is not mentionable" });

      await forumPostNotify(thread as any);

      expect(mockLogActionPretty).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "forum_post_ping_fail",
          reason: expect.stringContaining("role_not_mentionable"),
        })
      );
    });

    it("sends fallback message when role is not mentionable", async () => {
      const thread = createMockThread();
      thread.send
        .mockRejectedValueOnce({ message: "Role is not mentionable" })
        .mockResolvedValueOnce({ id: "fallback123" });

      await forumPostNotify(thread as any);

      // Should try to send fallback
      expect(thread.send).toHaveBeenCalledTimes(2);
      expect(thread.send).toHaveBeenLastCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("not mentionable"),
        })
      );
    });

    it("handles unexpected errors gracefully", async () => {
      // Simulate an error that bypasses all inner try-catches
      // by having getNotifyConfig throw unexpectedly
      mockGetNotifyConfig.mockImplementation(() => {
        throw new Error("Unexpected crash");
      });
      const thread = createMockThread();

      // Should not throw
      await expect(forumPostNotify(thread as any)).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: "thread123" }),
        expect.stringContaining("unexpected")
      );
    });
  });
});
