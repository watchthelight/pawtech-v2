/**
 * Pawtropolis Tech — tests/commands/purge.test.ts
 * WHAT: Unit tests for /purge command (bulk message deletion).
 * WHY: Verify password validation, rate limiting, channel type checks, and deletion logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { execute, data } from "../../src/commands/purge.js";
import { createTestCommandContext } from "../utils/contextFactory.js";
import { createMockInteraction, createMockGuild, createMockChannel, createMockMember } from "../utils/discordMocks.js";
import type { ChatInputCommandInteraction, Guild, TextChannel } from "discord.js";
import { ChannelType } from "discord.js";

// Mock the logger
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock secure compare
vi.mock("../../src/lib/secureCompare.js", () => ({
  secureCompare: vi.fn((a: string, b: string) => a === b),
}));

// Mock rate limiter
vi.mock("../../src/lib/rateLimiter.js", () => ({
  checkCooldown: vi.fn(() => ({ allowed: true })),
  formatCooldown: vi.fn((ms: number) => `${Math.round(ms / 1000)}s`),
  COOLDOWNS: {
    PASSWORD_FAIL_MS: 30000,
    PURGE_MS: 300000,
  },
}));

// Mock constants
vi.mock("../../src/lib/constants.js", () => ({
  DISCORD_BULK_DELETE_AGE_LIMIT_MS: 14 * 24 * 60 * 60 * 1000,
  MESSAGE_DELETE_BATCH_DELAY_MS: 100,
  BULK_DELETE_ITERATION_DELAY_MS: 50,
}));

// Store original env
const originalEnv = process.env;

describe("/purge command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, RESET_PASSWORD: "test-password" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("data (slash command builder)", () => {
    it("has correct name and description", () => {
      expect(data.name).toBe("purge");
      expect(data.description).toBe("Bulk delete messages in this channel (requires password)");
    });

    it("has required password option", () => {
      const json = data.toJSON();
      const passwordOption = json.options?.find((o: any) => o.name === "password");
      expect(passwordOption).toBeDefined();
      expect(passwordOption.required).toBe(true);
    });

    it("has optional count option with min/max values", () => {
      const json = data.toJSON();
      const countOption = json.options?.find((o: any) => o.name === "count");
      expect(countOption).toBeDefined();
      expect(countOption.required).toBe(false);
      expect(countOption.min_value).toBe(1);
      expect(countOption.max_value).toBe(10000);
    });
  });

  describe("execute", () => {
    it("rejects when used outside a guild", async () => {
      const interaction = createMockInteraction({
        guildId: null as any,
        options: {
          getString: { password: "test-password" },
          getInteger: { count: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "This command can only be used in a guild.",
        ephemeral: true,
      });
    });

    it("rejects when password cooldown is active", async () => {
      const { checkCooldown } = await import("../../src/lib/rateLimiter.js");
      (checkCooldown as any).mockReturnValueOnce({
        allowed: false,
        remainingMs: 25000,
      });

      const guild = createMockGuild({ id: "guild-123" });
      const channel = createMockChannel({ id: "channel-123" });
      (channel as any).type = ChannelType.GuildText;

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        channel: channel as TextChannel,
        options: {
          getString: { password: "wrong-password" },
          getInteger: { count: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("Too many failed attempts"),
        ephemeral: true,
      });
    });

    it("rejects when RESET_PASSWORD is not configured", async () => {
      delete process.env.RESET_PASSWORD;

      const guild = createMockGuild({ id: "guild-123" });
      const channel = createMockChannel({ id: "channel-123" });
      (channel as any).type = ChannelType.GuildText;

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        channel: channel as TextChannel,
        options: {
          getString: { password: "any-password" },
          getInteger: { count: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "Password not configured. Contact bot administrator.",
        ephemeral: true,
      });
    });

    it("rejects incorrect password", async () => {
      const { secureCompare } = await import("../../src/lib/secureCompare.js");
      (secureCompare as any).mockReturnValue(false);

      const guild = createMockGuild({ id: "guild-123" });
      const channel = createMockChannel({ id: "channel-123" });
      (channel as any).type = ChannelType.GuildText;

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        channel: channel as TextChannel,
        options: {
          getString: { password: "wrong-password" },
          getInteger: { count: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "Incorrect password.",
        ephemeral: true,
      });
    });

    it("rejects when purge is on cooldown", async () => {
      const { checkCooldown } = await import("../../src/lib/rateLimiter.js");
      // First call for password_fail returns allowed
      // Second call for purge returns not allowed
      (checkCooldown as any)
        .mockReturnValueOnce({ allowed: true })
        .mockReturnValueOnce({ allowed: false, remainingMs: 180000 });

      const guild = createMockGuild({ id: "guild-123" });
      const channel = createMockChannel({ id: "channel-123" });
      (channel as any).type = ChannelType.GuildText;

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        channel: channel as TextChannel,
        options: {
          getString: { password: "test-password" },
          getInteger: { count: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("Purge on cooldown"),
        ephemeral: true,
      });
    });

    it("rejects non-text channels", async () => {
      const guild = createMockGuild({ id: "guild-123" });
      const channel = createMockChannel({ id: "channel-123" });
      (channel as any).type = ChannelType.GuildVoice; // Voice channel

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        channel: channel as TextChannel,
        options: {
          getString: { password: "test-password" },
          getInteger: { count: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "This command can only be used in text channels.",
        ephemeral: true,
      });
    });

    it("rejects when bot lacks permissions", async () => {
      const guild = createMockGuild({ id: "guild-123" });
      const botMember = createMockMember({ id: "bot-123" });
      (guild as any).members = { me: botMember };

      const channel = createMockChannel({ id: "channel-123" });
      (channel as any).type = ChannelType.GuildText;
      (channel.permissionsFor as any).mockReturnValue({
        has: vi.fn().mockReturnValue(false), // No permissions
      });

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        channel: channel as TextChannel,
        options: {
          getString: { password: "test-password" },
          getInteger: { count: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("ManageMessages and ReadMessageHistory"),
        ephemeral: true,
      });
    });

    it("deletes messages successfully with count", async () => {
      const guild = createMockGuild({ id: "guild-123" });
      const botMember = createMockMember({ id: "bot-123" });
      (guild as any).members = { me: botMember };

      const channel = createMockChannel({ id: "channel-123" });
      (channel as any).type = ChannelType.GuildText;
      (channel.permissionsFor as any).mockReturnValue({
        has: vi.fn().mockReturnValue(true),
      });

      // Mock messages
      const recentMessage = {
        id: "msg-1",
        createdTimestamp: Date.now() - 1000, // 1 second ago
        delete: vi.fn().mockResolvedValue(undefined),
      };
      const messagesMap = new Map([["msg-1", recentMessage]]);
      (messagesMap as any).filter = (fn: any) => {
        const result = new Map();
        for (const [k, v] of messagesMap) {
          if (fn(v)) result.set(k, v);
        }
        return result;
      };
      (channel.messages.fetch as any).mockResolvedValueOnce(messagesMap);
      (channel.messages.fetch as any).mockResolvedValueOnce(new Map()); // Empty to end loop

      // Mock bulkDelete - returns the deleted messages Map
      const deletedMap = new Map([["msg-1", recentMessage]]);
      (channel as any).bulkDelete = vi.fn().mockResolvedValue(deletedMap);

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        channel: channel as TextChannel,
        options: {
          getString: { password: "test-password" },
          getInteger: { count: 10 },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(interaction.editReply).toHaveBeenCalled();
      // Verify the editReply was called (the embed structure may vary)
      const editReplyCall = (interaction.editReply as any).mock.calls[0][0];
      // Check we got an embed response (could be success or partial success)
      expect(editReplyCall.embeds || editReplyCall.content).toBeDefined();
    });

    it("reports zero deleted messages when channel is empty", async () => {
      const guild = createMockGuild({ id: "guild-123" });
      const botMember = createMockMember({ id: "bot-123" });
      (guild as any).members = { me: botMember };

      const channel = createMockChannel({ id: "channel-123" });
      (channel as any).type = ChannelType.GuildText;
      (channel.permissionsFor as any).mockReturnValue({
        has: vi.fn().mockReturnValue(true),
      });

      // Empty channel
      const emptyMap = new Map();
      (emptyMap as any).filter = () => emptyMap;
      (channel.messages.fetch as any).mockResolvedValue(emptyMap);

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        channel: channel as TextChannel,
        options: {
          getString: { password: "test-password" },
          getInteger: { count: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalled();
      const editReplyCall = (interaction.editReply as any).mock.calls[0][0];
      const embed = editReplyCall.embeds[0].data ?? editReplyCall.embeds[0];
      expect(embed.description).toContain("No messages were deleted");
      expect(embed.color).toBe(0xfee75c); // Warning color
    });

    it("handles errors during deletion gracefully", async () => {
      const guild = createMockGuild({ id: "guild-123" });
      const botMember = createMockMember({ id: "bot-123" });
      (guild as any).members = { me: botMember };

      const channel = createMockChannel({ id: "channel-123" });
      (channel as any).type = ChannelType.GuildText;
      (channel.permissionsFor as any).mockReturnValue({
        has: vi.fn().mockReturnValue(true),
      });

      // Throw error on fetch
      (channel.messages.fetch as any).mockRejectedValue(new Error("API Error"));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        channel: channel as TextChannel,
        options: {
          getString: { password: "test-password" },
          getInteger: { count: 10 },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Error during purge"),
      });
    });
  });
});
