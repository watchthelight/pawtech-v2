/**
 * Pawtropolis Tech — tests/commands/search.test.ts
 * WHAT: Unit tests for /search command (application history search).
 * WHY: Verify permission checks, user resolution, rate limiting, and result formatting.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { execute, data } from "../../src/commands/search.js";
import { createTestCommandContext } from "../utils/contextFactory.js";
import { createMockInteraction, createMockGuild, createMockMember, createMockUser } from "../utils/discordMocks.js";
import type { Guild, User } from "discord.js";

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
      get: vi.fn(() => ({ total: 0 })),
    })),
  },
}));

// Mock config module
vi.mock("../../src/lib/config.js", () => ({
  hasStaffPermissions: vi.fn(() => true),
  isReviewer: vi.fn(() => false),
}));

// Mock owner module
vi.mock("../../src/lib/owner.js", () => ({
  isOwner: vi.fn(() => false),
}));

// Mock rate limiter
vi.mock("../../src/lib/rateLimiter.js", () => ({
  checkCooldown: vi.fn(() => ({ allowed: true })),
  formatCooldown: vi.fn((ms: number) => `${Math.ceil(ms / 1000)}s`),
  COOLDOWNS: { SEARCH_MS: 30000 },
}));

// Mock ids module
vi.mock("../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(0, 8)),
}));

describe("/search command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("data (slash command builder)", () => {
    it("has correct name and description", () => {
      expect(data.name).toBe("search");
      expect(data.description).toBe("Search for a user's application history");
    });

    it("has optional user option", () => {
      const options = data.options;
      const userOption = options.find((o: any) => o.toJSON().name === "user");
      expect(userOption).toBeDefined();
      expect(userOption!.toJSON().required).toBe(false);
    });

    it("has optional query string option", () => {
      const options = data.options;
      const queryOption = options.find((o: any) => o.toJSON().name === "query");
      expect(queryOption).toBeDefined();
      expect(queryOption!.toJSON().required).toBe(false);
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

    it("denies access when user lacks permissions", async () => {
      const { hasStaffPermissions, isReviewer } = await import("../../src/lib/config.js");
      const { isOwner } = await import("../../src/lib/owner.js");
      (hasStaffPermissions as any).mockReturnValue(false);
      (isReviewer as any).mockReturnValue(false);
      (isOwner as any).mockReturnValue(false);

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getUser: vi.fn().mockReturnValue(createMockUser({})),
          getString: vi.fn().mockReturnValue(null),
        } as any,
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("don't have permission"),
        ephemeral: true,
      });
    });

    it("allows access for staff members and defers reply", async () => {
      const { hasStaffPermissions } = await import("../../src/lib/config.js");
      const { isOwner } = await import("../../src/lib/owner.js");
      const { checkCooldown } = await import("../../src/lib/rateLimiter.js");
      (hasStaffPermissions as any).mockReturnValue(true);
      (isOwner as any).mockReturnValue(false);
      (checkCooldown as any).mockReturnValue({ allowed: true });

      const targetUser = createMockUser({ id: "target-123", username: "targetuser", tag: "targetuser#0" });

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getUser: { user: targetUser },
          getString: { query: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
    });

    it("allows access for reviewers", async () => {
      const { hasStaffPermissions, isReviewer } = await import("../../src/lib/config.js");
      const { isOwner } = await import("../../src/lib/owner.js");
      const { checkCooldown } = await import("../../src/lib/rateLimiter.js");
      (hasStaffPermissions as any).mockReturnValue(false);
      (isReviewer as any).mockReturnValue(true);
      (isOwner as any).mockReturnValue(false);
      (checkCooldown as any).mockReturnValue({ allowed: true });

      const targetUser = createMockUser({ id: "target-123" });

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getUser: { user: targetUser },
          getString: { query: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.deferReply).toHaveBeenCalled();
    });

    it("allows access for owners", async () => {
      const { hasStaffPermissions, isReviewer } = await import("../../src/lib/config.js");
      const { isOwner } = await import("../../src/lib/owner.js");
      const { checkCooldown } = await import("../../src/lib/rateLimiter.js");
      (hasStaffPermissions as any).mockReturnValue(false);
      (isReviewer as any).mockReturnValue(false);
      (isOwner as any).mockReturnValue(true);
      (checkCooldown as any).mockReturnValue({ allowed: true });

      const targetUser = createMockUser({ id: "target-123" });

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getUser: { user: targetUser },
          getString: { query: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.deferReply).toHaveBeenCalled();
    });

    it("enforces rate limiting", async () => {
      const { hasStaffPermissions } = await import("../../src/lib/config.js");
      (hasStaffPermissions as any).mockReturnValue(true);

      const { checkCooldown } = await import("../../src/lib/rateLimiter.js");
      (checkCooldown as any).mockReturnValue({ allowed: false, remainingMs: 15000 });

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getUser: vi.fn(() => createMockUser({})),
          getString: vi.fn(() => null),
          getBoolean: vi.fn(),
          getInteger: vi.fn(),
          getSubcommand: vi.fn(),
          getSubcommandGroup: vi.fn(),
        } as any,
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("cooldown"),
        ephemeral: true,
      });
    });

    it("requires at least one search parameter", async () => {
      const { hasStaffPermissions } = await import("../../src/lib/config.js");
      (hasStaffPermissions as any).mockReturnValue(true);

      const { checkCooldown } = await import("../../src/lib/rateLimiter.js");
      (checkCooldown as any).mockReturnValue({ allowed: true });

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getUser: vi.fn(() => null),
          getString: vi.fn(() => null),
          getBoolean: vi.fn(),
          getInteger: vi.fn(),
          getSubcommand: vi.fn(),
          getSubcommandGroup: vi.fn(),
        } as any,
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("Please provide either a user or a search query"),
        ephemeral: true,
      });
    });

    it("searches by user when provided", async () => {
      const { hasStaffPermissions } = await import("../../src/lib/config.js");
      (hasStaffPermissions as any).mockReturnValue(true);

      const { checkCooldown } = await import("../../src/lib/rateLimiter.js");
      (checkCooldown as any).mockReturnValue({ allowed: true });

      const { db } = await import("../../src/db/db.js");
      (db.prepare as any).mockReturnValue({
        all: vi.fn(() => []),
        get: vi.fn(() => ({ total: 0 })),
      });

      const targetUser = createMockUser({
        id: "target-123",
        username: "targetuser",
        tag: "targetuser#0",
      });
      (targetUser.displayAvatarURL as any).mockReturnValue("https://cdn.discord.com/avatars/target.png");

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getUser: { user: targetUser },
          getString: { query: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              title: "Application History for targetuser#0",
              description: "No applications found for this user.",
            }),
          }),
        ]),
      });
    });

    it("searches by user ID when query is a snowflake", async () => {
      const { hasStaffPermissions } = await import("../../src/lib/config.js");
      (hasStaffPermissions as any).mockReturnValue(true);

      const { checkCooldown } = await import("../../src/lib/rateLimiter.js");
      (checkCooldown as any).mockReturnValue({ allowed: true });

      const { db } = await import("../../src/db/db.js");
      (db.prepare as any).mockReturnValue({
        all: vi.fn(() => []),
        get: vi.fn(() => ({ total: 0 })),
      });

      const fetchedUser = createMockUser({
        id: "12345678901234567890",
        username: "fetcheduser",
        tag: "fetcheduser#0",
      });

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const mockClient = {
        users: {
          fetch: vi.fn().mockResolvedValue(fetchedUser),
        },
      };

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        client: mockClient as any,
        options: {
          getUser: { user: null },
          getString: { query: "12345678901234567890" },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(mockClient.users.fetch).toHaveBeenCalledWith("12345678901234567890");
      expect(interaction.editReply).toHaveBeenCalled();
    });

    it("shows applications with correct formatting", async () => {
      const { hasStaffPermissions } = await import("../../src/lib/config.js");
      (hasStaffPermissions as any).mockReturnValue(true);

      const { checkCooldown } = await import("../../src/lib/rateLimiter.js");
      (checkCooldown as any).mockReturnValue({ allowed: true });

      const { db } = await import("../../src/db/db.js");
      (db.prepare as any).mockReturnValue({
        all: vi.fn(() => [
          {
            id: "app-001",
            status: "approved",
            submitted_at: "2024-01-01T00:00:00Z",
            resolved_at: "2024-01-02T00:00:00Z",
            resolution_reason: "Welcome to the server!",
            channel_id: "chan-123",
            message_id: "msg-456",
          },
          {
            id: "app-002",
            status: "rejected",
            submitted_at: "2024-02-01T00:00:00Z",
            resolved_at: "2024-02-02T00:00:00Z",
            resolution_reason: "Incomplete application",
            channel_id: null,
            message_id: null,
          },
        ]),
        get: vi.fn(() => ({ total: 2 })),
      });

      const targetUser = createMockUser({
        id: "target-123",
        username: "targetuser",
        tag: "targetuser#0",
      });

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getUser: { user: targetUser },
          getString: { query: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      // Verify editReply was called with embeds
      expect(interaction.editReply).toHaveBeenCalled();
      const replyCall = (interaction.editReply as any).mock.calls[0][0];
      expect(replyCall.embeds).toHaveLength(1);

      // EmbedBuilder objects have their data in a .data property
      const embed = replyCall.embeds[0].data ?? replyCall.embeds[0];
      expect(embed.description).toContain("Total Applications");
      expect(embed.fields).toHaveLength(2);
      expect(embed.fields[0].name).toContain("Approved");
      expect(embed.fields[1].name).toContain("Rejected");
    });

    it("handles database error gracefully", async () => {
      const { hasStaffPermissions } = await import("../../src/lib/config.js");
      (hasStaffPermissions as any).mockReturnValue(true);

      const { checkCooldown } = await import("../../src/lib/rateLimiter.js");
      (checkCooldown as any).mockReturnValue({ allowed: true });

      const { db } = await import("../../src/db/db.js");
      (db.prepare as any).mockReturnValue({
        all: vi.fn(() => {
          throw new Error("Database error");
        }),
        get: vi.fn(() => ({ total: 0 })),
      });

      const targetUser = createMockUser({ id: "target-123" });

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        member: createMockMember({}),
        options: {
          getUser: { user: targetUser },
          getString: { query: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to fetch"),
      });
    });
  });
});
