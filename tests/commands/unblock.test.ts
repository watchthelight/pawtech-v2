/**
 * Pawtropolis Tech — tests/commands/unblock.test.ts
 * WHAT: Unit tests for /unblock command (remove permanent rejection).
 * WHY: Verify permission checks, input validation, and database operations.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi } from "vitest";
import { execute, data } from "../../src/commands/unblock.js";
import { createTestCommandContext } from "../utils/contextFactory.js";
import { createMockInteraction, createMockGuild, createMockUser } from "../utils/discordMocks.js";
import type { ChatInputCommandInteraction, Guild } from "discord.js";

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
  requireGatekeeper: vi.fn(() => true),
}));

// Mock the database
vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: vi.fn(() => ({
      get: vi.fn(),
      run: vi.fn(() => ({ changes: 1 })),
    })),
  },
}));

// Mock the logger feature
vi.mock("../../src/features/logger.js", () => ({
  postAuditEmbed: vi.fn().mockResolvedValue(undefined),
}));

describe("/unblock command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("data (slash command builder)", () => {
    it("has correct name and description", () => {
      expect(data.name).toBe("unblock");
      expect(data.description).toBe("Remove permanent rejection from a user");
    });

    it("has target, user_id, username, and reason options", () => {
      const json = data.toJSON();
      const optionNames = json.options?.map((o: any) => o.name);
      expect(optionNames).toContain("target");
      expect(optionNames).toContain("user_id");
      expect(optionNames).toContain("username");
      expect(optionNames).toContain("reason");
    });

    it("all options are optional", () => {
      const json = data.toJSON();
      const requiredOptions = json.options?.filter((o: any) => o.required);
      expect(requiredOptions).toHaveLength(0);
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

    it("denies access when user lacks gatekeeper role", async () => {
      const { requireGatekeeper } = await import("../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(false);

      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { target: null },
          getString: { user_id: null, username: null, reason: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(requireGatekeeper).toHaveBeenCalled();
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it("requires at least one target option", async () => {
      const { requireGatekeeper } = await import("../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { target: null },
          getString: { user_id: null, username: null, reason: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("Please provide a user"),
        ephemeral: true,
      });
    });

    it("rejects username-only lookup with not supported message", async () => {
      const { requireGatekeeper } = await import("../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { target: null },
          getString: { user_id: null, username: "testuser", reason: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("Username lookup is not supported"),
        ephemeral: true,
      });
    });

    it("unblocks by user mention successfully", async () => {
      const { requireGatekeeper } = await import("../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { db } = await import("../../src/db/db.js");
      const mockGet = vi.fn().mockReturnValue({
        permanently_rejected: 1,
        permanent_reject_at: "2024-01-01",
        user_id: "target-123",
      });
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      (db.prepare as any).mockReturnValue({ get: mockGet, run: mockRun });

      const targetUser = createMockUser({ id: "target-123", username: "blockeduser" });
      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { target: targetUser },
          getString: { user_id: null, username: null, reason: "Second chance" },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("has been unblocked"),
      });
    });

    it("unblocks by user_id when user has left server", async () => {
      const { requireGatekeeper } = await import("../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { db } = await import("../../src/db/db.js");
      const mockGet = vi.fn().mockReturnValue({
        permanently_rejected: 1,
        permanent_reject_at: "2024-01-01",
        user_id: "left-user-456",
      });
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      (db.prepare as any).mockReturnValue({ get: mockGet, run: mockRun });

      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { target: null },
          getString: { user_id: "left-user-456", username: null, reason: null },
        },
      });
      // Make client.users.fetch fail (user not found)
      (interaction.client.users.fetch as any).mockRejectedValue(new Error("Unknown User"));
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("has been unblocked"),
      });
    });

    it("reports when user is not permanently rejected", async () => {
      const { requireGatekeeper } = await import("../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { db } = await import("../../src/db/db.js");
      const mockGet = vi.fn().mockReturnValue(undefined); // Not found
      (db.prepare as any).mockReturnValue({ get: mockGet });

      const targetUser = createMockUser({ id: "not-blocked-123" });
      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { target: targetUser },
          getString: { user_id: null, username: null, reason: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("is not currently permanently rejected"),
      });
    });

    it("handles database update failure", async () => {
      const { requireGatekeeper } = await import("../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { db } = await import("../../src/db/db.js");
      const mockGet = vi.fn().mockReturnValue({
        permanently_rejected: 1,
        permanent_reject_at: "2024-01-01",
        user_id: "target-123",
      });
      const mockRun = vi.fn().mockReturnValue({ changes: 0 }); // No rows updated
      (db.prepare as any).mockReturnValue({ get: mockGet, run: mockRun });

      const targetUser = createMockUser({ id: "target-123" });
      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { target: targetUser },
          getString: { user_id: null, username: null, reason: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to unblock user"),
      });
    });

    it("handles database error gracefully", async () => {
      const { requireGatekeeper } = await import("../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { db } = await import("../../src/db/db.js");
      (db.prepare as any).mockImplementation(() => {
        throw new Error("Database connection failed");
      });

      const targetUser = createMockUser({ id: "target-123" });
      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { target: targetUser },
          getString: { user_id: null, username: null, reason: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("error occurred"),
      });
    });

    it("uses default reason when none provided", async () => {
      const { requireGatekeeper } = await import("../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { db } = await import("../../src/db/db.js");
      const mockGet = vi.fn().mockReturnValue({
        permanently_rejected: 1,
        permanent_reject_at: "2024-01-01",
        user_id: "target-123",
      });
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      (db.prepare as any).mockReturnValue({ get: mockGet, run: mockRun });

      const { postAuditEmbed } = await import("../../src/features/logger.js");

      const targetUser = createMockUser({ id: "target-123" });
      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { target: targetUser },
          getString: { user_id: null, username: null, reason: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(postAuditEmbed).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          details: expect.stringContaining("none provided"),
        })
      );
    });

    it("attempts to send DM notification to user", async () => {
      const { requireGatekeeper } = await import("../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { db } = await import("../../src/db/db.js");
      const mockGet = vi.fn().mockReturnValue({
        permanently_rejected: 1,
        permanent_reject_at: "2024-01-01",
        user_id: "target-123",
      });
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      (db.prepare as any).mockReturnValue({ get: mockGet, run: mockRun });

      const targetUser = createMockUser({ id: "target-123" });
      const guild = createMockGuild({ id: "guild-123", name: "Test Server" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { target: targetUser },
          getString: { user_id: null, username: null, reason: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(targetUser.send).toHaveBeenCalledWith({
        content: expect.stringContaining("permanent rejection"),
      });
    });

    it("handles DM failure gracefully", async () => {
      const { requireGatekeeper } = await import("../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { db } = await import("../../src/db/db.js");
      const mockGet = vi.fn().mockReturnValue({
        permanently_rejected: 1,
        permanent_reject_at: "2024-01-01",
        user_id: "target-123",
      });
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      (db.prepare as any).mockReturnValue({ get: mockGet, run: mockRun });

      const targetUser = createMockUser({ id: "target-123" });
      (targetUser.send as any).mockRejectedValue(new Error("Cannot send DM"));

      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getUser: { target: targetUser },
          getString: { user_id: null, username: null, reason: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      // Should still succeed despite DM failure
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("has been unblocked"),
      });
    });
  });
});
