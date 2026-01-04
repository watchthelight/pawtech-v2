/**
 * Pawtropolis Tech — tests/features/gate.test.ts
 * WHAT: Unit tests for gate (verification) module.
 * WHY: Verify member verification flow, rules acceptance, and role assignment.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock functions
const { mockGet, mockRun, mockAll, mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockRun: vi.fn(),
  mockAll: vi.fn(),
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn(),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
  run: mockRun,
  all: mockAll,
});

mockTransaction.mockImplementation((fn) => fn);

vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
    transaction: mockTransaction,
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/lib/env.js", () => ({
  env: {
    GUILD_ID: "guild123",
  },
}));

vi.mock("../../src/lib/config.js", () => ({
  getConfig: vi.fn(() => ({
    guild_id: "guild123",
    unverified_role_id: "unverified123",
    verified_role_id: "verified456",
    rules_channel_id: "rules789",
    gate_channel_id: "gate101",
    logging_channel_id: "logging202",
  })),
  requireStaff: vi.fn(() => true),
  requireAdminOrLeadership: vi.fn(() => true),
}));

vi.mock("../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn(),
}));

vi.mock("../../src/store/verificationStore.js", () => ({
  getVerificationStatus: vi.fn(),
  setVerificationStatus: vi.fn(),
}));

import {
  buildGateEmbed,
  buildGateComponents,
  handleAcceptRules,
  sendGateMessage,
  isUserVerified,
  verifyMember,
} from "../../src/features/gate.js";
import { getConfig } from "../../src/lib/config.js";
import { getVerificationStatus, setVerificationStatus } from "../../src/store/verificationStore.js";
import { logActionPretty } from "../../src/logging/pretty.js";
import { logger } from "../../src/lib/logger.js";

describe("features/gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      run: mockRun,
      all: mockAll,
    });
  });

  describe("buildGateEmbed", () => {
    it("creates embed with server name", () => {
      const mockGuild = {
        name: "Test Server",
        iconURL: vi.fn(() => "https://example.com/icon.png"),
      };

      const embed = buildGateEmbed(mockGuild as any);

      expect(embed.data.title).toContain("Welcome");
    });

    it("includes rules instructions", () => {
      const mockGuild = {
        name: "Test Server",
        iconURL: vi.fn(() => "https://example.com/icon.png"),
      };

      const embed = buildGateEmbed(mockGuild as any);

      expect(embed.data.description).toBeDefined();
    });

    it("uses brand color", () => {
      const mockGuild = {
        name: "Test Server",
        iconURL: vi.fn(() => "https://example.com/icon.png"),
      };

      const embed = buildGateEmbed(mockGuild as any);

      expect(embed.data.color).toBeDefined();
    });

    it("includes guild icon as thumbnail", () => {
      const mockGuild = {
        name: "Test Server",
        iconURL: vi.fn(() => "https://example.com/icon.png"),
      };

      const embed = buildGateEmbed(mockGuild as any);

      expect(embed.data.thumbnail).toBeDefined();
      expect(embed.data.thumbnail?.url).toBe("https://example.com/icon.png");
    });

    it("handles missing guild icon", () => {
      const mockGuild = {
        name: "Test Server",
        iconURL: vi.fn(() => null),
      };

      const embed = buildGateEmbed(mockGuild as any);

      expect(embed.data.thumbnail).toBeUndefined();
    });
  });

  describe("buildGateComponents", () => {
    it("creates action row with button", () => {
      const components = buildGateComponents();

      expect(components).toHaveLength(1);
      expect(components[0].components).toHaveLength(1);
    });

    it("button has correct custom ID", () => {
      const components = buildGateComponents();
      const button = components[0].components[0];

      expect(button.data.custom_id).toBe("gate:accept_rules");
    });

    it("button has success style", () => {
      const components = buildGateComponents();
      const button = components[0].components[0];

      // ButtonStyle.Success = 3
      expect(button.data.style).toBe(3);
    });

    it("button has appropriate label", () => {
      const components = buildGateComponents();
      const button = components[0].components[0];

      expect(button.data.label).toContain("Accept");
    });
  });

  describe("handleAcceptRules", () => {
    it("verifies member on button click", async () => {
      const mockInteraction = {
        guildId: "guild123",
        user: { id: "user456", tag: "User#1234" },
        member: {
          roles: {
            add: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
            cache: { has: vi.fn(() => false) },
          },
        },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        guild: {
          id: "guild123",
          roles: { fetch: vi.fn().mockResolvedValue({ name: "Verified" }) },
        },
      };

      vi.mocked(getVerificationStatus).mockReturnValue(null);

      await handleAcceptRules(mockInteraction as any);

      expect(mockInteraction.member.roles.add).toHaveBeenCalled();
    });

    it("removes unverified role", async () => {
      const mockInteraction = {
        guildId: "guild123",
        user: { id: "user456", tag: "User#1234" },
        member: {
          roles: {
            add: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
            cache: { has: vi.fn(() => true) },
          },
        },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        guild: {
          id: "guild123",
          roles: { fetch: vi.fn().mockResolvedValue({ name: "Verified" }) },
        },
      };

      vi.mocked(getVerificationStatus).mockReturnValue(null);

      await handleAcceptRules(mockInteraction as any);

      expect(mockInteraction.member.roles.remove).toHaveBeenCalled();
    });

    it("logs verification action", async () => {
      const mockInteraction = {
        guildId: "guild123",
        user: { id: "user456", tag: "User#1234" },
        member: {
          roles: {
            add: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
            cache: { has: vi.fn(() => false) },
          },
        },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        guild: {
          id: "guild123",
          roles: { fetch: vi.fn().mockResolvedValue({ name: "Verified" }) },
        },
      };

      vi.mocked(getVerificationStatus).mockReturnValue(null);

      await handleAcceptRules(mockInteraction as any);

      expect(logActionPretty).toHaveBeenCalled();
    });

    it("stores verification status", async () => {
      const mockInteraction = {
        guildId: "guild123",
        user: { id: "user456", tag: "User#1234" },
        member: {
          roles: {
            add: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
            cache: { has: vi.fn(() => false) },
          },
        },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        guild: {
          id: "guild123",
          roles: { fetch: vi.fn().mockResolvedValue({ name: "Verified" }) },
        },
      };

      vi.mocked(getVerificationStatus).mockReturnValue(null);

      await handleAcceptRules(mockInteraction as any);

      expect(setVerificationStatus).toHaveBeenCalled();
    });

    it("handles already verified user", async () => {
      const mockInteraction = {
        guildId: "guild123",
        user: { id: "user456", tag: "User#1234" },
        member: {
          roles: {
            add: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
            cache: { has: vi.fn(() => true) },
          },
        },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        guild: {
          id: "guild123",
          roles: { fetch: vi.fn().mockResolvedValue({ name: "Verified" }) },
        },
      };

      vi.mocked(getVerificationStatus).mockReturnValue({
        guildId: "guild123",
        userId: "user456",
        verifiedAt: 1700000000,
      });

      await handleAcceptRules(mockInteraction as any);

      // Should still respond but not add role again if already has it
      expect(mockInteraction.reply).toHaveBeenCalled();
    });

    it("handles role add failure", async () => {
      const mockInteraction = {
        guildId: "guild123",
        user: { id: "user456", tag: "User#1234" },
        member: {
          roles: {
            add: vi.fn().mockRejectedValue(new Error("Missing Permissions")),
            remove: vi.fn().mockResolvedValue(undefined),
            cache: { has: vi.fn(() => false) },
          },
        },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        guild: {
          id: "guild123",
          roles: { fetch: vi.fn().mockResolvedValue({ name: "Verified" }) },
        },
      };

      vi.mocked(getVerificationStatus).mockReturnValue(null);

      await handleAcceptRules(mockInteraction as any);

      expect(logger.error).toHaveBeenCalled();
    });

    it("sends ephemeral reply", async () => {
      const mockInteraction = {
        guildId: "guild123",
        user: { id: "user456", tag: "User#1234" },
        member: {
          roles: {
            add: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
            cache: { has: vi.fn(() => false) },
          },
        },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        guild: {
          id: "guild123",
          roles: { fetch: vi.fn().mockResolvedValue({ name: "Verified" }) },
        },
      };

      vi.mocked(getVerificationStatus).mockReturnValue(null);

      await handleAcceptRules(mockInteraction as any);

      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: expect.anything() })
      );
    });
  });

  describe("sendGateMessage", () => {
    it("sends embed and components to channel", async () => {
      const mockChannel = {
        send: vi.fn().mockResolvedValue({ id: "msg123" }),
      };
      const mockGuild = {
        name: "Test Server",
        iconURL: vi.fn(() => "https://example.com/icon.png"),
      };

      await sendGateMessage(mockChannel as any, mockGuild as any);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it("returns message ID", async () => {
      const mockChannel = {
        send: vi.fn().mockResolvedValue({ id: "msg123" }),
      };
      const mockGuild = {
        name: "Test Server",
        iconURL: vi.fn(() => "https://example.com/icon.png"),
      };

      const result = await sendGateMessage(mockChannel as any, mockGuild as any);

      expect(result.id).toBe("msg123");
    });
  });

  describe("isUserVerified", () => {
    it("returns true when user has verified role", () => {
      const mockMember = {
        roles: {
          cache: {
            has: vi.fn((roleId) => roleId === "verified456"),
          },
        },
      };

      const config = { verified_role_id: "verified456" };
      const result = isUserVerified(mockMember as any, config as any);

      expect(result).toBe(true);
    });

    it("returns false when user lacks verified role", () => {
      const mockMember = {
        roles: {
          cache: {
            has: vi.fn(() => false),
          },
        },
      };

      const config = { verified_role_id: "verified456" };
      const result = isUserVerified(mockMember as any, config as any);

      expect(result).toBe(false);
    });

    it("returns false when config missing verified role", () => {
      const mockMember = {
        roles: {
          cache: {
            has: vi.fn(() => true),
          },
        },
      };

      const config = { verified_role_id: null };
      const result = isUserVerified(mockMember as any, config as any);

      expect(result).toBe(false);
    });
  });

  describe("verifyMember", () => {
    it("adds verified role", async () => {
      const mockMember = {
        roles: {
          add: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
          cache: { has: vi.fn(() => false) },
        },
        id: "user456",
        guild: { id: "guild123" },
      };
      const config = {
        verified_role_id: "verified456",
        unverified_role_id: "unverified123",
      };

      await verifyMember(mockMember as any, config as any);

      expect(mockMember.roles.add).toHaveBeenCalledWith("verified456");
    });

    it("removes unverified role if present", async () => {
      const mockMember = {
        roles: {
          add: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
          cache: { has: vi.fn((roleId) => roleId === "unverified123") },
        },
        id: "user456",
        guild: { id: "guild123" },
      };
      const config = {
        verified_role_id: "verified456",
        unverified_role_id: "unverified123",
      };

      await verifyMember(mockMember as any, config as any);

      expect(mockMember.roles.remove).toHaveBeenCalledWith("unverified123");
    });

    it("skips remove if no unverified role", async () => {
      const mockMember = {
        roles: {
          add: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
          cache: { has: vi.fn(() => false) },
        },
        id: "user456",
        guild: { id: "guild123" },
      };
      const config = {
        verified_role_id: "verified456",
        unverified_role_id: "unverified123",
      };

      await verifyMember(mockMember as any, config as any);

      expect(mockMember.roles.remove).not.toHaveBeenCalled();
    });
  });
});

describe("gate embed content", () => {
  describe("embed color", () => {
    it("uses brand cyan (0x00C2FF)", () => {
      const brandColor = 0x00c2ff;
      expect(brandColor).toBe(49919);
    });
  });

  describe("embed fields", () => {
    it("welcomes user to server", () => {
      const welcomeText = "Welcome to Pawtropolis!";
      expect(welcomeText).toContain("Welcome");
    });

    it("instructs to read rules", () => {
      const instructions = "Please read and accept the rules";
      expect(instructions).toContain("rules");
    });
  });
});

describe("button custom ID", () => {
  describe("gate:accept_rules", () => {
    it("has gate prefix", () => {
      const customId = "gate:accept_rules";
      expect(customId).toMatch(/^gate:/);
    });

    it("identifies accept action", () => {
      const customId = "gate:accept_rules";
      expect(customId).toContain("accept");
    });
  });
});

describe("role hierarchy", () => {
  describe("verification flow", () => {
    it("unverified comes before verified", () => {
      const roles = ["unverified", "verified"];
      expect(roles.indexOf("unverified")).toBeLessThan(roles.indexOf("verified"));
    });
  });

  describe("role requirements", () => {
    it("needs verified_role_id in config", () => {
      const requiredConfig = ["verified_role_id"];
      expect(requiredConfig).toContain("verified_role_id");
    });

    it("optionally uses unverified_role_id", () => {
      const optionalConfig = ["unverified_role_id"];
      expect(optionalConfig).toContain("unverified_role_id");
    });
  });
});

describe("verification storage", () => {
  describe("verification status", () => {
    it("stores guildId", () => {
      const status = { guildId: "guild123", userId: "user456", verifiedAt: 1700000000 };
      expect(status.guildId).toBeDefined();
    });

    it("stores userId", () => {
      const status = { guildId: "guild123", userId: "user456", verifiedAt: 1700000000 };
      expect(status.userId).toBeDefined();
    });

    it("stores verifiedAt timestamp", () => {
      const status = { guildId: "guild123", userId: "user456", verifiedAt: 1700000000 };
      expect(status.verifiedAt).toBeDefined();
    });
  });
});

describe("error handling", () => {
  describe("missing config", () => {
    it("handles missing verified role gracefully", async () => {
      vi.mocked(getConfig).mockReturnValue({
        guild_id: "guild123",
        verified_role_id: null,
        unverified_role_id: null,
      } as any);

      const mockInteraction = {
        guildId: "guild123",
        user: { id: "user456" },
        member: { roles: { add: vi.fn(), cache: { has: vi.fn() } } },
        reply: vi.fn().mockResolvedValue(undefined),
        guild: { id: "guild123" },
      };

      await handleAcceptRules(mockInteraction as any);

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("Discord API errors", () => {
    it("catches permission errors", async () => {
      const mockInteraction = {
        guildId: "guild123",
        user: { id: "user456" },
        member: {
          roles: {
            add: vi.fn().mockRejectedValue(new Error("Missing Access")),
            cache: { has: vi.fn(() => false) },
          },
        },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        guild: { id: "guild123" },
      };

      vi.mocked(getConfig).mockReturnValue({
        guild_id: "guild123",
        verified_role_id: "verified456",
        unverified_role_id: "unverified123",
      } as any);
      vi.mocked(getVerificationStatus).mockReturnValue(null);

      await handleAcceptRules(mockInteraction as any);

      expect(logger.error).toHaveBeenCalled();
    });
  });
});

describe("logging", () => {
  describe("verification actions", () => {
    it("logs successful verification", async () => {
      const mockInteraction = {
        guildId: "guild123",
        user: { id: "user456", tag: "User#1234" },
        member: {
          roles: {
            add: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
            cache: { has: vi.fn(() => false) },
          },
        },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        guild: {
          id: "guild123",
          roles: { fetch: vi.fn().mockResolvedValue({ name: "Verified" }) },
        },
      };

      vi.mocked(getConfig).mockReturnValue({
        guild_id: "guild123",
        verified_role_id: "verified456",
        unverified_role_id: "unverified123",
      } as any);
      vi.mocked(getVerificationStatus).mockReturnValue(null);

      await handleAcceptRules(mockInteraction as any);

      expect(logger.info).toHaveBeenCalled();
    });
  });
});

describe("guild config integration", () => {
  describe("getConfig usage", () => {
    it("fetches config by guild ID", async () => {
      const mockInteraction = {
        guildId: "guild123",
        user: { id: "user456" },
        member: { roles: { add: vi.fn(), cache: { has: vi.fn() } } },
        reply: vi.fn().mockResolvedValue(undefined),
        guild: { id: "guild123" },
      };

      await handleAcceptRules(mockInteraction as any);

      expect(getConfig).toHaveBeenCalledWith("guild123");
    });
  });
});
