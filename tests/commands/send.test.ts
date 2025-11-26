/**
 * Pawtropolis Tech — tests/commands/send.test.ts
 * WHAT: Unit tests for /send command (anonymous staff messaging).
 * WHY: Verify access control, mention sanitization, length limits, and audit logging.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi } from "vitest";
import { execute } from "../../src/commands/send.js";
import { wrapCommand } from "../../src/lib/cmdWrap.js";
import type {
  ChatInputCommandInteraction,
  Guild,
  TextChannel,
  GuildMember,
  User,
  Attachment,
} from "discord.js";
import { ChannelType } from "discord.js";

/**
 * Factory for creating mock Discord interactions.
 *
 * The default mock represents the "happy path": a guild member with no special
 * roles sending a basic text message. Callers override specific properties to
 * test different scenarios (role restrictions, long messages, attachments, etc.).
 *
 * Key defaults:
 * - Empty role cache (user has no roles)
 * - silent: true (no pings by default)
 * - embed: false (plain text message)
 * - No attachment
 *
 * Gotcha: The mockMember.roles.cache is a Map, so role checks use Map.has().
 * When testing role-based access, populate this map with the expected role IDs.
 */
function createMockInteraction(
  overrides: Partial<ChatInputCommandInteraction> = {}
): ChatInputCommandInteraction {
  const mockGuild: Partial<Guild> = {
    id: "test-guild-123",
  };

  const mockChannel: Partial<TextChannel> = {
    id: "test-channel-456",
    type: ChannelType.GuildText,
    send: vi.fn().mockResolvedValue({}),
    messages: {
      fetch: vi.fn().mockResolvedValue({ id: "reply-msg-789" }),
    } as any,
  };

  const mockUser: Partial<User> = {
    id: "user-123",
    username: "TestUser",
  };

  const mockMember: Partial<GuildMember> = {
    roles: {
      cache: new Map(),
    } as any,
  };

  const mockClient: any = {
    channels: {
      fetch: vi.fn().mockResolvedValue(mockChannel),
    },
  };

  return {
    guild: mockGuild as Guild,
    channel: mockChannel as TextChannel,
    user: mockUser as User,
    member: mockMember as GuildMember,
    client: mockClient,
    options: {
      getString: vi.fn((name: string, required?: boolean) => {
        if (name === "message") return "Test message";
        if (name === "reply_to") return null;
        return null;
      }),
      getBoolean: vi.fn((name: string) => {
        if (name === "embed") return false;
        if (name === "silent") return true;
        return null;
      }),
      getAttachment: vi.fn(() => null),
    } as any,
    reply: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as ChatInputCommandInteraction;
}

/**
 * Tests for the /send command - anonymous staff messaging.
 *
 * This command lets staff send messages to channels without revealing who sent them.
 * Use cases: announcements, moderation warnings, community updates.
 *
 * Security considerations tested:
 * - Role-based access control (SEND_ALLOWED_ROLE_IDS)
 * - @everyone/@here mention neutralization (prevent abuse)
 * - Message length limits (Discord API constraints)
 * - Guild-only restriction (no DM usage)
 */
describe("/send command", () => {
  /**
   * wrapCommand adds the CommandContext wrapper that the execute function expects.
   * This mimics how the bot's command handler invokes commands in production.
   */
  const wrappedExecute = wrapCommand("send", execute);

  /**
   * Clean slate for each test. Environment variables are deleted to ensure
   * tests don't leak state (e.g., a role restriction from one test affecting another).
   */
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SEND_ALLOWED_ROLE_IDS;
    delete process.env.LOGGING_CHANNEL;
    delete process.env.LOGGING_CHANNEL_ID;
  });

  /**
   * Happy path: Message sent, ephemeral confirmation returned to the sender.
   * The allowedMentions: { parse: [] } is critical - it prevents the bot from
   * actually pinging anyone when silent mode is on.
   */
  it("should send a basic message and reply ephemerally", async () => {
    const interaction = createMockInteraction();

    await wrappedExecute(interaction);

    expect(interaction.channel?.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Test message",
        allowedMentions: { parse: [], repliedUser: false },
      })
    );

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Sent ✅",
      ephemeral: true,
    });
  });

  /**
   * Security: @everyone and @here are neutered with zero-width spaces.
   * This prevents staff from accidentally (or maliciously) pinging the entire server.
   * The "\u200b" is a zero-width space that breaks the mention syntax.
   */
  it("should neutralize @everyone and @here in messages", async () => {
    const interaction = createMockInteraction({
      options: {
        getString: vi.fn((name: string) => {
          if (name === "message") return "Hello @everyone and @here!";
          return null;
        }),
        getBoolean: vi.fn(() => false),
        getAttachment: vi.fn(() => null),
      } as any,
    });

    await wrappedExecute(interaction);

    expect(interaction.channel?.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Hello @\u200beveryone and @\u200bhere!",
      })
    );
  });

  it("should send as embed when embed:true", async () => {
    const interaction = createMockInteraction({
      options: {
        getString: vi.fn((name: string) => {
          if (name === "message") return "Embed content";
          return null;
        }),
        getBoolean: vi.fn((name: string) => {
          if (name === "embed") return true;
          if (name === "silent") return true;
          return null;
        }),
        getAttachment: vi.fn(() => null),
      } as any,
    });

    await wrappedExecute(interaction);

    expect(interaction.channel?.send).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              description: "Embed content",
            }),
          }),
        ]),
      })
    );
  });

  /**
   * Discord API limit: Plain text messages max out at 2000 characters.
   * We reject at the boundary (+1 char) to ensure we catch exactly the limit.
   * Better to fail early than get a cryptic API error.
   */
  it("should reject messages exceeding plain text limit (2000 chars)", async () => {
    const longMessage = "a".repeat(2001);
    const interaction = createMockInteraction({
      options: {
        getString: vi.fn((name: string) => {
          if (name === "message") return longMessage;
          return null;
        }),
        getBoolean: vi.fn(() => false),
        getAttachment: vi.fn(() => null),
      } as any,
    });

    await wrappedExecute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Message too long"),
        ephemeral: true,
      })
    );

    expect(interaction.channel?.send).not.toHaveBeenCalled();
  });

  /**
   * Embed descriptions have a higher limit (4096) than plain text.
   * This tests that we enforce the correct limit for the selected format.
   */
  it("should reject messages exceeding embed limit (4096 chars)", async () => {
    const longMessage = "a".repeat(4097);
    const interaction = createMockInteraction({
      options: {
        getString: vi.fn((name: string) => {
          if (name === "message") return longMessage;
          return null;
        }),
        getBoolean: vi.fn((name: string) => {
          if (name === "embed") return true;
          return null;
        }),
        getAttachment: vi.fn(() => null),
      } as any,
    });

    await wrappedExecute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Message too long"),
        ephemeral: true,
      })
    );

    expect(interaction.channel?.send).not.toHaveBeenCalled();
  });

  /**
   * When silent:false, user and role mentions are allowed to ping.
   * Note: @everyone/@here are still blocked (they're sanitized in the content itself).
   * The repliedUser: false prevents pinging if replying to a message.
   */
  it("should allow user/role mentions when silent:false", async () => {
    const interaction = createMockInteraction({
      options: {
        getString: vi.fn((name: string) => {
          if (name === "message") return "Test message";
          return null;
        }),
        getBoolean: vi.fn((name: string) => {
          if (name === "silent") return false;
          return null;
        }),
        getAttachment: vi.fn(() => null),
      } as any,
    });

    await wrappedExecute(interaction);

    expect(interaction.channel?.send).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedMentions: { parse: ["users", "roles"], repliedUser: false },
      })
    );
  });

  /**
   * Role-based access control: When SEND_ALLOWED_ROLE_IDS is set, only members
   * with at least one of those roles can use the command.
   * The default mock has an empty role cache, simulating a user with no roles.
   */
  it("should deny access if SEND_ALLOWED_ROLE_IDS is set and user has no matching role", async () => {
    process.env.SEND_ALLOWED_ROLE_IDS = "role-111,role-222";

    const interaction = createMockInteraction();

    await wrappedExecute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("do not have the required role"),
        ephemeral: true,
      })
    );

    expect(interaction.channel?.send).not.toHaveBeenCalled();
  });

  /**
   * Positive case for role check: User has role-222, which is in the allowed list.
   * Having just one matching role is sufficient (it's OR, not AND).
   */
  it("should allow access if user has at least one required role", async () => {
    process.env.SEND_ALLOWED_ROLE_IDS = "role-111,role-222";

    const mockMember: Partial<GuildMember> = {
      roles: {
        cache: new Map([["role-222", {}]]),
      } as any,
    };

    const interaction = createMockInteraction({
      member: mockMember as GuildMember,
    });

    await wrappedExecute(interaction);

    expect(interaction.channel?.send).toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Sent ✅",
      ephemeral: true,
    });
  });

  it("should include attachment if provided", async () => {
    const mockAttachment: Partial<Attachment> = {
      id: "attach-123",
      url: "https://cdn.discord.com/test.png",
    };

    const interaction = createMockInteraction({
      options: {
        getString: vi.fn((name: string) => {
          if (name === "message") return "With attachment";
          return null;
        }),
        getBoolean: vi.fn(() => true),
        getAttachment: vi.fn(() => mockAttachment as Attachment),
      } as any,
    });

    await wrappedExecute(interaction);

    expect(interaction.channel?.send).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [mockAttachment],
      })
    );
  });

  /**
   * Graceful degradation: If reply_to message can't be fetched (deleted, wrong ID,
   * permissions), we send the message anyway without the reply reference.
   * This prevents confusing error states where the user's message is lost.
   */
  it("should handle reply_to gracefully when message fetch fails", async () => {
    const mockChannel: Partial<TextChannel> = {
      id: "test-channel-456",
      type: ChannelType.GuildText,
      send: vi.fn().mockResolvedValue({}),
      messages: {
        fetch: vi.fn().mockRejectedValue(new Error("Message not found")),
      } as any,
    };

    const interaction = createMockInteraction({
      channel: mockChannel as TextChannel,
      options: {
        getString: vi.fn((name: string) => {
          if (name === "message") return "Reply test";
          if (name === "reply_to") return "invalid-msg-id";
          return null;
        }),
        getBoolean: vi.fn(() => true),
        getAttachment: vi.fn(() => null),
      } as any,
    });

    await wrappedExecute(interaction);

    // Should still send message despite fetch failure
    expect(interaction.channel?.send).toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Sent ✅",
      ephemeral: true,
    });
  });

  /**
   * DM protection: This command only makes sense in a guild context.
   * Without a guild, there's no channel to send to and no audit trail.
   */
  it("should deny command if not in a guild", async () => {
    const interaction = createMockInteraction({
      guild: null as any,
    });

    await wrappedExecute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("can only be used in a server"),
        ephemeral: true,
      })
    );

    expect(interaction.channel?.send).not.toHaveBeenCalled();
  });
});
