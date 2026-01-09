/**
 * Pawtropolis Tech — tests/commands/panic.test.ts
 * WHAT: Unit tests for /panic command (emergency role automation shutoff).
 * WHY: Verify permission checks, on/off/status subcommands, and state persistence.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi } from "vitest";
import { execute, data } from "../../src/commands/panic.js";
import { createTestCommandContext } from "../utils/contextFactory.js";
import { createMockInteraction, createMockGuild } from "../utils/discordMocks.js";
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
  requireMinRole: vi.fn(() => true),
  ROLE_IDS: { SENIOR_ADMIN: "senior-admin-role-id" },
}));

// Mock the panicStore
vi.mock("../../src/features/panicStore.js", () => ({
  setPanicMode: vi.fn(),
  getPanicDetails: vi.fn(() => null),
}));

// Mock the logging module - must return a Promise with .catch()
vi.mock("../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn(() => Promise.resolve(undefined)),
}));

describe("/panic command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("data (slash command builder)", () => {
    it("has correct name and description", () => {
      expect(data.name).toBe("panic");
      expect(data.description).toBe("Emergency shutoff for role automation");
    });

    it("has on, off, and status subcommands", () => {
      const json = data.toJSON();
      const subcommands = json.options?.filter((o: any) => o.type === 1);
      expect(subcommands).toHaveLength(3);

      const names = subcommands?.map((s: any) => s.name);
      expect(names).toContain("on");
      expect(names).toContain("off");
      expect(names).toContain("status");
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

      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getSubcommand: "on",
        },
      });
      const ctx = createTestCommandContext(interaction);

      await execute(ctx);

      expect(requireMinRole).toHaveBeenCalled();
      // Should return early without enabling panic
      const { setPanicMode } = await import("../../src/features/panicStore.js");
      expect(setPanicMode).not.toHaveBeenCalled();
    });

    describe("subcommand: on", () => {
      it("enables panic mode successfully", async () => {
        const { requireMinRole } = await import("../../src/lib/config.js");
        (requireMinRole as any).mockReturnValue(true);

        const guild = createMockGuild({ id: "guild-123" });
        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          options: {
            getSubcommand: "on",
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        const { setPanicMode } = await import("../../src/features/panicStore.js");
        expect(setPanicMode).toHaveBeenCalledWith("guild-123", true, "user-123");
        expect(interaction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining("PANIC MODE ENABLED"),
          ephemeral: false,
        });
      });

      it("logs the action to audit channel", async () => {
        const { requireMinRole } = await import("../../src/lib/config.js");
        (requireMinRole as any).mockReturnValue(true);

        const guild = createMockGuild({ id: "guild-123" });
        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          options: {
            getSubcommand: "on",
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        const { logActionPretty } = await import("../../src/logging/pretty.js");
        expect(logActionPretty).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            action: "panic_enabled",
          })
        );
      });
    });

    describe("subcommand: off", () => {
      it("disables panic mode successfully", async () => {
        const { requireMinRole } = await import("../../src/lib/config.js");
        (requireMinRole as any).mockReturnValue(true);

        const guild = createMockGuild({ id: "guild-123" });
        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          options: {
            getSubcommand: "off",
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        const { setPanicMode } = await import("../../src/features/panicStore.js");
        expect(setPanicMode).toHaveBeenCalledWith("guild-123", false, "user-123");
        expect(interaction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining("Panic mode disabled"),
          ephemeral: false,
        });
      });

      it("logs the action to audit channel", async () => {
        const { requireMinRole } = await import("../../src/lib/config.js");
        (requireMinRole as any).mockReturnValue(true);

        const guild = createMockGuild({ id: "guild-123" });
        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          options: {
            getSubcommand: "off",
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        const { logActionPretty } = await import("../../src/logging/pretty.js");
        expect(logActionPretty).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            action: "panic_disabled",
          })
        );
      });
    });

    describe("subcommand: status", () => {
      it("shows inactive status when panic mode is off", async () => {
        const { requireMinRole } = await import("../../src/lib/config.js");
        (requireMinRole as any).mockReturnValue(true);

        const { getPanicDetails } = await import("../../src/features/panicStore.js");
        (getPanicDetails as any).mockReturnValue(null);

        const guild = createMockGuild({ id: "guild-123" });
        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          options: {
            getSubcommand: "status",
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining("Panic mode is OFF"),
          ephemeral: true,
        });
      });

      it("shows active status with details when panic mode is on", async () => {
        const { requireMinRole } = await import("../../src/lib/config.js");
        (requireMinRole as any).mockReturnValue(true);

        const { getPanicDetails } = await import("../../src/features/panicStore.js");
        (getPanicDetails as any).mockReturnValue({
          enabled: true,
          enabledBy: "mod-456",
          enabledAt: new Date("2024-01-15T12:00:00Z"),
        });

        const guild = createMockGuild({ id: "guild-123" });
        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          options: {
            getSubcommand: "status",
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: expect.stringMatching(/Panic mode is ACTIVE.*mod-456/s),
          ephemeral: true,
        });
      });

      it("shows status without enabledBy if not available", async () => {
        const { requireMinRole } = await import("../../src/lib/config.js");
        (requireMinRole as any).mockReturnValue(true);

        const { getPanicDetails } = await import("../../src/features/panicStore.js");
        (getPanicDetails as any).mockReturnValue({
          enabled: true,
          enabledBy: null,
          enabledAt: null,
        });

        const guild = createMockGuild({ id: "guild-123" });
        const interaction = createMockInteraction({
          guild: guild as Guild,
          guildId: "guild-123",
          options: {
            getSubcommand: "status",
          },
        });
        const ctx = createTestCommandContext(interaction);

        await execute(ctx);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining("Panic mode is ACTIVE"),
          ephemeral: true,
        });
      });
    });
  });
});
