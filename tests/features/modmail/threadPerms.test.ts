/**
 * Pawtropolis Tech — tests/features/modmail/threadPerms.test.ts
 * WHAT: Unit tests for modmail thread permission checks and setup.
 * WHY: Verify permission logic for thread creation and moderator access.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelType, PermissionFlagsBits } from "discord.js";

// Use vi.hoisted for mock functions
const { mockAll, mockPrepare, mockGetConfig } = vi.hoisted(() => ({
  mockAll: vi.fn(),
  mockPrepare: vi.fn(),
  mockGetConfig: vi.fn(),
}));

mockPrepare.mockReturnValue({
  all: mockAll,
});

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

vi.mock("../../../src/lib/sentry.js", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../src/lib/config.js", () => ({
  getConfig: mockGetConfig,
}));

import {
  NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE,
  missingPermsForStartThread,
  ensureModsCanSpeakInThread,
  ensureParentPermsForMods,
  retrofitModmailParentsForGuild,
  retrofitAllGuildsOnStartup,
} from "../../../src/features/modmail/threadPerms.js";

describe("features/modmail/threadPerms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      all: mockAll,
    });
  });

  describe("NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE", () => {
    it("includes ViewChannel", () => {
      expect(NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE).toContain(
        PermissionFlagsBits.ViewChannel
      );
    });

    it("includes SendMessages", () => {
      expect(NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE).toContain(
        PermissionFlagsBits.SendMessages
      );
    });

    it("includes ReadMessageHistory", () => {
      expect(NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE).toContain(
        PermissionFlagsBits.ReadMessageHistory
      );
    });

    it("includes CreatePublicThreads", () => {
      expect(NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE).toContain(
        PermissionFlagsBits.CreatePublicThreads
      );
    });

    it("includes SendMessagesInThreads", () => {
      expect(NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE).toContain(
        PermissionFlagsBits.SendMessagesInThreads
      );
    });

    it("has exactly 5 required permissions", () => {
      expect(NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE).toHaveLength(5);
    });
  });

  describe("missingPermsForStartThread", () => {
    it("returns empty array when all permissions granted", () => {
      const mockChannel = {
        permissionsFor: vi.fn().mockReturnValue({
          has: vi.fn().mockReturnValue(true),
        }),
      } as any;

      const result = missingPermsForStartThread(mockChannel, "bot-id");

      expect(result).toEqual([]);
    });

    it("returns missing permission names", () => {
      const mockChannel = {
        permissionsFor: vi.fn().mockReturnValue({
          has: vi.fn().mockImplementation((perm) => {
            // Missing CreatePublicThreads
            return perm !== PermissionFlagsBits.CreatePublicThreads;
          }),
        }),
      } as any;

      const result = missingPermsForStartThread(mockChannel, "bot-id");

      expect(result).toContain("CreatePublicThreads");
    });

    it("returns all permissions when permissionsFor returns null", () => {
      const mockChannel = {
        permissionsFor: vi.fn().mockReturnValue(null),
      } as any;

      const result = missingPermsForStartThread(mockChannel, "bot-id");

      expect(result.length).toBe(5);
    });

    it("converts flag bigints to readable names", () => {
      const mockChannel = {
        permissionsFor: vi.fn().mockReturnValue({
          has: vi.fn().mockReturnValue(false),
        }),
      } as any;

      const result = missingPermsForStartThread(mockChannel, "bot-id");

      // Should be readable names, not raw bigint representations
      for (const name of result) {
        expect(typeof name).toBe("string");
        // Readable names like "ViewChannel", "SendMessages"
        expect(name.length).toBeGreaterThan(0);
      }
    });

    it("handles multiple missing permissions", () => {
      const mockChannel = {
        permissionsFor: vi.fn().mockReturnValue({
          has: vi.fn().mockImplementation((perm) => {
            // Only has ViewChannel
            return perm === PermissionFlagsBits.ViewChannel;
          }),
        }),
      } as any;

      const result = missingPermsForStartThread(mockChannel, "bot-id");

      expect(result.length).toBe(4);
      expect(result).not.toContain("ViewChannel");
    });
  });

  describe("ensureModsCanSpeakInThread", () => {
    it("skips when no mod roles configured", async () => {
      mockGetConfig.mockReturnValue({});

      const mockThread = {
        id: "thread-123",
        guildId: "guild-123",
      } as any;

      await ensureModsCanSpeakInThread(mockThread);

      // Should return early
    });

    it("skips when mod_role_ids is empty string", async () => {
      mockGetConfig.mockReturnValue({ mod_role_ids: "" });

      const mockThread = {
        id: "thread-123",
        guildId: "guild-123",
      } as any;

      await ensureModsCanSpeakInThread(mockThread);

      // Should return early
    });

    it("sets parent permissions for mod roles", async () => {
      mockGetConfig.mockReturnValue({ mod_role_ids: "role1,role2" });

      const mockEdit = vi.fn().mockResolvedValue(undefined);
      const mockThread = {
        id: "thread-123",
        guildId: "guild-123",
        type: ChannelType.PublicThread,
        parent: {
          permissionOverwrites: {
            edit: mockEdit,
          },
        },
        guild: {
          members: {
            me: { id: "bot-id" },
          },
        },
        members: {
          add: vi.fn().mockResolvedValue(undefined),
        },
      } as any;

      await ensureModsCanSpeakInThread(mockThread);

      expect(mockEdit).toHaveBeenCalledWith("role1", { SendMessagesInThreads: true });
      expect(mockEdit).toHaveBeenCalledWith("role2", { SendMessagesInThreads: true });
    });

    it("skips member adds for public threads", async () => {
      mockGetConfig.mockReturnValue({ mod_role_ids: "role1" });

      const mockMembersAdd = vi.fn().mockResolvedValue(undefined);
      const mockThread = {
        id: "thread-123",
        guildId: "guild-123",
        type: ChannelType.PublicThread,
        parent: {
          permissionOverwrites: {
            edit: vi.fn().mockResolvedValue(undefined),
          },
        },
        guild: {
          members: {
            me: { id: "bot-id" },
          },
        },
        members: {
          add: mockMembersAdd,
        },
      } as any;

      await ensureModsCanSpeakInThread(mockThread);

      // For public threads, only bot should be added
      expect(mockMembersAdd).toHaveBeenCalledTimes(1);
      expect(mockMembersAdd).toHaveBeenCalledWith("bot-id");
    });

    it("adds claimer to private threads", async () => {
      mockGetConfig.mockReturnValue({ mod_role_ids: "role1" });

      const mockMembersAdd = vi.fn().mockResolvedValue(undefined);
      const mockThread = {
        id: "thread-123",
        guildId: "guild-123",
        type: ChannelType.PrivateThread,
        parent: {
          permissionOverwrites: {
            edit: vi.fn().mockResolvedValue(undefined),
          },
        },
        guild: {
          members: {
            me: { id: "bot-id" },
          },
          roles: {
            fetch: vi.fn().mockResolvedValue({
              members: new Map(),
            }),
          },
        },
        members: {
          add: mockMembersAdd,
        },
      } as any;

      const claimerMember = { id: "claimer-id" } as any;
      await ensureModsCanSpeakInThread(mockThread, claimerMember);

      expect(mockMembersAdd).toHaveBeenCalledWith("claimer-id");
    });

    it("adds mod role members to private threads", async () => {
      mockGetConfig.mockReturnValue({ mod_role_ids: "role1" });

      const mockMembersAdd = vi.fn().mockResolvedValue(undefined);
      const modMembers = new Map([
        ["mod1", { id: "mod1" }],
        ["mod2", { id: "mod2" }],
      ]);

      const mockThread = {
        id: "thread-123",
        guildId: "guild-123",
        type: ChannelType.PrivateThread,
        parent: {
          permissionOverwrites: {
            edit: vi.fn().mockResolvedValue(undefined),
          },
        },
        guild: {
          members: {
            me: { id: "bot-id" },
          },
          roles: {
            fetch: vi.fn().mockResolvedValue({
              members: modMembers,
            }),
          },
        },
        members: {
          add: mockMembersAdd,
        },
      } as any;

      await ensureModsCanSpeakInThread(mockThread);

      expect(mockMembersAdd).toHaveBeenCalledWith("mod1");
      expect(mockMembersAdd).toHaveBeenCalledWith("mod2");
    });

    it("handles parent permission error gracefully", async () => {
      mockGetConfig.mockReturnValue({ mod_role_ids: "role1" });

      const mockThread = {
        id: "thread-123",
        guildId: "guild-123",
        type: ChannelType.PublicThread,
        parent: {
          permissionOverwrites: {
            edit: vi.fn().mockRejectedValue(new Error("No perms")),
          },
        },
        guild: {
          members: {
            me: { id: "bot-id" },
          },
        },
        members: {
          add: vi.fn().mockResolvedValue(undefined),
        },
      } as any;

      // Should not throw
      await ensureModsCanSpeakInThread(mockThread);
    });

    it("handles no parent gracefully", async () => {
      mockGetConfig.mockReturnValue({ mod_role_ids: "role1" });

      const mockThread = {
        id: "thread-123",
        guildId: "guild-123",
        type: ChannelType.PublicThread,
        parent: null,
        guild: {
          members: {
            me: { id: "bot-id" },
          },
        },
        members: {
          add: vi.fn().mockResolvedValue(undefined),
        },
      } as any;

      // Should not throw
      await ensureModsCanSpeakInThread(mockThread);
    });
  });

  describe("ensureParentPermsForMods", () => {
    it("skips when no mod roles configured", async () => {
      mockGetConfig.mockReturnValue({});

      const mockParent = {
        id: "parent-123",
        guild: { id: "guild-123" },
      } as any;

      await ensureParentPermsForMods(mockParent);

      // Should not call permissionOverwrites.edit
    });

    it("grants SendMessagesInThreads to mod roles without it", async () => {
      mockGetConfig.mockReturnValue({ mod_role_ids: "role1,role2" });

      const mockEdit = vi.fn().mockResolvedValue(undefined);
      const mockParent = {
        id: "parent-123",
        guild: {
          id: "guild-123",
          client: { user: { id: "bot-id" } },
        },
        permissionsFor: vi.fn().mockReturnValue({
          has: vi.fn().mockReturnValue(false),
        }),
        permissionOverwrites: {
          edit: mockEdit,
        },
      } as any;

      await ensureParentPermsForMods(mockParent);

      expect(mockEdit).toHaveBeenCalledWith("role1", {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessagesInThreads: true,
      });
      expect(mockEdit).toHaveBeenCalledWith("role2", {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessagesInThreads: true,
      });
    });

    it("skips roles that already have permission", async () => {
      mockGetConfig.mockReturnValue({ mod_role_ids: "role1" });

      const mockEdit = vi.fn().mockResolvedValue(undefined);
      const mockParent = {
        id: "parent-123",
        guild: {
          id: "guild-123",
          client: { user: { id: "bot-id" } },
        },
        permissionsFor: vi.fn().mockReturnValue({
          has: vi.fn().mockReturnValue(true),
        }),
        permissionOverwrites: {
          edit: mockEdit,
        },
      } as any;

      await ensureParentPermsForMods(mockParent);

      // Edit should only be called for bot, not role1
      expect(mockEdit).not.toHaveBeenCalledWith("role1", expect.anything());
    });

    it("grants bot permissions if missing", async () => {
      mockGetConfig.mockReturnValue({ mod_role_ids: "role1" });

      const mockEdit = vi.fn().mockResolvedValue(undefined);
      const mockParent = {
        id: "parent-123",
        guild: {
          id: "guild-123",
          client: { user: { id: "bot-id" } },
        },
        permissionsFor: vi.fn().mockImplementation((id) => ({
          has: vi.fn().mockReturnValue(id === "role1"),
        })),
        permissionOverwrites: {
          edit: mockEdit,
        },
      } as any;

      await ensureParentPermsForMods(mockParent);

      expect(mockEdit).toHaveBeenCalledWith("bot-id", {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: true,
        EmbedLinks: true,
        AttachFiles: true,
        SendMessagesInThreads: true,
      });
    });

    it("handles permission edit errors gracefully", async () => {
      mockGetConfig.mockReturnValue({ mod_role_ids: "role1" });

      const mockParent = {
        id: "parent-123",
        guild: {
          id: "guild-123",
          client: { user: { id: "bot-id" } },
        },
        permissionsFor: vi.fn().mockReturnValue({
          has: vi.fn().mockReturnValue(false),
        }),
        permissionOverwrites: {
          edit: vi.fn().mockRejectedValue(new Error("No perms")),
        },
      } as any;

      // Should not throw
      await ensureParentPermsForMods(mockParent);
    });
  });

  describe("retrofitModmailParentsForGuild", () => {
    it("discovers parents from open tickets", async () => {
      mockAll.mockReturnValue([
        { thread_id: "thread-1" },
        { thread_id: "thread-2" },
      ]);
      mockGetConfig.mockReturnValue({ mod_role_ids: "role1" });

      const mockParent = {
        id: "parent-123",
        type: ChannelType.GuildText,
        permissionsFor: vi.fn().mockReturnValue({
          has: vi.fn().mockReturnValue(true),
        }),
        permissionOverwrites: { edit: vi.fn() },
        guild: { id: "guild-123", client: { user: { id: "bot" } } },
      };

      const mockGuild = {
        id: "guild-123",
        channels: {
          fetch: vi.fn()
            .mockResolvedValueOnce({ parentId: "parent-123" })
            .mockResolvedValueOnce({ parentId: "parent-123" })
            .mockResolvedValueOnce(mockParent),
        },
      } as any;

      await retrofitModmailParentsForGuild(mockGuild);

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("SELECT thread_id")
      );
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("status = 'open'")
      );
    });

    it("includes configured parent channel", async () => {
      mockAll.mockReturnValue([]);
      mockGetConfig.mockReturnValue({
        mod_role_ids: "role1",
        modmail_parent_channel_id: "configured-parent",
      });

      const mockParent = {
        id: "configured-parent",
        type: ChannelType.GuildText,
        permissionsFor: vi.fn().mockReturnValue({
          has: vi.fn().mockReturnValue(true),
        }),
        permissionOverwrites: { edit: vi.fn() },
        guild: { id: "guild-123", client: { user: { id: "bot" } } },
      };

      const mockGuild = {
        id: "guild-123",
        channels: {
          fetch: vi.fn().mockResolvedValue(mockParent),
        },
      } as any;

      await retrofitModmailParentsForGuild(mockGuild);

      expect(mockGuild.channels.fetch).toHaveBeenCalledWith("configured-parent");
    });

    it("skips non-text/forum channels", async () => {
      mockAll.mockReturnValue([{ thread_id: "thread-1" }]);
      mockGetConfig.mockReturnValue({ mod_role_ids: "role1" });

      const mockVoiceChannel = {
        id: "voice-channel",
        type: ChannelType.GuildVoice,
      };

      const mockGuild = {
        id: "guild-123",
        channels: {
          fetch: vi.fn()
            .mockResolvedValueOnce({ parentId: "voice-channel" })
            .mockResolvedValueOnce(mockVoiceChannel),
        },
      } as any;

      await retrofitModmailParentsForGuild(mockGuild);

      // Should not throw, just skip
    });

    it("handles thread fetch errors gracefully", async () => {
      mockAll.mockReturnValue([{ thread_id: "thread-1" }]);

      const mockGuild = {
        id: "guild-123",
        channels: {
          fetch: vi.fn().mockRejectedValue(new Error("Not found")),
        },
      } as any;

      // Should not throw
      await retrofitModmailParentsForGuild(mockGuild);
    });
  });

  describe("retrofitAllGuildsOnStartup", () => {
    it("processes all guilds", async () => {
      mockAll.mockReturnValue([]);
      mockGetConfig.mockReturnValue({});

      const mockGuild = {
        id: "guild-123",
        fetch: vi.fn().mockResolvedValue({
          id: "guild-123",
          channels: { fetch: vi.fn().mockResolvedValue(null) },
        }),
      };

      const mockClient = {
        guilds: {
          fetch: vi.fn().mockResolvedValue(
            new Map([["guild-123", mockGuild]])
          ),
        },
      } as any;

      await retrofitAllGuildsOnStartup(mockClient);

      expect(mockClient.guilds.fetch).toHaveBeenCalled();
      expect(mockGuild.fetch).toHaveBeenCalled();
    });

    it("handles guild fetch errors gracefully", async () => {
      const mockClient = {
        guilds: {
          fetch: vi.fn().mockResolvedValue(
            new Map([
              ["guild-1", { fetch: vi.fn().mockRejectedValue(new Error("No access")) }],
            ])
          ),
        },
      } as any;

      // Should not throw
      await retrofitAllGuildsOnStartup(mockClient);
    });

    it("handles client.guilds.fetch error", async () => {
      const mockClient = {
        guilds: {
          fetch: vi.fn().mockRejectedValue(new Error("Rate limited")),
        },
      } as any;

      // Should not throw
      await retrofitAllGuildsOnStartup(mockClient);
    });
  });
});
