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

// Mock interaction factory
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

describe("/send command", () => {
  // Wrap the execute function to create CommandContext
  const wrappedExecute = wrapCommand("send", execute);

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SEND_ALLOWED_ROLE_IDS;
    delete process.env.LOGGING_CHANNEL;
    delete process.env.LOGGING_CHANNEL_ID;
  });

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
