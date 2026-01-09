/**
 * Pawtropolis Tech — tests/commands/poke.test.ts
 * WHAT: Unit tests for /poke command (owner-only user ping across categories).
 * WHY: Verify owner check, channel filtering, and message sending.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi } from "vitest";
import { execute, data } from "../../src/commands/poke.js";
import { createTestCommandContext } from "../utils/contextFactory.js";
import { createMockInteraction, createMockGuild, createMockUser, createMockChannel } from "../utils/discordMocks.js";
import type { ChatInputCommandInteraction, Guild, TextChannel } from "discord.js";
import { ChannelType, MessageFlags } from "discord.js";

// Mock the logger
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the owner module
vi.mock("../../src/lib/owner.js", () => ({
  isOwner: vi.fn(() => false),
}));

// Mock the config module
vi.mock("../../src/lib/config.js", () => ({
  getConfig: vi.fn(() => null),
}));

/**
 * Creates a Collection-like Map with filter method for mocking guild.channels.fetch()
 */
function createMockCollection<T>(items: Map<string, T>) {
  return {
    size: items.size,
    filter: (fn: (value: T) => boolean) => {
      const result = new Map<string, T>();
      for (const [k, v] of items) {
        if (fn(v)) result.set(k, v);
      }
      return result;
    },
    [Symbol.iterator]: items[Symbol.iterator].bind(items),
    forEach: items.forEach.bind(items),
  };
}

describe("/poke command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("data (slash command builder)", () => {
    it("has correct name and description", () => {
      expect(data.name).toBe("poke");
      expect(data.description).toBe("Ping a user across multiple category channels (owner only)");
    });

    it("has required user option", () => {
      const json = data.toJSON();
      const userOption = json.options?.find((o: any) => o.name === "user");
      expect(userOption).toBeDefined();
      expect(userOption.required).toBe(true);
    });
  });

  describe("execute", () => {
    it("rejects when user is not an owner", async () => {
      const { isOwner } = await import("../../src/lib/owner.js");
      (isOwner as any).mockReturnValue(false);

      const targetUser = createMockUser({ id: "target-123" });
      const interaction = createMockInteraction({
        options: {
          getUser: { user: targetUser },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("only available to bot owners"),
        flags: MessageFlags.Ephemeral,
      });
    });

    it("throws error when used outside a guild", async () => {
      const { isOwner } = await import("../../src/lib/owner.js");
      (isOwner as any).mockReturnValue(true);

      const targetUser = createMockUser({ id: "target-123" });
      const interaction = createMockInteraction({
        guild: null as any,
        options: {
          getUser: { user: targetUser },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await expect(execute(ctx)).rejects.toThrow("guild");
    });

    it("sends pokes to channels in configured categories", async () => {
      const { isOwner } = await import("../../src/lib/owner.js");
      (isOwner as any).mockReturnValue(true);

      const { getConfig } = await import("../../src/lib/config.js");
      (getConfig as any).mockReturnValue({
        poke_category_ids_json: '["category-1"]',
        poke_excluded_channel_ids_json: '[]',
      });

      const targetUser = createMockUser({ id: "target-123", tag: "testuser#0" });

      // Create mock channels
      const channel1 = createMockChannel({ id: "channel-1", name: "staff-chat" });
      (channel1 as any).type = ChannelType.GuildText;
      (channel1 as any).parentId = "category-1";
      (channel1 as any).isTextBased = vi.fn().mockReturnValue(true);

      const channel2 = createMockChannel({ id: "channel-2", name: "mod-chat" });
      (channel2 as any).type = ChannelType.GuildText;
      (channel2 as any).parentId = "category-1";
      (channel2 as any).isTextBased = vi.fn().mockReturnValue(true);

      const guild = createMockGuild({ id: "guild-123" });
      const channelsMap = new Map([
        ["channel-1", channel1],
        ["channel-2", channel2],
      ]);
      (guild.channels.fetch as any).mockResolvedValue(createMockCollection(channelsMap));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { user: targetUser },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(channel1.send).toHaveBeenCalledWith(expect.stringContaining("target-123"));
      expect(channel2.send).toHaveBeenCalledWith(expect.stringContaining("target-123"));
      expect(interaction.editReply).toHaveBeenCalled();
    });

    it("excludes specified channels from pokes", async () => {
      const { isOwner } = await import("../../src/lib/owner.js");
      (isOwner as any).mockReturnValue(true);

      const { getConfig } = await import("../../src/lib/config.js");
      (getConfig as any).mockReturnValue({
        poke_category_ids_json: '["category-1"]',
        poke_excluded_channel_ids_json: '["channel-excluded"]',
      });

      const targetUser = createMockUser({ id: "target-123" });

      const channel1 = createMockChannel({ id: "channel-1" });
      (channel1 as any).type = ChannelType.GuildText;
      (channel1 as any).parentId = "category-1";
      (channel1 as any).isTextBased = vi.fn().mockReturnValue(true);

      const channelExcluded = createMockChannel({ id: "channel-excluded" });
      (channelExcluded as any).type = ChannelType.GuildText;
      (channelExcluded as any).parentId = "category-1";
      (channelExcluded as any).isTextBased = vi.fn().mockReturnValue(true);

      const guild = createMockGuild({ id: "guild-123" });
      const channelsMap = new Map<string, TextChannel>([
        ["channel-1", channel1],
        ["channel-excluded", channelExcluded],
      ]);
      (guild.channels.fetch as any).mockResolvedValue(createMockCollection(channelsMap));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { user: targetUser },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(channel1.send).toHaveBeenCalled();
      expect(channelExcluded.send).not.toHaveBeenCalled();
    });

    it("filters out non-text channels", async () => {
      const { isOwner } = await import("../../src/lib/owner.js");
      (isOwner as any).mockReturnValue(true);

      const { getConfig } = await import("../../src/lib/config.js");
      (getConfig as any).mockReturnValue({
        poke_category_ids_json: '["category-1"]',
        poke_excluded_channel_ids_json: '[]',
      });

      const targetUser = createMockUser({ id: "target-123" });

      const textChannel = createMockChannel({ id: "channel-text" });
      (textChannel as any).type = ChannelType.GuildText;
      (textChannel as any).parentId = "category-1";
      (textChannel as any).isTextBased = vi.fn().mockReturnValue(true);

      const voiceChannel = createMockChannel({ id: "channel-voice" });
      (voiceChannel as any).type = ChannelType.GuildVoice; // Voice channel
      (voiceChannel as any).parentId = "category-1";
      (voiceChannel as any).isTextBased = vi.fn().mockReturnValue(false);

      const guild = createMockGuild({ id: "guild-123" });
      const channelsMap = new Map<string, TextChannel>([
        ["channel-text", textChannel],
        ["channel-voice", voiceChannel as any],
      ]);
      (guild.channels.fetch as any).mockResolvedValue(createMockCollection(channelsMap));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { user: targetUser },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(textChannel.send).toHaveBeenCalled();
      expect(voiceChannel.send).not.toHaveBeenCalled();
    });

    it("handles channel send failures gracefully", async () => {
      const { isOwner } = await import("../../src/lib/owner.js");
      (isOwner as any).mockReturnValue(true);

      const { getConfig } = await import("../../src/lib/config.js");
      (getConfig as any).mockReturnValue({
        poke_category_ids_json: '["category-1"]',
        poke_excluded_channel_ids_json: '[]',
      });

      const targetUser = createMockUser({ id: "target-123", tag: "testuser#0" });

      const channel1 = createMockChannel({ id: "channel-1" });
      (channel1 as any).type = ChannelType.GuildText;
      (channel1 as any).parentId = "category-1";
      (channel1 as any).isTextBased = vi.fn().mockReturnValue(true);
      (channel1.send as any).mockRejectedValue(new Error("Missing permissions"));

      const channel2 = createMockChannel({ id: "channel-2" });
      (channel2 as any).type = ChannelType.GuildText;
      (channel2 as any).parentId = "category-1";
      (channel2 as any).isTextBased = vi.fn().mockReturnValue(true);

      const guild = createMockGuild({ id: "guild-123" });
      const channelsMap = new Map<string, TextChannel>([
        ["channel-1", channel1],
        ["channel-2", channel2],
      ]);
      (guild.channels.fetch as any).mockResolvedValue(createMockCollection(channelsMap));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { user: targetUser },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      // Should still complete and show results
      expect(interaction.editReply).toHaveBeenCalled();
      const editReplyCall = (interaction.editReply as any).mock.calls[0][0];
      const embed = editReplyCall.embeds[0].data ?? editReplyCall.embeds[0];
      // Should have warning color due to failed pokes
      expect(embed.color).toBe(0xfee75c);
    });

    it("uses fallback category IDs when no config is set", async () => {
      const { isOwner } = await import("../../src/lib/owner.js");
      (isOwner as any).mockReturnValue(true);

      const { getConfig } = await import("../../src/lib/config.js");
      (getConfig as any).mockReturnValue(null); // No config

      const targetUser = createMockUser({ id: "target-123", tag: "testuser#0" });

      const guild = createMockGuild({ id: "guild-123" });
      const channelsMap = new Map<string, TextChannel>(); // Empty
      (guild.channels.fetch as any).mockResolvedValue(createMockCollection(channelsMap));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { user: targetUser },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      // Should complete with 0 channels found
      expect(interaction.editReply).toHaveBeenCalled();
    });

    it("handles invalid JSON in config gracefully", async () => {
      const { isOwner } = await import("../../src/lib/owner.js");
      (isOwner as any).mockReturnValue(true);

      const { getConfig } = await import("../../src/lib/config.js");
      (getConfig as any).mockReturnValue({
        poke_category_ids_json: "invalid json",
        poke_excluded_channel_ids_json: "also invalid",
      });

      const targetUser = createMockUser({ id: "target-123", tag: "testuser#0" });

      const guild = createMockGuild({ id: "guild-123" });
      const channelsMap = new Map<string, TextChannel>();
      (guild.channels.fetch as any).mockResolvedValue(createMockCollection(channelsMap));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { user: targetUser },
        },
      });
      const ctx = createTestCommandContext(interaction);

      // Should not throw - falls back to defaults
      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalled();
    });

    it("shows successful poke count in results embed", async () => {
      const { isOwner } = await import("../../src/lib/owner.js");
      (isOwner as any).mockReturnValue(true);

      const { getConfig } = await import("../../src/lib/config.js");
      (getConfig as any).mockReturnValue({
        poke_category_ids_json: '["category-1"]',
        poke_excluded_channel_ids_json: '[]',
      });

      const targetUser = createMockUser({ id: "target-123", tag: "testuser#0" });

      const channel1 = createMockChannel({ id: "channel-1" });
      (channel1 as any).type = ChannelType.GuildText;
      (channel1 as any).parentId = "category-1";
      (channel1 as any).isTextBased = vi.fn().mockReturnValue(true);

      const guild = createMockGuild({ id: "guild-123" });
      const channelsMap = new Map<string, TextChannel>([["channel-1", channel1]]);
      (guild.channels.fetch as any).mockResolvedValue(createMockCollection(channelsMap));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { user: targetUser },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      const editReplyCall = (interaction.editReply as any).mock.calls[0][0];
      const embed = editReplyCall.embeds[0].data ?? editReplyCall.embeds[0];
      expect(embed.title).toBe("Poke Results");
      // Success color (green) when no failures
      expect(embed.color).toBe(0x57f287);
    });
  });
});
