/**
 * Pawtropolis Tech — tests/commands/gate/reject.test.ts
 * WHAT: Unit tests for /reject command (reject applications).
 * WHY: Verify permission checks, input validation, and rejection workflow.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { executeReject, rejectData } from "../../../src/commands/gate/reject.js";
import { createTestCommandContext } from "../../utils/contextFactory.js";
import { createMockInteraction, createMockGuild, createMockMember, createMockUser } from "../../utils/discordMocks.js";
import type { Guild } from "discord.js";

// Mock the logger
vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock constants
vi.mock("../../../src/lib/constants.js", () => ({
  MAX_REASON_LENGTH: 500,
}));

// Mock the config module
vi.mock("../../../src/lib/config.js", () => ({
  requireGatekeeper: vi.fn(() => true),
  getConfig: vi.fn(() => ({
    accepted_role_id: "accepted-role-123",
  })),
}));

// Mock the app lookup
vi.mock("../../../src/features/appLookup.js", () => ({
  findAppByShortCode: vi.fn(),
}));

// Mock the review features
vi.mock("../../../src/features/review.js", () => ({
  findPendingAppByUserId: vi.fn(),
  ensureReviewMessage: vi.fn().mockResolvedValue(undefined),
  rejectTx: vi.fn(() => ({ kind: "ok", reviewActionId: "review-action-123" })),
  rejectFlow: vi.fn().mockResolvedValue({ dmDelivered: true }),
  updateReviewActionMeta: vi.fn(),
  getClaim: vi.fn(() => null),
  claimGuard: vi.fn(() => null),
}));

// Mock modmail module
vi.mock("../../../src/features/modmail.js", () => ({
  closeModmailForApplication: vi.fn().mockResolvedValue(undefined),
}));

// Mock cmdWrap
vi.mock("../../../src/lib/cmdWrap.js", () => ({
  ensureDeferred: vi.fn().mockResolvedValue(undefined),
  replyOrEdit: vi.fn().mockResolvedValue(undefined),
}));

// Mock ids
vi.mock("../../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(0, 6).toUpperCase()),
}));

describe("/reject command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rejectData (slash command builder)", () => {
    it("has correct name and description", () => {
      expect(rejectData.name).toBe("reject");
      expect(rejectData.description).toContain("Reject an application");
    });

    it("has required reason option", () => {
      const options = rejectData.options;
      const reasonOption = options.find((o: any) => o.toJSON().name === "reason");
      expect(reasonOption).toBeDefined();
      expect(reasonOption!.toJSON().required).toBe(true);
    });

    it("has optional app (short code) option", () => {
      const options = rejectData.options;
      const appOption = options.find((o: any) => o.toJSON().name === "app");
      expect(appOption).toBeDefined();
      expect(appOption!.toJSON().required).toBe(false);
    });

    it("has optional perm (permanent) option", () => {
      const options = rejectData.options;
      const permOption = options.find((o: any) => o.toJSON().name === "perm");
      expect(permOption).toBeDefined();
      expect(permOption!.toJSON().required).toBe(false);
    });

    it("is guild-only (no DM permission)", () => {
      expect(rejectData.dm_permission).toBe(false);
    });
  });

  describe("executeReject", () => {
    it("rejects when used outside a guild", async () => {
      const { replyOrEdit } = await import("../../../src/lib/cmdWrap.js");

      const interaction = createMockInteraction({
        guild: null as any,
        guildId: null as any,
      });
      const ctx = createTestCommandContext(interaction);

      await executeReject(ctx);

      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({ content: "Guild only." })
      );
    });

    it("denies access when user lacks gatekeeper role", async () => {
      const { requireGatekeeper } = await import("../../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(false);

      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getString: { app: "A1B2C3", reason: "Test reason" },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeReject(ctx);

      expect(requireGatekeeper).toHaveBeenCalled();
    });

    it("requires at least one identifier option", async () => {
      const { requireGatekeeper } = await import("../../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { replyOrEdit } = await import("../../../src/lib/cmdWrap.js");

      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getString: { app: null, uid: null, reason: "Test reason" },
          getUser: { user: null },
          getBoolean: { perm: false },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeReject(ctx);

      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          content: expect.stringContaining("Please provide one of"),
        })
      );
    });

    it("validates reason is not empty", async () => {
      const { requireGatekeeper } = await import("../../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { replyOrEdit } = await import("../../../src/lib/cmdWrap.js");

      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getString: { app: "A1B2C3", uid: null, reason: "   " },
          getUser: { user: null },
          getBoolean: { perm: false },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeReject(ctx);

      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          content: "Reason is required.",
        })
      );
    });

    it("validates reason length", async () => {
      const { requireGatekeeper } = await import("../../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { replyOrEdit } = await import("../../../src/lib/cmdWrap.js");

      const guild = createMockGuild({ id: "guild-123" });
      const longReason = "x".repeat(501);
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getString: { app: "A1B2C3", uid: null, reason: longReason },
          getUser: { user: null },
          getBoolean: { perm: false },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeReject(ctx);

      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          content: expect.stringContaining("too long"),
        })
      );
    });

    it("rejects by short code successfully", async () => {
      const { requireGatekeeper } = await import("../../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { findAppByShortCode } = await import("../../../src/features/appLookup.js");
      (findAppByShortCode as any).mockReturnValue({
        id: "app-123",
        user_id: "user-456",
        guild_id: "guild-123",
        status: "submitted",
      });

      const { rejectTx, rejectFlow, getClaim, claimGuard } = await import("../../../src/features/review.js");
      (getClaim as any).mockReturnValue(null);
      (claimGuard as any).mockReturnValue(null);
      (rejectTx as any).mockReturnValue({ kind: "ok", reviewActionId: "ra-123" });
      (rejectFlow as any).mockResolvedValue({ dmDelivered: true });

      const { replyOrEdit } = await import("../../../src/lib/cmdWrap.js");

      const mockUser = createMockUser({ id: "user-456" });
      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        client: {
          users: {
            fetch: vi.fn().mockResolvedValue(mockUser),
          },
        } as any,
        options: {
          getString: { app: "A1B2C3", uid: null, reason: "Underage account" },
          getUser: { user: null },
          getBoolean: { perm: false },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeReject(ctx);

      expect(findAppByShortCode).toHaveBeenCalledWith("guild-123", "A1B2C3");
      expect(rejectTx).toHaveBeenCalled();
      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          content: expect.stringContaining("rejected"),
        })
      );
    });

    it("handles permanent rejection", async () => {
      const { requireGatekeeper } = await import("../../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { findAppByShortCode } = await import("../../../src/features/appLookup.js");
      (findAppByShortCode as any).mockReturnValue({
        id: "app-123",
        user_id: "user-456",
        status: "submitted",
      });

      const { rejectTx, rejectFlow, getClaim, claimGuard } = await import("../../../src/features/review.js");
      (getClaim as any).mockReturnValue(null);
      (claimGuard as any).mockReturnValue(null);
      (rejectTx as any).mockReturnValue({ kind: "ok", reviewActionId: "ra-123" });
      (rejectFlow as any).mockResolvedValue({ dmDelivered: true });

      const { replyOrEdit } = await import("../../../src/lib/cmdWrap.js");

      const mockUser = createMockUser({ id: "user-456" });
      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        client: {
          users: {
            fetch: vi.fn().mockResolvedValue(mockUser),
          },
        } as any,
        options: {
          getString: { app: "A1B2C3", uid: null, reason: "Spam alt" },
          getUser: { user: null },
          getBoolean: { perm: true },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeReject(ctx);

      expect(rejectTx).toHaveBeenCalledWith(
        "app-123",
        expect.any(String),
        "Spam alt",
        true // permanent
      );
      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          content: expect.stringContaining("permanently rejected"),
        })
      );
    });

    it("reports not found when short code doesn't match", async () => {
      const { requireGatekeeper } = await import("../../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { findAppByShortCode } = await import("../../../src/features/appLookup.js");
      (findAppByShortCode as any).mockReturnValue(null);

      const { replyOrEdit } = await import("../../../src/lib/cmdWrap.js");

      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getString: { app: "NOTFND", uid: null, reason: "Some reason" },
          getUser: { user: null },
          getBoolean: { perm: false },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeReject(ctx);

      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          content: expect.stringContaining("No application with code"),
        })
      );
    });

    it("handles already rejected application", async () => {
      const { requireGatekeeper } = await import("../../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { findAppByShortCode } = await import("../../../src/features/appLookup.js");
      (findAppByShortCode as any).mockReturnValue({
        id: "app-123",
        user_id: "user-456",
        status: "submitted",
      });

      const { rejectTx, getClaim, claimGuard } = await import("../../../src/features/review.js");
      (getClaim as any).mockReturnValue(null);
      (claimGuard as any).mockReturnValue(null);
      (rejectTx as any).mockReturnValue({ kind: "already" });

      const { replyOrEdit } = await import("../../../src/lib/cmdWrap.js");

      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getString: { app: "A1B2C3", uid: null, reason: "Reason" },
          getUser: { user: null },
          getBoolean: { perm: false },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeReject(ctx);

      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          content: "Already rejected.",
        })
      );
    });

    it("indicates when DM delivery failed", async () => {
      const { requireGatekeeper } = await import("../../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { findAppByShortCode } = await import("../../../src/features/appLookup.js");
      (findAppByShortCode as any).mockReturnValue({
        id: "app-123",
        user_id: "user-456",
        status: "submitted",
      });

      const { rejectTx, rejectFlow, getClaim, claimGuard } = await import("../../../src/features/review.js");
      (getClaim as any).mockReturnValue(null);
      (claimGuard as any).mockReturnValue(null);
      (rejectTx as any).mockReturnValue({ kind: "ok", reviewActionId: "ra-123" });
      (rejectFlow as any).mockResolvedValue({ dmDelivered: false });

      const { replyOrEdit } = await import("../../../src/lib/cmdWrap.js");

      const mockUser = createMockUser({ id: "user-456" });
      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        client: {
          users: {
            fetch: vi.fn().mockResolvedValue(mockUser),
          },
        } as any,
        options: {
          getString: { app: "A1B2C3", uid: null, reason: "Reason" },
          getUser: { user: null },
          getBoolean: { perm: false },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeReject(ctx);

      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          content: expect.stringContaining("DM delivery failed"),
        })
      );
    });

    it("blocks reject when claimed by another user", async () => {
      const { requireGatekeeper } = await import("../../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { findAppByShortCode } = await import("../../../src/features/appLookup.js");
      (findAppByShortCode as any).mockReturnValue({
        id: "app-123",
        user_id: "user-456",
        status: "submitted",
      });

      const { getClaim, claimGuard } = await import("../../../src/features/review.js");
      (getClaim as any).mockReturnValue({ userId: "other-mod-123" });
      (claimGuard as any).mockReturnValue("This application is claimed by another moderator.");

      const { replyOrEdit } = await import("../../../src/lib/cmdWrap.js");

      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getString: { app: "A1B2C3", uid: null, reason: "Reason" },
          getUser: { user: null },
          getBoolean: { perm: false },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeReject(ctx);

      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          content: expect.stringContaining("claimed"),
        })
      );
    });
  });
});
