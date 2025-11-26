// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Welcome Message Tests
 *
 * Verifies the welcome message flow when new members join a guild.
 * These tests cover:
 * - Successful welcome embed delivery with proper Discord formatting
 * - Permission checks before attempting to send messages
 * - Structured logging for observability
 *
 * Mock Setup Notes:
 * - guild.channels.fetch returns a mocked channel with permission checks
 * - guild.emojis mocked to return undefined (simulates no custom emojis)
 * - client.user provides the bot's avatar URL for embed author icon
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { ChannelType } from "discord.js";
import { postWelcomeMessage, logWelcomeFailure } from "../../src/features/review.js";
import { logger } from "../../src/lib/logger.js";

describe("postWelcomeMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Happy path: full mock of Discord objects to verify embed structure.
  // The channel.send mock captures the payload for inspection.
  it("sends default welcome embed with mention and structured logs", async () => {
    const send = vi.fn().mockResolvedValue({ id: "msg-123" });
    const permissions = { has: vi.fn().mockReturnValue(true) };
    const channel = {
      send,
      permissionsFor: vi.fn().mockReturnValue(permissions),
      isTextBased: () => true,
      type: ChannelType.GuildText,
    } as unknown as any;
    const guild = {
      id: "guild-1",
      name: "Pawtropolis",
      memberCount: 42,
      channels: { fetch: vi.fn().mockResolvedValue(channel) },
      members: { me: { id: "bot-1" } },
      emojis: {
        fetch: vi.fn().mockResolvedValue(undefined),
        cache: { find: vi.fn(() => undefined) },
      },
      client: {
        user: { displayAvatarURL: vi.fn().mockReturnValue("https://cdn.discordapp.com/bot.png") },
      },
    } as unknown as any;

    // Member mock includes displayAvatarURL for the embed thumbnail
    const member = {
      id: "user-123",
      displayName: "Watcher",
      displayAvatarURL: vi.fn().mockReturnValue("https://cdn.discordapp.com/avatar.png"),
      user: { tag: "Watcher#0001", username: "Watcher" },
    } as unknown as any;

    // Spy on logger to verify structured logging format (important for log aggregation)
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined as any);
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => undefined as any);

    const result = await postWelcomeMessage({
      guild,
      generalChannelId: "general-1",
      member,
      template: null,
    });

    expect(result).toEqual({ ok: true, messageId: "msg-123" });
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    // allowedMentions restricts pings to only the new member, preventing @everyone abuse
    expect(payload.content).toBe("<@user-123>");
    expect(payload.allowedMentions).toEqual({ users: ["user-123"] });
    expect(payload.embeds).toHaveLength(1);

    const embedJson = payload.embeds[0].toJSON();
    expect(embedJson.title).toBe("Welcome to Pawtropolis 🐾");
    expect(embedJson.author?.name).toBe("Paw Guardian (Pawtropolis)");
    expect(embedJson.author?.icon_url).toBe("https://cdn.discordapp.com/bot.png");
    expect(embedJson.footer?.text).toBe("Bot by watchthelight.");
    expect(embedJson.thumbnail?.url).toBe("https://cdn.discordapp.com/avatar.png");
    expect(embedJson.description).toContain("👋");
    expect(embedJson.description).toContain("Users");
    expect(embedJson.description).toContain("Enjoy your stay!");

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: "guild-1",
        channelId: "general-1",
        userId: "user-123",
        messageId: "msg-123",
      }),
      "[welcome] posted"
    );
    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: "guild-1",
        channelId: "general-1",
        userId: "user-123",
        embeds: [
          expect.objectContaining({
            title: "Welcome to Pawtropolis 🐾",
            footer: { text: "Bot by watchthelight." },
          }),
        ],
      }),
      "[welcome] embed snapshot"
    );
  });

  // Critical edge case: bot lacks SEND_MESSAGES permission.
  // The function should detect this BEFORE attempting to send, avoiding
  // a DiscordAPIError[50013] that would spam error logs.
  it("returns missing_permissions when channel denies messages", async () => {
    const send = vi.fn();
    const permissions = { has: vi.fn().mockReturnValue(false) };
    const channel = {
      send,
      permissionsFor: vi.fn().mockReturnValue(permissions),
      isTextBased: () => true,
      type: ChannelType.GuildText,
    } as unknown as any;
    const guild = {
      id: "guild-2",
      name: "Pawtropolis",
      memberCount: 10,
      channels: { fetch: vi.fn().mockResolvedValue(channel) },
      members: { me: { id: "bot-2" } },
      emojis: {
        fetch: vi.fn().mockResolvedValue(undefined),
        cache: { find: vi.fn(() => undefined) },
      },
      client: { user: null },
    } as unknown as any;

    const member = {
      id: "user-999",
      displayName: "Scout",
      displayAvatarURL: vi.fn().mockReturnValue("https://cdn.discordapp.com/avatar2.png"),
      user: { tag: "Scout#1000", username: "Scout" },
    } as unknown as any;

    const result = await postWelcomeMessage({
      guild,
      generalChannelId: "general-2",
      member,
      template: null,
    });

    expect(result).toEqual({ ok: false, reason: "missing_permissions" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("logWelcomeFailure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Verifies structured error logging with Discord-specific error codes.
  // Code 50013 = Missing Permissions - a common issue when bot roles change.
  it("logs warning payload with code and message", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as any);
    // Simulating a real DiscordAPIError with numeric code property
    const error = new Error("Missing Access") as Error & { code: number };
    error.name = "DiscordAPIError";
    error.code = 50013;

    logWelcomeFailure("missing_permissions", {
      guildId: "guild-1",
      channelId: "general-1",
      error,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: "guild-1",
        channelId: "general-1",
        code: 50013,
        message: "Missing Access",
        errorName: "DiscordAPIError",
      }),
      "[welcome] missing permission to send welcome message"
    );
  });
});
