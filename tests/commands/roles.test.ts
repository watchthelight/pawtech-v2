/**
 * Pawtropolis Tech — tests/commands/roles.test.ts
 * WHAT: Unit tests for /roles command (role automation configuration).
 * WHY: Verify permission checks, CRUD operations, and role management.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi } from "vitest";
import { execute, data } from "../../src/commands/roles.js";
import { createTestCommandContext } from "../utils/contextFactory.js";
import { createMockInteraction, createMockGuild, createMockRole, createMockMember } from "../utils/discordMocks.js";
import type { ChatInputCommandInteraction, Guild, GuildMember, Role } from "discord.js";

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
      run: vi.fn(() => ({ changes: 1 })),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
  },
}));

// Mock roleAutomation
vi.mock("../../src/features/roleAutomation.js", () => ({
  getRoleTiers: vi.fn(() => []),
  canManageRoleSync: vi.fn(() => ({ canManage: true })),
}));

describe("/roles command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("data (slash command builder)", () => {
    it("has correct name and description", () => {
      expect(data.name).toBe("roles");
      expect(data.description).toBe("Configure role automation settings");
    });

    it("has all required subcommands", () => {
      const json = data.toJSON();
      const subcommands = json.options?.filter((o: any) => o.type === 1); // Type 1 = SUBCOMMAND
      const subcommandNames = subcommands?.map((s: any) => s.name);

      expect(subcommandNames).toContain("add-level-tier");
      expect(subcommandNames).toContain("add-level-reward");
      expect(subcommandNames).toContain("add-movie-tier");
      expect(subcommandNames).toContain("add-game-tier");
      expect(subcommandNames).toContain("list");
      expect(subcommandNames).toContain("remove-level-tier");
      expect(subcommandNames).toContain("remove-level-reward");
      expect(subcommandNames).toContain("remove-movie-tier");
      expect(subcommandNames).toContain("remove-game-tier");
    });
  });

  describe("execute", () => {
    it("rejects when used outside a guild", async () => {
      const interaction = createMockInteraction({
        guild: null as any,
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
    });

    it("rejects when user lacks ManageRoles permission", async () => {
      const guild = createMockGuild({ id: "guild-123" });
      const member = createMockMember({ id: "user-123" }) as GuildMember;
      (member.permissions as any) = {
        has: vi.fn().mockReturnValue(false),
      };

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: member,
        options: {
          getSubcommand: "list",
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("Manage Roles"),
        ephemeral: true,
      });
    });

    describe("subcommand: add-level-tier", () => {
      it("adds a level tier successfully", async () => {
        const { canManageRoleSync } = await import("../../src/features/roleAutomation.js");
        (canManageRoleSync as any).mockReturnValue({ canManage: true });

        const guild = createMockGuild({ id: "guild-123" });
        const role = createMockRole({ id: "role-123", name: "Level 10" });
        const member = createMockMember({ id: "user-123" }) as GuildMember;
        (member.permissions as any) = { has: vi.fn().mockReturnValue(true) };

        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          member: member,
          options: {
            getSubcommand: "add-level-tier",
            getInteger: { level: 10 },
            getRole: { role: role },
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining("Mapped level **10**"),
          ephemeral: true,
        });
      });

      it("rejects when bot cannot manage the role", async () => {
        const { canManageRoleSync } = await import("../../src/features/roleAutomation.js");
        (canManageRoleSync as any).mockReturnValue({
          canManage: false,
          reason: "Role is higher than bot's highest role",
        });

        const guild = createMockGuild({ id: "guild-123" });
        const role = createMockRole({ id: "role-123", name: "Admin" });
        const member = createMockMember({ id: "user-123" }) as GuildMember;
        (member.permissions as any) = { has: vi.fn().mockReturnValue(true) };

        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          member: member,
          options: {
            getSubcommand: "add-level-tier",
            getInteger: { level: 50 },
            getRole: { role: role },
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining("Cannot configure this role"),
          ephemeral: true,
        });
      });
    });

    describe("subcommand: add-level-reward", () => {
      it("adds a level reward successfully", async () => {
        const { canManageRoleSync } = await import("../../src/features/roleAutomation.js");
        (canManageRoleSync as any).mockReturnValue({ canManage: true });

        const guild = createMockGuild({ id: "guild-123" });
        const role = createMockRole({ id: "role-reward", name: "Reward Token" });
        const member = createMockMember({ id: "user-123" }) as GuildMember;
        (member.permissions as any) = { has: vi.fn().mockReturnValue(true) };

        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          member: member,
          options: {
            getSubcommand: "add-level-reward",
            getInteger: { level: 5 },
            getRole: { role: role },
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining("Added reward **Reward Token**"),
          ephemeral: true,
        });
      });
    });

    describe("subcommand: add-movie-tier", () => {
      it("adds a movie tier successfully", async () => {
        const { canManageRoleSync } = await import("../../src/features/roleAutomation.js");
        (canManageRoleSync as any).mockReturnValue({ canManage: true });

        const guild = createMockGuild({ id: "guild-123" });
        const role = createMockRole({ id: "role-movie", name: "Popcorn Club" });
        const member = createMockMember({ id: "user-123" }) as GuildMember;
        (member.permissions as any) = { has: vi.fn().mockReturnValue(true) };

        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          member: member,
          options: {
            getSubcommand: "add-movie-tier",
            getString: { tier_name: "Popcorn Club" },
            getRole: { role: role },
            getInteger: { movies_required: 5 },
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining("Added movie tier **Popcorn Club**"),
          ephemeral: true,
        });
      });
    });

    describe("subcommand: add-game-tier", () => {
      it("adds a game tier successfully", async () => {
        const { canManageRoleSync } = await import("../../src/features/roleAutomation.js");
        (canManageRoleSync as any).mockReturnValue({ canManage: true });

        const guild = createMockGuild({ id: "guild-123" });
        const role = createMockRole({ id: "role-game", name: "Game Champion" });
        const member = createMockMember({ id: "user-123" }) as GuildMember;
        (member.permissions as any) = { has: vi.fn().mockReturnValue(true) };

        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          member: member,
          options: {
            getSubcommand: "add-game-tier",
            getString: { tier_name: "Game Champion" },
            getRole: { role: role },
            getInteger: { games_required: 10 },
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining("Added game tier **Game Champion**"),
          ephemeral: true,
        });
      });
    });

    describe("subcommand: list", () => {
      it("shows configured role mappings", async () => {
        const { getRoleTiers } = await import("../../src/features/roleAutomation.js");
        (getRoleTiers as any).mockReturnValue([
          { tier_name: "Level 10", role_id: "role-1", threshold: 10 },
        ]);

        const guild = createMockGuild({ id: "guild-123" });
        (guild.roles.cache.get as any) = vi.fn().mockReturnValue(
          createMockRole({ id: "role-1", name: "Level 10" })
        );
        (guild as any).members = {
          me: createMockMember({
            roles: { highest: { position: 10, name: "Bot Role" } } as any,
          }),
        };

        const member = createMockMember({ id: "user-123" }) as GuildMember;
        (member.permissions as any) = { has: vi.fn().mockReturnValue(true) };

        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          member: member,
          options: {
            getSubcommand: "list",
            getString: { type: null },
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
        expect(interaction.editReply).toHaveBeenCalled();
      });

      it("filters by type when provided", async () => {
        const { getRoleTiers } = await import("../../src/features/roleAutomation.js");
        (getRoleTiers as any).mockReturnValue([]);

        const guild = createMockGuild({ id: "guild-123" });
        (guild as any).members = {
          me: createMockMember({
            roles: { highest: { position: 10, name: "Bot Role" } } as any,
          }),
        };

        const member = createMockMember({ id: "user-123" }) as GuildMember;
        (member.permissions as any) = { has: vi.fn().mockReturnValue(true) };

        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          member: member,
          options: {
            getSubcommand: "list",
            getString: { type: "level" },
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        expect(getRoleTiers).toHaveBeenCalledWith("guild-123", "level");
      });
    });

    describe("subcommand: remove-level-tier", () => {
      it("removes a level tier successfully", async () => {
        const { db } = await import("../../src/db/db.js");
        const mockRun = vi.fn(() => ({ changes: 1 }));
        (db.prepare as any).mockReturnValue({ run: mockRun });

        const guild = createMockGuild({ id: "guild-123" });
        const member = createMockMember({ id: "user-123" }) as GuildMember;
        (member.permissions as any) = { has: vi.fn().mockReturnValue(true) };

        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          member: member,
          options: {
            getSubcommand: "remove-level-tier",
            getInteger: { level: 10 },
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining("Removed level tier for level **10**"),
          ephemeral: true,
        });
      });

      it("reports when level tier not found", async () => {
        const { db } = await import("../../src/db/db.js");
        const mockRun = vi.fn(() => ({ changes: 0 }));
        (db.prepare as any).mockReturnValue({ run: mockRun });

        const guild = createMockGuild({ id: "guild-123" });
        const member = createMockMember({ id: "user-123" }) as GuildMember;
        (member.permissions as any) = { has: vi.fn().mockReturnValue(true) };

        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          member: member,
          options: {
            getSubcommand: "remove-level-tier",
            getInteger: { level: 99 },
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining("No level tier found"),
          ephemeral: true,
        });
      });
    });

    describe("subcommand: remove-movie-tier", () => {
      it("removes a movie tier successfully", async () => {
        const { db } = await import("../../src/db/db.js");
        const mockRun = vi.fn(() => ({ changes: 1 }));
        (db.prepare as any).mockReturnValue({ run: mockRun });

        const guild = createMockGuild({ id: "guild-123" });
        const member = createMockMember({ id: "user-123" }) as GuildMember;
        (member.permissions as any) = { has: vi.fn().mockReturnValue(true) };

        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          member: member,
          options: {
            getSubcommand: "remove-movie-tier",
            getString: { tier_name: "Popcorn Club" },
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining("Removed movie tier **Popcorn Club**"),
          ephemeral: true,
        });
      });
    });

    describe("subcommand: remove-game-tier", () => {
      it("removes a game tier successfully", async () => {
        const { db } = await import("../../src/db/db.js");
        const mockRun = vi.fn(() => ({ changes: 1 }));
        (db.prepare as any).mockReturnValue({ run: mockRun });

        const guild = createMockGuild({ id: "guild-123" });
        const member = createMockMember({ id: "user-123" }) as GuildMember;
        (member.permissions as any) = { has: vi.fn().mockReturnValue(true) };

        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          member: member,
          options: {
            getSubcommand: "remove-game-tier",
            getString: { tier_name: "Game Champion" },
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining("Removed game tier **Game Champion**"),
          ephemeral: true,
        });
      });
    });

    it("handles unknown subcommand gracefully", async () => {
      const guild = createMockGuild({ id: "guild-123" });
      const member = createMockMember({ id: "user-123" }) as GuildMember;
      (member.permissions as any) = { has: vi.fn().mockReturnValue(true) };

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: member,
        options: {
          getSubcommand: "unknown-subcommand",
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "Unknown subcommand.",
        ephemeral: true,
      });
    });
  });
});
