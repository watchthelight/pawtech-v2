/**
 * Pawtropolis Tech — tests/commands/listopen.test.ts
 * WHAT: Unit tests for /listopen command (view open applications).
 * WHY: Verify permission checks, pagination, scope filtering, and embed formatting.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { execute, data, invalidateDraftsCache } from "../../src/commands/listopen.js";
import { createTestCommandContext } from "../utils/contextFactory.js";
import { createMockInteraction, createMockGuild, createMockMember, createMockUser } from "../utils/discordMocks.js";
import type { Guild } from "discord.js";

// Mock the logger
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the database
vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => ({ count: 0 })),
    })),
  },
}));

// Mock config module
vi.mock("../../src/lib/config.js", () => ({
  postPermissionDenied: vi.fn(),
  shouldBypass: vi.fn(() => false),
  hasRole: vi.fn(() => true),
  ROLE_IDS: { GATEKEEPER: "gatekeeper-role-id" },
  GATEKEEPER_ONLY: ["gatekeeper-role-id"],
}));

// Mock the logging module
vi.mock("../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn().mockResolvedValue(undefined),
}));

// Mock ids module
vi.mock("../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(0, 8)),
}));

// Mock LRUCache
vi.mock("../../src/lib/lruCache.js", () => ({
  LRUCache: vi.fn().mockImplementation(() => ({
    get: vi.fn(() => null),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

describe("/listopen command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    invalidateDraftsCache("test-guild");
  });

  describe("data (slash command builder)", () => {
    it("has correct name and description", () => {
      expect(data.name).toBe("listopen");
      expect(data.description).toBe("List claimed applications that need review");
    });

    it("has optional scope option with correct choices", () => {
      const options = data.options;
      expect(options).toHaveLength(1);

      const scopeOption = options[0].toJSON();
      expect(scopeOption.name).toBe("scope");
      expect(scopeOption.required).toBe(false);
      expect(scopeOption.choices).toContainEqual({ name: "Mine (default)", value: "mine" });
      expect(scopeOption.choices).toContainEqual({ name: "All (claimed + unclaimed)", value: "all" });
      expect(scopeOption.choices).toContainEqual({ name: "Drafts (incomplete)", value: "drafts" });
    });

    it("is guild-only (no DM permission)", () => {
      expect(data.dm_permission).toBe(false);
    });
  });

  describe("execute", () => {
    it("rejects when used outside a guild", async () => {
      const interaction = createMockInteraction({
        guild: null as any,
        guildId: null as any,
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "❌ This command can only be used in a server.",
        ephemeral: true,
      });
    });

    it("denies access when user lacks gatekeeper role and no bypass", async () => {
      const { shouldBypass, hasRole, postPermissionDenied } = await import("../../src/lib/config.js");
      (shouldBypass as any).mockReturnValue(false);
      (hasRole as any).mockReturnValue(false);

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(postPermissionDenied).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({ command: "listopen" })
      );
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it("allows access for users with gatekeeper role", async () => {
      const { shouldBypass, hasRole } = await import("../../src/lib/config.js");
      (shouldBypass as any).mockReturnValue(false);
      (hasRole as any).mockReturnValue(true);

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getString: vi.fn().mockReturnValue(null), // Default to "mine"
          getSubcommand: vi.fn().mockReturnValue("default"),
          getSubcommandGroup: vi.fn().mockReturnValue(null),
        } as any,
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
    });

    it("allows access for users with bypass (bot owner)", async () => {
      const { shouldBypass, hasRole } = await import("../../src/lib/config.js");
      (shouldBypass as any).mockReturnValue(true);
      (hasRole as any).mockReturnValue(false);

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getString: vi.fn().mockReturnValue(null),
          getSubcommand: vi.fn().mockReturnValue("default"),
          getSubcommandGroup: vi.fn().mockReturnValue(null),
        } as any,
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.deferReply).toHaveBeenCalled();
    });

    it("shows empty state when no applications", async () => {
      const { shouldBypass, hasRole } = await import("../../src/lib/config.js");
      (shouldBypass as any).mockReturnValue(true);

      const { db } = await import("../../src/db/db.js");
      (db.prepare as any).mockReturnValue({
        all: vi.fn(() => []),
        get: vi.fn(() => ({ count: 0 })),
      });

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getString: vi.fn().mockReturnValue("mine"),
          getSubcommand: vi.fn().mockReturnValue("default"),
          getSubcommandGroup: vi.fn().mockReturnValue(null),
        } as any,
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                description: expect.stringContaining("no claimed applications"),
              }),
            }),
          ]),
        })
      );
    });

    it("logs different action for 'all' scope", async () => {
      const { shouldBypass } = await import("../../src/lib/config.js");
      (shouldBypass as any).mockReturnValue(true);

      const { logActionPretty } = await import("../../src/logging/pretty.js");

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getString: { scope: "all" },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(logActionPretty).toHaveBeenCalledWith(
        guild,
        expect.objectContaining({
          action: "listopen_view_all",
          meta: expect.objectContaining({ viewMode: "all" }),
        })
      );
    });

    it("logs different action for 'drafts' scope", async () => {
      const { shouldBypass } = await import("../../src/lib/config.js");
      (shouldBypass as any).mockReturnValue(true);

      const { logActionPretty } = await import("../../src/logging/pretty.js");

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getString: { scope: "drafts" },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(logActionPretty).toHaveBeenCalledWith(
        guild,
        expect.objectContaining({
          action: "listopen_view_drafts",
          meta: expect.objectContaining({ viewMode: "drafts" }),
        })
      );
    });

    it("handles database error gracefully", async () => {
      const { shouldBypass } = await import("../../src/lib/config.js");
      (shouldBypass as any).mockReturnValue(true);

      const { db } = await import("../../src/db/db.js");
      (db.prepare as any).mockReturnValue({
        all: vi.fn(() => {
          throw new Error("Database error");
        }),
        get: vi.fn(() => ({ count: 0 })),
      });

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getString: vi.fn().mockReturnValue("mine"),
          getSubcommand: vi.fn().mockReturnValue("default"),
          getSubcommandGroup: vi.fn().mockReturnValue(null),
        } as any,
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to fetch"),
      });
    });

    it("logs action after successful query", async () => {
      const { shouldBypass } = await import("../../src/lib/config.js");
      (shouldBypass as any).mockReturnValue(true);

      const { logActionPretty } = await import("../../src/logging/pretty.js");

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getString: vi.fn().mockReturnValue("mine"),
          getSubcommand: vi.fn().mockReturnValue("default"),
          getSubcommandGroup: vi.fn().mockReturnValue(null),
        } as any,
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(logActionPretty).toHaveBeenCalledWith(
        guild,
        expect.objectContaining({
          action: "listopen_view",
          meta: expect.objectContaining({ viewMode: "mine" }),
        })
      );
    });
  });

  describe("invalidateDraftsCache", () => {
    it("can be called without error", () => {
      invalidateDraftsCache("test-guild-123");
      // No error means success
    });
  });
});
