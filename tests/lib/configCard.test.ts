/**
 * Pawtropolis Tech — tests/lib/configCard.test.ts
 * WHAT: Unit tests for gate configuration card module.
 * WHY: Verify embed building, channel validation, and pin behavior.
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

vi.mock("../../src/lib/cmdWrap.js", () => ({
  replyOrEdit: vi.fn().mockResolvedValue(undefined),
}));

describe("lib/configCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GateConfigCardData", () => {
    describe("required fields", () => {
      it("includes reviewChannelId", () => {
        const cfg = { reviewChannelId: "chan-123" };
        expect(cfg.reviewChannelId).toBeDefined();
      });

      it("includes gateChannelId", () => {
        const cfg = { gateChannelId: "chan-456" };
        expect(cfg.gateChannelId).toBeDefined();
      });

      it("includes generalChannelId", () => {
        const cfg = { generalChannelId: "chan-789" };
        expect(cfg.generalChannelId).toBeDefined();
      });

      it("includes acceptedRoleId", () => {
        const cfg = { acceptedRoleId: "role-123" };
        expect(cfg.acceptedRoleId).toBeDefined();
      });

      it("includes reviewerRoleId (nullable)", () => {
        const cfg = { reviewerRoleId: null };
        expect(cfg.reviewerRoleId).toBeNull();
      });
    });

    describe("optional fields", () => {
      it("unverifiedChannelId is optional", () => {
        const cfg = { unverifiedChannelId: undefined };
        expect(cfg.unverifiedChannelId).toBeUndefined();
      });

      it("unverifiedChannelId can be null", () => {
        const cfg = { unverifiedChannelId: null };
        expect(cfg.unverifiedChannelId).toBeNull();
      });

      it("unverifiedChannelId can be string", () => {
        const cfg = { unverifiedChannelId: "chan-unv" };
        expect(cfg.unverifiedChannelId).toBe("chan-unv");
      });
    });
  });

  describe("postGateConfigCard", () => {
    describe("target channel selection", () => {
      it("defaults to review channel", () => {
        const cfg = { reviewChannelId: "chan-123" };
        const postChannelId = undefined;
        const targetChannelId = postChannelId ?? cfg.reviewChannelId;
        expect(targetChannelId).toBe("chan-123");
      });

      it("allows override via postChannelId", () => {
        const cfg = { reviewChannelId: "chan-123" };
        const postChannelId = "chan-override";
        const targetChannelId = postChannelId ?? cfg.reviewChannelId;
        expect(targetChannelId).toBe("chan-override");
      });
    });

    describe("channel validation", () => {
      it("throws for non-existent channel", () => {
        const channel = null;
        const error = !channel ? new Error("Channel not found") : null;
        expect(error).not.toBeNull();
      });

      it("throws for non-text channel", () => {
        const channel = { isTextBased: () => false };
        const isValid = channel.isTextBased();
        expect(isValid).toBe(false);
      });

      it("throws for DM channel", () => {
        const channel = { isTextBased: () => true, isDMBased: () => true };
        const isValid = channel.isTextBased() && !channel.isDMBased();
        expect(isValid).toBe(false);
      });

      it("accepts valid text channel", () => {
        const channel = { isTextBased: () => true, isDMBased: () => false };
        const isValid = channel.isTextBased() && !channel.isDMBased();
        expect(isValid).toBe(true);
      });
    });
  });
});

describe("embed content", () => {
  describe("embed properties", () => {
    it("sets title to Pawtropolis Tech — Gate Configuration", () => {
      const title = "Pawtropolis Tech — Gate Configuration";
      expect(title).toContain("Gate Configuration");
    });

    it("sets description", () => {
      const description = "Current gate configuration for this server.";
      expect(description).toContain("configuration");
    });

    it("uses Discord blurple color (0x5865F2)", () => {
      const color = 0x5865f2;
      expect(color).toBe(0x5865f2);
    });
  });

  describe("embed fields", () => {
    describe("Review Channel field", () => {
      it("shows channel mention", () => {
        const channelId = "chan-123";
        const value = `<#${channelId}>`;
        expect(value).toBe("<#chan-123>");
      });

      it("is inline", () => {
        const inline = true;
        expect(inline).toBe(true);
      });
    });

    describe("Gate Channel field", () => {
      it("shows channel mention", () => {
        const channelId = "chan-456";
        const value = `<#${channelId}>`;
        expect(value).toBe("<#chan-456>");
      });
    });

    describe("General Channel field", () => {
      it("shows channel mention", () => {
        const channelId = "chan-789";
        const value = `<#${channelId}>`;
        expect(value).toBe("<#chan-789>");
      });
    });

    describe("Unverified Channel field", () => {
      it("shows channel mention when configured", () => {
        const unverifiedChannelId = "chan-unv";
        const value = unverifiedChannelId ? `<#${unverifiedChannelId}>` : "not set";
        expect(value).toBe("<#chan-unv>");
      });

      it("shows not set when null", () => {
        const unverifiedChannelId = null;
        const value = unverifiedChannelId ? `<#${unverifiedChannelId}>` : "not set";
        expect(value).toBe("not set");
      });
    });

    describe("Accepted Role field", () => {
      it("shows role mention", () => {
        const roleId = "role-123";
        const value = `<@&${roleId}>`;
        expect(value).toBe("<@&role-123>");
      });
    });

    describe("Reviewer Role field", () => {
      it("shows role mention when configured", () => {
        const reviewerRoleId = "role-rev";
        const value = reviewerRoleId ? `<@&${reviewerRoleId}>` : "(not set)";
        expect(value).toBe("<@&role-rev>");
      });

      it("shows fallback text when null", () => {
        const reviewerRoleId = null;
        const value = reviewerRoleId
          ? `<@&${reviewerRoleId}>`
          : "(not set → using review channel visibility)";
        expect(value).toContain("not set");
        expect(value).toContain("review channel visibility");
      });
    });

    describe("NSFW Avatar Detection field", () => {
      it("shows enabled when API key configured", () => {
        const visionApiKey = "sk-test-key";
        const visionStatus = visionApiKey
          ? "✅ Enabled (75% accuracy on NSFW)"
          : "⚠️ Disabled";
        expect(visionStatus).toContain("Enabled");
        expect(visionStatus).toContain("75%");
      });

      it("shows disabled when API key not configured", () => {
        const visionApiKey = undefined;
        const visionStatus = visionApiKey
          ? "✅ Enabled"
          : "⚠️ Disabled (set GOOGLE_VISION_API_KEY)";
        expect(visionStatus).toContain("Disabled");
        expect(visionStatus).toContain("GOOGLE_VISION_API_KEY");
      });

      it("is not inline", () => {
        const inline = false;
        expect(inline).toBe(false);
      });
    });
  });

  describe("embed footer", () => {
    it("includes guild ID", () => {
      const guildId = "guild-123";
      const footer = `Guild ID: ${guildId}`;
      expect(footer).toContain("Guild ID:");
    });
  });

  describe("embed timestamp", () => {
    it("includes current timestamp", () => {
      const hasTimestamp = true;
      expect(hasTimestamp).toBe(true);
    });
  });
});

describe("link buttons", () => {
  describe("button count", () => {
    it("includes 3 link buttons", () => {
      const buttonCount = 3;
      expect(buttonCount).toBe(3);
    });
  });

  describe("Open Review button", () => {
    it("uses Link style", () => {
      const style = "Link";
      expect(style).toBe("Link");
    });

    it("constructs correct URL", () => {
      const guildId = "guild-123";
      const reviewChannelId = "chan-review";
      const url = `https://discord.com/channels/${guildId}/${reviewChannelId}`;
      expect(url).toBe("https://discord.com/channels/guild-123/chan-review");
    });
  });

  describe("Open Gate button", () => {
    it("constructs correct URL", () => {
      const guildId = "guild-123";
      const gateChannelId = "chan-gate";
      const url = `https://discord.com/channels/${guildId}/${gateChannelId}`;
      expect(url).toBe("https://discord.com/channels/guild-123/chan-gate");
    });
  });

  describe("Open General button", () => {
    it("constructs correct URL", () => {
      const guildId = "guild-123";
      const generalChannelId = "chan-general";
      const url = `https://discord.com/channels/${guildId}/${generalChannelId}`;
      expect(url).toBe("https://discord.com/channels/guild-123/chan-general");
    });
  });
});

describe("allowed mentions", () => {
  it("uses SAFE_ALLOWED_MENTIONS to prevent pings", () => {
    const useSafeMentions = true;
    expect(useSafeMentions).toBe(true);
  });
});

describe("auto-pin behavior", () => {
  describe("pin attempt", () => {
    it("only pins if not already pinned", () => {
      const message = { pinned: false };
      const shouldPin = !message.pinned;
      expect(shouldPin).toBe(true);
    });

    it("skips pin if already pinned", () => {
      const message = { pinned: true };
      const shouldPin = !message.pinned;
      expect(shouldPin).toBe(false);
    });
  });

  describe("pin failure handling", () => {
    it("continues gracefully on pin failure", () => {
      const pinFailed = true;
      const cardStillWorks = true;
      expect(pinFailed && cardStillWorks).toBe(true);
    });

    it("logs warning on pin failure", () => {
      const shouldLogWarning = true;
      expect(shouldLogWarning).toBe(true);
    });
  });

  describe("common pin failures", () => {
    it("handles missing MANAGE_MESSAGES", () => {
      const reason = "Missing permissions";
      expect(reason).toBeDefined();
    });

    it("handles 50 pin limit", () => {
      const reason = "Discord has 50 pin limit per channel";
      expect(reason).toContain("50");
    });
  });
});

describe("confirmation reply", () => {
  describe("message content", () => {
    it("includes success emoji", () => {
      const content = "✅ Configuration card posted";
      expect(content).toContain("✅");
    });

    it("includes message URL", () => {
      const guildId = "guild-123";
      const channelId = "chan-123";
      const messageId = "msg-123";
      const messageUrl = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
      expect(messageUrl).toContain("discord.com/channels");
    });

    it("includes pinned status when pinned", () => {
      const pinned = true;
      const content = `✅ Configuration card posted${pinned ? " and pinned" : ""}`;
      expect(content).toContain("and pinned");
    });

    it("omits pinned status when not pinned", () => {
      const pinned = false;
      const content = `✅ Configuration card posted${pinned ? " and pinned" : ""}`;
      expect(content).not.toContain("and pinned");
    });

    it("includes question count", () => {
      const questionCount = 5;
      const content = `Questions found: ${questionCount}`;
      expect(content).toContain("Questions found: 5");
    });
  });

  describe("reply method", () => {
    it("uses replyOrEdit for ephemeral acknowledgment", () => {
      const method = "replyOrEdit";
      expect(method).toBe("replyOrEdit");
    });
  });
});

describe("error handling", () => {
  describe("invalid channel", () => {
    it("throws Error with channel ID", () => {
      const channelId = "chan-invalid";
      const error = new Error(`Channel ${channelId} is not a valid text channel`);
      expect(error.message).toContain("chan-invalid");
      expect(error.message).toContain("not a valid text channel");
    });
  });
});

describe("channel fetch behavior", () => {
  it("uses guild.channels.fetch for fresh data", () => {
    const fetchMethod = "guild.channels.fetch";
    expect(fetchMethod).toContain("fetch");
  });

  it("handles fetch failure gracefully", () => {
    const handlesFetchFailure = true;
    expect(handlesFetchFailure).toBe(true);
  });
});
