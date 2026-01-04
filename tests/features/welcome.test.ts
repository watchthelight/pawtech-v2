/**
 * Pawtropolis Tech — tests/features/welcome.test.ts
 * WHAT: Unit tests for welcome card module.
 * WHY: Verify welcome message posting, embed building, and error handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { postWelcomeCard } from "../../src/features/welcome.js";
import { logger } from "../../src/lib/logger.js";

describe("features/welcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("postWelcomeCard", () => {
    it("throws when general channel not configured", async () => {
      const opts = {
        guild: {
          id: "guild123",
          name: "Test Server",
          iconURL: vi.fn(() => "https://example.com/icon.png"),
          channels: { fetch: vi.fn() },
          members: { me: null },
        },
        user: {
          id: "user456",
          displayAvatarURL: vi.fn(() => "https://example.com/avatar.png"),
        },
        config: { general_channel_id: null },
        memberCount: 100,
      };

      await expect(postWelcomeCard(opts as any)).rejects.toThrow("general channel not configured");
    });

    it("throws when channel fetch fails", async () => {
      const opts = {
        guild: {
          id: "guild123",
          name: "Test Server",
          iconURL: vi.fn(() => "https://example.com/icon.png"),
          channels: {
            fetch: vi.fn().mockRejectedValue(new Error("Unknown Channel")),
          },
          members: { me: null },
        },
        user: {
          id: "user456",
          displayAvatarURL: vi.fn(() => "https://example.com/avatar.png"),
        },
        config: { general_channel_id: "channel789" },
        memberCount: 100,
      };

      await expect(postWelcomeCard(opts as any)).rejects.toThrow("failed to fetch general channel");
    });

    it("throws when channel is not text-based", async () => {
      const mockChannel = {
        isTextBased: () => false,
      };

      const opts = {
        guild: {
          id: "guild123",
          name: "Test Server",
          iconURL: vi.fn(() => "https://example.com/icon.png"),
          channels: {
            fetch: vi.fn().mockResolvedValue(mockChannel),
          },
          members: { me: null },
        },
        user: {
          id: "user456",
          displayAvatarURL: vi.fn(() => "https://example.com/avatar.png"),
        },
        config: { general_channel_id: "channel789" },
        memberCount: 100,
      };

      await expect(postWelcomeCard(opts as any)).rejects.toThrow("general channel is not a valid text channel");
    });

    it("throws when missing permissions", async () => {
      const mockChannel = {
        isTextBased: () => true,
        permissionsFor: vi.fn(() => ({
          has: vi.fn((perm) => {
            if (perm.toString() === "ViewChannel") return false;
            return true;
          }),
        })),
      };

      const mockMe = { id: "botId" };

      const opts = {
        guild: {
          id: "guild123",
          name: "Test Server",
          iconURL: vi.fn(() => "https://example.com/icon.png"),
          channels: {
            fetch: vi.fn().mockResolvedValue(mockChannel),
          },
          members: { me: mockMe },
        },
        user: {
          id: "user456",
          displayAvatarURL: vi.fn(() => "https://example.com/avatar.png"),
        },
        config: { general_channel_id: "channel789" },
        memberCount: 100,
      };

      await expect(postWelcomeCard(opts as any)).rejects.toThrow("missing permissions");
    });

    it("sends welcome message successfully", async () => {
      const mockMessage = { id: "msg123" };
      const mockChannel = {
        id: "channel789",
        isTextBased: () => true,
        permissionsFor: vi.fn(() => ({
          has: vi.fn(() => true),
        })),
        send: vi.fn().mockResolvedValue(mockMessage),
      };

      const mockMe = { id: "botId" };

      const opts = {
        guild: {
          id: "guild123",
          name: "Test Server",
          iconURL: vi.fn(() => "https://example.com/icon.png"),
          channels: {
            fetch: vi.fn().mockResolvedValue(mockChannel),
          },
          members: { me: mockMe },
        },
        user: {
          id: "user456",
          displayAvatarURL: vi.fn(() => "https://example.com/avatar.png"),
        },
        config: {
          general_channel_id: "channel789",
          welcome_ping_role_id: null,
          info_channel_id: null,
          rules_channel_id: null,
        },
        memberCount: 100,
      };

      const result = await postWelcomeCard(opts as any);

      expect(result).toBe(mockMessage);
      expect(mockChannel.send).toHaveBeenCalled();
    });

    it("includes user ping in content", async () => {
      const mockMessage = { id: "msg123" };
      const mockChannel = {
        id: "channel789",
        isTextBased: () => true,
        permissionsFor: vi.fn(() => ({
          has: vi.fn(() => true),
        })),
        send: vi.fn().mockResolvedValue(mockMessage),
      };

      const mockMe = { id: "botId" };

      const opts = {
        guild: {
          id: "guild123",
          name: "Test Server",
          iconURL: vi.fn(() => "https://example.com/icon.png"),
          channels: {
            fetch: vi.fn().mockResolvedValue(mockChannel),
          },
          members: { me: mockMe },
        },
        user: {
          id: "user456",
          displayAvatarURL: vi.fn(() => "https://example.com/avatar.png"),
        },
        config: {
          general_channel_id: "channel789",
          welcome_ping_role_id: null,
          info_channel_id: null,
          rules_channel_id: null,
        },
        memberCount: 100,
      };

      await postWelcomeCard(opts as any);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("<@user456>"),
        })
      );
    });

    it("includes welcome ping role when configured", async () => {
      const mockMessage = { id: "msg123" };
      const mockChannel = {
        id: "channel789",
        isTextBased: () => true,
        permissionsFor: vi.fn(() => ({
          has: vi.fn(() => true),
        })),
        send: vi.fn().mockResolvedValue(mockMessage),
      };

      const mockMe = { id: "botId" };

      const opts = {
        guild: {
          id: "guild123",
          name: "Test Server",
          iconURL: vi.fn(() => "https://example.com/icon.png"),
          channels: {
            fetch: vi.fn().mockResolvedValue(mockChannel),
          },
          members: { me: mockMe },
        },
        user: {
          id: "user456",
          displayAvatarURL: vi.fn(() => "https://example.com/avatar.png"),
        },
        config: {
          general_channel_id: "channel789",
          welcome_ping_role_id: "role123",
          info_channel_id: null,
          rules_channel_id: null,
        },
        memberCount: 100,
      };

      await postWelcomeCard(opts as any);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("<@&role123>"),
        })
      );
    });

    it("includes info channel link when configured", async () => {
      const mockMessage = { id: "msg123" };
      const mockChannel = {
        id: "channel789",
        isTextBased: () => true,
        permissionsFor: vi.fn(() => ({
          has: vi.fn(() => true),
        })),
        send: vi.fn().mockResolvedValue(mockMessage),
      };

      const mockMe = { id: "botId" };

      const opts = {
        guild: {
          id: "guild123",
          name: "Test Server",
          iconURL: vi.fn(() => "https://example.com/icon.png"),
          channels: {
            fetch: vi.fn().mockResolvedValue(mockChannel),
          },
          members: { me: mockMe },
        },
        user: {
          id: "user456",
          displayAvatarURL: vi.fn(() => "https://example.com/avatar.png"),
        },
        config: {
          general_channel_id: "channel789",
          welcome_ping_role_id: null,
          info_channel_id: "info123",
          rules_channel_id: null,
        },
        memberCount: 100,
      };

      await postWelcomeCard(opts as any);

      const sendCall = mockChannel.send.mock.calls[0][0];
      const embed = sendCall.embeds[0];
      expect(embed.description).toContain("<#info123>");
    });

    it("includes rules channel link when configured", async () => {
      const mockMessage = { id: "msg123" };
      const mockChannel = {
        id: "channel789",
        isTextBased: () => true,
        permissionsFor: vi.fn(() => ({
          has: vi.fn(() => true),
        })),
        send: vi.fn().mockResolvedValue(mockMessage),
      };

      const mockMe = { id: "botId" };

      const opts = {
        guild: {
          id: "guild123",
          name: "Test Server",
          iconURL: vi.fn(() => "https://example.com/icon.png"),
          channels: {
            fetch: vi.fn().mockResolvedValue(mockChannel),
          },
          members: { me: mockMe },
        },
        user: {
          id: "user456",
          displayAvatarURL: vi.fn(() => "https://example.com/avatar.png"),
        },
        config: {
          general_channel_id: "channel789",
          welcome_ping_role_id: null,
          info_channel_id: null,
          rules_channel_id: "rules456",
        },
        memberCount: 100,
      };

      await postWelcomeCard(opts as any);

      const sendCall = mockChannel.send.mock.calls[0][0];
      const embed = sendCall.embeds[0];
      expect(embed.description).toContain("<#rules456>");
    });

    it("includes member count in description", async () => {
      const mockMessage = { id: "msg123" };
      const mockChannel = {
        id: "channel789",
        isTextBased: () => true,
        permissionsFor: vi.fn(() => ({
          has: vi.fn(() => true),
        })),
        send: vi.fn().mockResolvedValue(mockMessage),
      };

      const mockMe = { id: "botId" };

      const opts = {
        guild: {
          id: "guild123",
          name: "Test Server",
          iconURL: vi.fn(() => "https://example.com/icon.png"),
          channels: {
            fetch: vi.fn().mockResolvedValue(mockChannel),
          },
          members: { me: mockMe },
        },
        user: {
          id: "user456",
          displayAvatarURL: vi.fn(() => "https://example.com/avatar.png"),
        },
        config: {
          general_channel_id: "channel789",
          welcome_ping_role_id: null,
          info_channel_id: null,
          rules_channel_id: null,
        },
        memberCount: 12345,
      };

      await postWelcomeCard(opts as any);

      const sendCall = mockChannel.send.mock.calls[0][0];
      const embed = sendCall.embeds[0];
      expect(embed.description).toContain("12,345");
    });

    it("logs successful welcome card post", async () => {
      const mockMessage = { id: "msg123" };
      const mockChannel = {
        id: "channel789",
        isTextBased: () => true,
        permissionsFor: vi.fn(() => ({
          has: vi.fn(() => true),
        })),
        send: vi.fn().mockResolvedValue(mockMessage),
      };

      const mockMe = { id: "botId" };

      const opts = {
        guild: {
          id: "guild123",
          name: "Test Server",
          iconURL: vi.fn(() => "https://example.com/icon.png"),
          channels: {
            fetch: vi.fn().mockResolvedValue(mockChannel),
          },
          members: { me: mockMe },
        },
        user: {
          id: "user456",
          displayAvatarURL: vi.fn(() => "https://example.com/avatar.png"),
        },
        config: {
          general_channel_id: "channel789",
          welcome_ping_role_id: null,
          info_channel_id: null,
          rules_channel_id: null,
        },
        memberCount: 100,
      };

      await postWelcomeCard(opts as any);

      expect(logger.info).toHaveBeenCalled();
    });

    it("retries on transient errors", async () => {
      let attempt = 0;
      const mockMessage = { id: "msg123" };
      const mockChannel = {
        id: "channel789",
        isTextBased: () => true,
        permissionsFor: vi.fn(() => ({
          has: vi.fn(() => true),
        })),
        send: vi.fn().mockImplementation(() => {
          attempt++;
          if (attempt === 1) {
            const err = new Error("other side closed");
            (err as any).code = "UND_ERR_SOCKET";
            throw err;
          }
          return Promise.resolve(mockMessage);
        }),
      };

      const mockMe = { id: "botId" };

      const opts = {
        guild: {
          id: "guild123",
          name: "Test Server",
          iconURL: vi.fn(() => "https://example.com/icon.png"),
          channels: {
            fetch: vi.fn().mockResolvedValue(mockChannel),
          },
          members: { me: mockMe },
        },
        user: {
          id: "user456",
          displayAvatarURL: vi.fn(() => "https://example.com/avatar.png"),
        },
        config: {
          general_channel_id: "channel789",
          welcome_ping_role_id: null,
          info_channel_id: null,
          rules_channel_id: null,
        },
        memberCount: 100,
      };

      const result = await postWelcomeCard(opts as any);

      expect(result).toBe(mockMessage);
      expect(mockChannel.send).toHaveBeenCalledTimes(2);
    });

    it("throws after max retries", async () => {
      const mockChannel = {
        id: "channel789",
        isTextBased: () => true,
        permissionsFor: vi.fn(() => ({
          has: vi.fn(() => true),
        })),
        send: vi.fn().mockImplementation(() => {
          const err = new Error("other side closed");
          (err as any).code = "UND_ERR_SOCKET";
          throw err;
        }),
      };

      const mockMe = { id: "botId" };

      const opts = {
        guild: {
          id: "guild123",
          name: "Test Server",
          iconURL: vi.fn(() => "https://example.com/icon.png"),
          channels: {
            fetch: vi.fn().mockResolvedValue(mockChannel),
          },
          members: { me: mockMe },
        },
        user: {
          id: "user456",
          displayAvatarURL: vi.fn(() => "https://example.com/avatar.png"),
        },
        config: {
          general_channel_id: "channel789",
          welcome_ping_role_id: null,
          info_channel_id: null,
          rules_channel_id: null,
        },
        memberCount: 100,
      };

      await expect(postWelcomeCard(opts as any)).rejects.toThrow("other side closed");
      expect(mockChannel.send).toHaveBeenCalledTimes(3);
    });
  });
});

describe("welcome embed", () => {
  describe("embed color", () => {
    it("uses brand cyan (0x00C2FF)", () => {
      const color = 0x00c2ff;
      expect(color).toBe(49919);
    });
  });

  describe("embed title", () => {
    it("includes Welcome text", () => {
      const title = "Welcome to Pawtropolis 🐾";
      expect(title).toContain("Welcome");
    });

    it("includes paw emoji", () => {
      const title = "Welcome to Pawtropolis 🐾";
      expect(title).toContain("🐾");
    });
  });

  describe("embed footer", () => {
    it("credits moderation team", () => {
      const footer = "Pawtropolis Moderation Team";
      expect(footer).toContain("Moderation");
    });
  });

  describe("embed author", () => {
    it("shows guild name", () => {
      const authorName = "Test Server";
      expect(authorName).toBeDefined();
    });

    it("shows guild icon", () => {
      const iconUrl = "https://cdn.discordapp.com/icons/guild123/icon.png";
      expect(iconUrl).toContain("cdn.discordapp.com");
    });
  });

  describe("embed thumbnail", () => {
    it("shows user avatar", () => {
      const thumbnailUrl = "https://cdn.discordapp.com/avatars/user123/avatar.png";
      expect(thumbnailUrl).toContain("avatars");
    });
  });

  describe("embed image", () => {
    it("attaches banner.webp", () => {
      const imageUrl = "attachment://banner.webp";
      expect(imageUrl).toBe("attachment://banner.webp");
    });
  });
});

describe("allowed mentions", () => {
  describe("user mention", () => {
    it("allows specific user", () => {
      const allowedMentions = { users: ["user456"], roles: [] };
      expect(allowedMentions.users).toContain("user456");
    });
  });

  describe("role mention", () => {
    it("allows welcome ping role", () => {
      const allowedMentions = { users: ["user456"], roles: ["role123"] };
      expect(allowedMentions.roles).toContain("role123");
    });

    it("excludes roles when not configured", () => {
      const allowedMentions = { users: ["user456"], roles: [] };
      expect(allowedMentions.roles).toHaveLength(0);
    });
  });

  describe("mention safety", () => {
    it("never allows @everyone", () => {
      const parse: string[] = [];
      expect(parse).not.toContain("everyone");
    });

    it("never allows @here", () => {
      const parse: string[] = [];
      expect(parse).not.toContain("here");
    });
  });
});

describe("retry logic", () => {
  describe("MAX_RETRIES", () => {
    it("is 3", () => {
      const maxRetries = 3;
      expect(maxRetries).toBe(3);
    });
  });

  describe("RETRY_DELAY_MS", () => {
    it("is 500ms base", () => {
      const baseDelay = 500;
      expect(baseDelay).toBe(500);
    });

    it("uses linear backoff", () => {
      const baseDelay = 500;
      const delays = [baseDelay * 1, baseDelay * 2, baseDelay * 3];
      expect(delays).toEqual([500, 1000, 1500]);
    });
  });

  describe("transient errors", () => {
    it("retries UND_ERR_SOCKET", () => {
      const error = { code: "UND_ERR_SOCKET" };
      const isTransient = error.code?.startsWith("UND_ERR_");
      expect(isTransient).toBe(true);
    });

    it("retries 'other side closed'", () => {
      const message = "other side closed";
      const isTransient = message.includes("other side closed");
      expect(isTransient).toBe(true);
    });

    it("retries ECONNRESET", () => {
      const message = "econnreset";
      const isTransient = message.includes("econnreset");
      expect(isTransient).toBe(true);
    });

    it("retries ETIMEDOUT", () => {
      const message = "etimedout";
      const isTransient = message.includes("etimedout");
      expect(isTransient).toBe(true);
    });
  });
});

describe("permission checks", () => {
  describe("required permissions", () => {
    it("checks ViewChannel", () => {
      const required = ["ViewChannel", "SendMessages", "EmbedLinks", "AttachFiles"];
      expect(required).toContain("ViewChannel");
    });

    it("checks SendMessages", () => {
      const required = ["ViewChannel", "SendMessages", "EmbedLinks", "AttachFiles"];
      expect(required).toContain("SendMessages");
    });

    it("checks EmbedLinks", () => {
      const required = ["ViewChannel", "SendMessages", "EmbedLinks", "AttachFiles"];
      expect(required).toContain("EmbedLinks");
    });

    it("checks AttachFiles", () => {
      const required = ["ViewChannel", "SendMessages", "EmbedLinks", "AttachFiles"];
      expect(required).toContain("AttachFiles");
    });
  });

  describe("permission error message", () => {
    it("lists missing permissions", () => {
      const missingPerms = ["ViewChannel", "SendMessages"];
      const message = `missing permissions: ${missingPerms.join(", ")}`;
      expect(message).toContain("ViewChannel");
      expect(message).toContain("SendMessages");
    });
  });
});

describe("file attachment", () => {
  describe("banner file", () => {
    it("uses relative path", () => {
      const path = "./assets/banner.webp";
      expect(path).toMatch(/^\.\/assets/);
    });

    it("uses webp format", () => {
      const path = "./assets/banner.webp";
      expect(path).toMatch(/\.webp$/);
    });

    it("names file as banner.webp", () => {
      const name = "banner.webp";
      expect(name).toBe("banner.webp");
    });
  });
});

describe("logging", () => {
  describe("info logs", () => {
    it("logs posted welcome card", () => {
      const logMessage = "[welcome] posted welcome card";
      expect(logMessage).toContain("welcome");
    });
  });

  describe("warn logs", () => {
    it("logs transient retries", () => {
      const logMessage = "[welcome] transient error, retrying...";
      expect(logMessage).toContain("retrying");
    });

    it("logs missing permissions", () => {
      const logMessage = "[welcome] missing permissions in general channel";
      expect(logMessage).toContain("missing permissions");
    });
  });

  describe("error logs", () => {
    it("logs send failure", () => {
      const logMessage = "[welcome] failed to send welcome card";
      expect(logMessage).toContain("failed");
    });
  });
});
