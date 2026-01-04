/**
 * Pawtropolis Tech — tests/commands/flag.test.ts
 * WHAT: Unit tests for /flag command (manual user flagging).
 * WHY: Verify permission checks, rate limiting, idempotency, and DB operations.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { execute, data, cleanupFlagCooldowns } from "../../src/commands/flag.js";
import { createTestCommandContext } from "../utils/contextFactory.js";
import { createMockInteraction, createMockUser, createMockMember, createMockGuild, createMockChannel } from "../utils/discordMocks.js";
import type { ChatInputCommandInteraction, GuildMember, TextChannel, Guild } from "discord.js";

// Mock the logger
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the config module
vi.mock("../../src/lib/config.js", () => ({
  requireMinRole: vi.fn(() => true),
  ROLE_IDS: { JUNIOR_MOD: "junior-mod-role-id" },
  JUNIOR_MOD_PLUS: ["junior-mod-role-id", "mod-role-id", "admin-role-id"],
}));

// Mock the env module
vi.mock("../../src/lib/env.js", () => ({
  env: {
    FLAGGED_REPORT_CHANNEL_ID: null,
  },
}));

// Mock the flags store
vi.mock("../../src/store/flagsStore.js", () => ({
  getExistingFlag: vi.fn(),
  isAlreadyFlagged: vi.fn(() => false),
  upsertManualFlag: vi.fn(() => ({
    flagged_at: Math.floor(Date.now() / 1000),
    flagged_by: "mod-123",
    flagged_reason: "Test reason",
  })),
}));

describe("/flag command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Clean up cooldowns between tests
    cleanupFlagCooldowns();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupFlagCooldowns();
  });

  describe("data (slash command builder)", () => {
    it("has correct name and description", () => {
      expect(data.name).toBe("flag");
      expect(data.description).toBe("Manually flag a user as a bot");
    });

    it("has required user option", () => {
      const options = data.options;
      expect(options).toHaveLength(2);

      const userOption = options.find((o: any) => o.toJSON().name === "user");
      expect(userOption).toBeDefined();
      expect(userOption!.toJSON().required).toBe(true);
    });

    it("has optional reason option", () => {
      const options = data.options;
      const reasonOption = options.find((o: any) => o.toJSON().name === "reason");
      expect(reasonOption).toBeDefined();
      expect(reasonOption!.toJSON().required).toBe(false);
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
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
    });

    it("denies access when user lacks required role", async () => {
      const { requireMinRole } = await import("../../src/lib/config.js");
      (requireMinRole as any).mockReturnValue(false);

      const targetUser = createMockUser({ id: "target-123", username: "targetuser" });
      const interaction = createMockInteraction({
        options: {
          getUser: vi.fn().mockReturnValue(targetUser),
          getString: vi.fn().mockReturnValue(null),
        } as any,
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(requireMinRole).toHaveBeenCalled();
      // Command should return early without deferring
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it("flags a user successfully", async () => {
      const { requireMinRole } = await import("../../src/lib/config.js");
      (requireMinRole as any).mockReturnValue(true);

      const { upsertManualFlag, isAlreadyFlagged } = await import("../../src/store/flagsStore.js");
      (isAlreadyFlagged as any).mockReturnValue(false);

      const targetUser = createMockUser({ id: "target-123", username: "targetuser" });

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(
        createMockMember({ user: targetUser, joinedTimestamp: 1700000000000 } as any)
      );

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { user: targetUser },
          getString: { reason: "Suspicious behavior" },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(upsertManualFlag).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "guild-123",
          userId: "target-123",
          reason: "Suspicious behavior",
        })
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Flag recorded"),
      });
    });

    it("uses default reason when none provided", async () => {
      const { requireMinRole } = await import("../../src/lib/config.js");
      (requireMinRole as any).mockReturnValue(true);

      const { upsertManualFlag, isAlreadyFlagged } = await import("../../src/store/flagsStore.js");
      (isAlreadyFlagged as any).mockReturnValue(false);

      const targetUser = createMockUser({ id: "target-456" });

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(
        createMockMember({ user: targetUser } as any)
      );

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { user: targetUser },
          getString: { reason: null }, // No reason provided
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(upsertManualFlag).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "Manually flagged as a bot",
        })
      );
    });

    it("reports already flagged users without creating duplicate", async () => {
      const { requireMinRole } = await import("../../src/lib/config.js");
      (requireMinRole as any).mockReturnValue(true);

      const { isAlreadyFlagged, getExistingFlag, upsertManualFlag } = await import("../../src/store/flagsStore.js");
      (isAlreadyFlagged as any).mockReturnValue(true);
      (getExistingFlag as any).mockReturnValue({
        flagged_at: Math.floor(Date.now() / 1000) - 86400, // 1 day ago
        flagged_by: "other-mod-123",
        flagged_reason: "Original reason",
      });

      const targetUser = createMockUser({ id: "target-789" });

      const interaction = createMockInteraction({
        guildId: "guild-123",
        options: {
          getUser: { user: targetUser },
          getString: { reason: "New reason" },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(upsertManualFlag).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Already flagged"),
      });
    });

    it("enforces rate limit between flags", async () => {
      const { requireMinRole } = await import("../../src/lib/config.js");
      (requireMinRole as any).mockReturnValue(true);

      const { isAlreadyFlagged, upsertManualFlag } = await import("../../src/store/flagsStore.js");
      (isAlreadyFlagged as any).mockReturnValue(false);

      const targetUser1 = createMockUser({ id: "target-1" });
      const targetUser2 = createMockUser({ id: "target-2" });

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      // First flag should succeed
      const interaction1 = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        user: createMockUser({ id: "mod-123" }),
        options: {
          getUser: { user: targetUser1 },
        },
      });
      const ctx1 = createTestCommandContext(interaction1);
      await execute(ctx1);
      expect(upsertManualFlag).toHaveBeenCalled();

      vi.clearAllMocks();

      // Second flag immediately should be rate limited
      const interaction2 = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        user: createMockUser({ id: "mod-123" }),
        options: {
          getUser: { user: targetUser2 },
        },
      });
      const ctx2 = createTestCommandContext(interaction2);
      await execute(ctx2);

      expect(interaction2.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("Please wait"),
        ephemeral: true,
      });
      expect(upsertManualFlag).not.toHaveBeenCalled();
    });

    it("allows flag after cooldown expires", async () => {
      const { requireMinRole } = await import("../../src/lib/config.js");
      (requireMinRole as any).mockReturnValue(true);

      const { isAlreadyFlagged, upsertManualFlag } = await import("../../src/store/flagsStore.js");
      (isAlreadyFlagged as any).mockReturnValue(false);

      const targetUser1 = createMockUser({ id: "target-1" });
      const targetUser2 = createMockUser({ id: "target-2" });

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      // First flag
      const interaction1 = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        user: createMockUser({ id: "mod-456" }),
        options: {
          getUser: { user: targetUser1 },
        },
      });
      await execute(createTestCommandContext(interaction1));

      vi.clearAllMocks();

      // Advance time past cooldown (15 seconds)
      vi.advanceTimersByTime(16000);

      // Second flag should now succeed
      const interaction2 = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        user: createMockUser({ id: "mod-456" }),
        options: {
          getUser: { user: targetUser2 },
        },
      });
      await execute(createTestCommandContext(interaction2));

      expect(upsertManualFlag).toHaveBeenCalled();
    });

    it("handles member fetch failure gracefully", async () => {
      const { requireMinRole } = await import("../../src/lib/config.js");
      (requireMinRole as any).mockReturnValue(true);

      const { isAlreadyFlagged, upsertManualFlag } = await import("../../src/store/flagsStore.js");
      (isAlreadyFlagged as any).mockReturnValue(false);

      const targetUser = createMockUser({ id: "target-left" });

      const guild = createMockGuild({ id: "guild-123" });
      // Simulate user who left the server
      (guild.members.fetch as any).mockRejectedValue(new Error("Unknown Member"));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        user: createMockUser({ id: "mod-789" }),
        options: {
          getUser: { user: targetUser },
          getString: { reason: "Left server but sus" },
        },
      });
      await execute(createTestCommandContext(interaction));

      // Should still flag even without join timestamp
      expect(upsertManualFlag).toHaveBeenCalledWith(
        expect.objectContaining({
          joinedAt: null,
        })
      );
    });

    it("handles database error during flag creation", async () => {
      const { requireMinRole } = await import("../../src/lib/config.js");
      (requireMinRole as any).mockReturnValue(true);

      const { isAlreadyFlagged, upsertManualFlag } = await import("../../src/store/flagsStore.js");
      (isAlreadyFlagged as any).mockReturnValue(false);
      (upsertManualFlag as any).mockImplementation(() => {
        throw new Error("Database error");
      });

      const targetUser = createMockUser({ id: "target-db-err" });

      const guild = createMockGuild({ id: "guild-123" });
      (guild.members.fetch as any).mockResolvedValue(createMockMember({}));

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        user: createMockUser({ id: "mod-db" }),
        options: {
          getUser: { user: targetUser },
        },
      });
      await execute(createTestCommandContext(interaction));

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to flag user"),
      });
    });
  });

  describe("cleanupFlagCooldowns", () => {
    it("clears all cooldowns when called", () => {
      // This is mainly to test the cleanup function exists and works
      cleanupFlagCooldowns();
      // No error means success
    });
  });
});
