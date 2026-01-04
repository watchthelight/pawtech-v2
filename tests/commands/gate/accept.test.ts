/**
 * Pawtropolis Tech — tests/commands/gate/accept.test.ts
 * WHAT: Unit tests for /accept command (approve applications).
 * WHY: Verify permission checks, input validation, and approval workflow.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { executeAccept, acceptData } from "../../../src/commands/gate/accept.js";
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

// Mock the config module
vi.mock("../../../src/lib/config.js", () => ({
  requireGatekeeper: vi.fn(() => true),
  getConfig: vi.fn(() => ({
    accepted_role_id: "accepted-role-123",
    general_channel_id: "general-123",
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
  approveTx: vi.fn(() => ({ kind: "ok", reviewActionId: "review-action-123" })),
  approveFlow: vi.fn().mockResolvedValue({ member: null, roleApplied: false, roleError: null }),
  deliverApprovalDm: vi.fn().mockResolvedValue(true),
  updateReviewActionMeta: vi.fn(),
  getClaim: vi.fn(() => null),
  claimGuard: vi.fn(() => null),
}));

// Mock welcome module
vi.mock("../../../src/features/welcome.js", () => ({
  postWelcomeCard: vi.fn().mockResolvedValue(undefined),
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

describe("/accept command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("acceptData (slash command builder)", () => {
    it("has correct name and description", () => {
      expect(acceptData.name).toBe("accept");
      expect(acceptData.description).toContain("Approve an application");
    });

    it("has optional app (short code) option", () => {
      const options = acceptData.options;
      const appOption = options.find((o: any) => o.toJSON().name === "app");
      expect(appOption).toBeDefined();
      expect(appOption!.toJSON().required).toBe(false);
    });

    it("has optional user option", () => {
      const options = acceptData.options;
      const userOption = options.find((o: any) => o.toJSON().name === "user");
      expect(userOption).toBeDefined();
      expect(userOption!.toJSON().required).toBe(false);
    });

    it("has optional uid option", () => {
      const options = acceptData.options;
      const uidOption = options.find((o: any) => o.toJSON().name === "uid");
      expect(uidOption).toBeDefined();
      expect(uidOption!.toJSON().required).toBe(false);
    });

    it("is guild-only (no DM permission)", () => {
      expect(acceptData.dm_permission).toBe(false);
    });
  });

  describe("executeAccept", () => {
    it("rejects when used outside a guild", async () => {
      const { replyOrEdit } = await import("../../../src/lib/cmdWrap.js");

      const interaction = createMockInteraction({
        guild: null as any,
        guildId: null as any,
      });
      const ctx = createTestCommandContext(interaction);

      await executeAccept(ctx);

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
          getString: { app: "A1B2C3" },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeAccept(ctx);

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
          getString: { app: null, uid: null },
          getUser: { user: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeAccept(ctx);

      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          content: expect.stringContaining("Please provide one of"),
        })
      );
    });

    it("rejects when multiple identifier options provided", async () => {
      const { requireGatekeeper } = await import("../../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { replyOrEdit } = await import("../../../src/lib/cmdWrap.js");

      const guild = createMockGuild({ id: "guild-123" });
      const targetUser = createMockUser({ id: "target-123" });

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getString: { app: "A1B2C3", uid: "123456789" },
          getUser: { user: targetUser },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeAccept(ctx);

      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          content: expect.stringContaining("only one option"),
        })
      );
    });

    it("accepts by short code successfully", async () => {
      const { requireGatekeeper, getConfig } = await import("../../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { findAppByShortCode } = await import("../../../src/features/appLookup.js");
      (findAppByShortCode as any).mockReturnValue({
        id: "app-123",
        user_id: "user-456",
        guild_id: "guild-123",
        status: "submitted",
      });

      const { approveTx, approveFlow, getClaim, claimGuard } = await import("../../../src/features/review.js");
      (getClaim as any).mockReturnValue(null);
      (claimGuard as any).mockReturnValue(null);
      (approveTx as any).mockReturnValue({ kind: "ok", reviewActionId: "ra-123" });
      (approveFlow as any).mockResolvedValue({
        member: createMockMember({}),
        roleApplied: true,
        roleError: null,
      });

      const { replyOrEdit } = await import("../../../src/lib/cmdWrap.js");

      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getString: { app: "A1B2C3", uid: null },
          getUser: { user: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeAccept(ctx);

      expect(findAppByShortCode).toHaveBeenCalledWith("guild-123", "A1B2C3");
      expect(approveTx).toHaveBeenCalled();
      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          content: expect.stringContaining("approved"),
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
          getString: { app: "NOTFND", uid: null },
          getUser: { user: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeAccept(ctx);

      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          content: expect.stringContaining("No application with code"),
        })
      );
    });

    it("accepts by user mention", async () => {
      const { requireGatekeeper } = await import("../../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { findPendingAppByUserId, approveTx, approveFlow, getClaim, claimGuard } = await import("../../../src/features/review.js");
      (findPendingAppByUserId as any).mockReturnValue({
        id: "app-123",
        user_id: "target-123",
        guild_id: "guild-123",
        status: "submitted",
      });
      (getClaim as any).mockReturnValue(null);
      (claimGuard as any).mockReturnValue(null);
      (approveTx as any).mockReturnValue({ kind: "ok", reviewActionId: "ra-123" });
      (approveFlow as any).mockResolvedValue({ member: null, roleApplied: false, roleError: null });

      const { replyOrEdit } = await import("../../../src/lib/cmdWrap.js");

      const guild = createMockGuild({ id: "guild-123" });
      const targetUser = createMockUser({ id: "target-123" });

      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getString: { app: null, uid: null },
          getUser: { user: targetUser },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeAccept(ctx);

      expect(findPendingAppByUserId).toHaveBeenCalledWith("guild-123", "target-123");
      expect(approveTx).toHaveBeenCalled();
    });

    it("handles already approved application", async () => {
      const { requireGatekeeper } = await import("../../../src/lib/config.js");
      (requireGatekeeper as any).mockReturnValue(true);

      const { findAppByShortCode } = await import("../../../src/features/appLookup.js");
      (findAppByShortCode as any).mockReturnValue({
        id: "app-123",
        user_id: "user-456",
        status: "submitted",
      });

      const { approveTx, getClaim, claimGuard } = await import("../../../src/features/review.js");
      (getClaim as any).mockReturnValue(null);
      (claimGuard as any).mockReturnValue(null);
      (approveTx as any).mockReturnValue({ kind: "already" });

      const { replyOrEdit } = await import("../../../src/lib/cmdWrap.js");

      const guild = createMockGuild({ id: "guild-123" });
      const interaction = createMockInteraction({
        guild: guild as Guild,
        guildId: "guild-123",
        options: {
          getString: { app: "A1B2C3", uid: null },
          getUser: { user: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeAccept(ctx);

      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          content: "Already approved.",
        })
      );
    });

    it("blocks accept when claimed by another user", async () => {
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
          getString: { app: "A1B2C3", uid: null },
          getUser: { user: null },
        },
      });
      const ctx = createTestCommandContext(interaction);

      await executeAccept(ctx);

      expect(replyOrEdit).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          content: expect.stringContaining("claimed"),
        })
      );
    });
  });
});
