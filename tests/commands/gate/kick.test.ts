/**
 * Pawtropolis Tech — tests/commands/gate/kick.test.ts
 * WHAT: Unit tests for /kick command.
 * WHY: Verify kick command validation, lookup, and execution.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock shared dependencies
vi.mock("../../../src/commands/gate/shared.js", () => ({
  requireGatekeeper: vi.fn(() => true),
  findAppByShortCode: vi.fn(),
  findPendingAppByUserId: vi.fn(),
  ensureReviewMessage: vi.fn().mockResolvedValue(undefined),
  updateReviewActionMeta: vi.fn(),
  getClaim: vi.fn(),
  claimGuard: vi.fn(() => null),
  kickTx: vi.fn(),
  kickFlow: vi.fn(),
  ensureDeferred: vi.fn().mockResolvedValue(undefined),
  replyOrEdit: vi.fn().mockResolvedValue(undefined),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/lib/constants.js", () => ({
  MAX_REASON_LENGTH: 500,
}));

import { kickData, executeKick } from "../../../src/commands/gate/kick.js";
import {
  requireGatekeeper,
  findAppByShortCode,
  findPendingAppByUserId,
  getClaim,
  claimGuard,
  kickTx,
  kickFlow,
  replyOrEdit,
} from "../../../src/commands/gate/shared.js";

const mockRequireGatekeeper = requireGatekeeper as ReturnType<typeof vi.fn>;
const mockFindAppByShortCode = findAppByShortCode as ReturnType<typeof vi.fn>;
const mockFindPendingAppByUserId = findPendingAppByUserId as ReturnType<typeof vi.fn>;
const mockGetClaim = getClaim as ReturnType<typeof vi.fn>;
const mockClaimGuard = claimGuard as ReturnType<typeof vi.fn>;
const mockKickTx = kickTx as ReturnType<typeof vi.fn>;
const mockKickFlow = kickFlow as ReturnType<typeof vi.fn>;
const mockReplyOrEdit = replyOrEdit as ReturnType<typeof vi.fn>;

function createMockContext(overrides: Record<string, unknown> = {}) {
  return {
    interaction: {
      guildId: "guild123",
      guild: { id: "guild123" },
      user: { id: "user456" },
      options: {
        getString: vi.fn(),
        getUser: vi.fn(),
      },
      ...overrides,
    },
    step: vi.fn(),
    requestId: "test-req",
  };
}

describe("commands/gate/kick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireGatekeeper.mockReturnValue(true);
    mockClaimGuard.mockReturnValue(null);
    mockKickTx.mockReturnValue({ kind: "ok", reviewActionId: 1 });
    mockKickFlow.mockResolvedValue({ kickSucceeded: true, dmDelivered: true });
  });

  describe("kickData", () => {
    it("has correct command name", () => {
      expect(kickData.name).toBe("kick");
    });

    it("has required reason option", () => {
      const options = kickData.options;
      const reasonOption = options.find((o: any) => o.name === "reason");
      expect(reasonOption).toBeDefined();
      expect(reasonOption?.required).toBe(true);
    });

    it("has optional app option", () => {
      const options = kickData.options;
      const appOption = options.find((o: any) => o.name === "app");
      expect(appOption).toBeDefined();
      expect(appOption?.required).toBe(false);
    });

    it("has optional user option", () => {
      const options = kickData.options;
      const userOption = options.find((o: any) => o.name === "user");
      expect(userOption).toBeDefined();
      expect(userOption?.required).toBe(false);
    });

    it("has optional uid option", () => {
      const options = kickData.options;
      const uidOption = options.find((o: any) => o.name === "uid");
      expect(uidOption).toBeDefined();
      expect(uidOption?.required).toBe(false);
    });

    it("is disabled for DMs", () => {
      expect(kickData.dm_permission).toBe(false);
    });
  });

  describe("executeKick", () => {
    it("rejects non-guild commands", async () => {
      const ctx = createMockContext();
      ctx.interaction.guildId = null;
      ctx.interaction.guild = null;

      await executeKick(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: "Guild only." })
      );
    });

    it("checks gatekeeper permission", async () => {
      mockRequireGatekeeper.mockReturnValue(false);
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => (name === "reason" ? "test" : null));
      ctx.interaction.options.getUser = vi.fn(() => null);

      await executeKick(ctx as any);

      expect(mockRequireGatekeeper).toHaveBeenCalled();
    });

    it("requires at least one identifier option", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => (name === "reason" ? "test" : null));
      ctx.interaction.options.getUser = vi.fn(() => null);

      await executeKick(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("provide one of") })
      );
    });

    it("rejects multiple identifier options", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => {
        if (name === "reason") return "test";
        if (name === "app") return "ABC123";
        if (name === "uid") return "123456789";
        return null;
      });
      ctx.interaction.options.getUser = vi.fn(() => null);

      await executeKick(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("only one") })
      );
    });

    it("rejects reason exceeding max length", async () => {
      const ctx = createMockContext();
      const longReason = "A".repeat(600);
      ctx.interaction.options.getString = vi.fn((name) => {
        if (name === "reason") return longReason;
        if (name === "app") return "ABC123";
        return null;
      });
      ctx.interaction.options.getUser = vi.fn(() => null);

      await executeKick(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("too long") })
      );
    });

    it("looks up app by short code", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => {
        if (name === "reason") return "test reason";
        if (name === "app") return "ABC123";
        return null;
      });
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindAppByShortCode.mockReturnValue({
        id: "app-id",
        user_id: "user123",
        guild_id: "guild123",
      });

      await executeKick(ctx as any);

      expect(mockFindAppByShortCode).toHaveBeenCalledWith("guild123", "ABC123");
    });

    it("handles app not found by code", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => {
        if (name === "reason") return "test";
        if (name === "app") return "NOTFOUND";
        return null;
      });
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindAppByShortCode.mockReturnValue(null);

      await executeKick(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("No application with code") })
      );
    });

    it("looks up app by user mention", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => (name === "reason" ? "test" : null));
      ctx.interaction.options.getUser = vi.fn(() => ({ id: "user789" }));

      mockFindPendingAppByUserId.mockReturnValue({
        id: "app-id",
        user_id: "user789",
        guild_id: "guild123",
      });

      await executeKick(ctx as any);

      expect(mockFindPendingAppByUserId).toHaveBeenCalledWith("guild123", "user789");
    });

    it("looks up app by raw user ID", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => {
        if (name === "reason") return "test";
        if (name === "uid") return "123456789012345678";
        return null;
      });
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindPendingAppByUserId.mockReturnValue({
        id: "app-id",
        user_id: "123456789012345678",
        guild_id: "guild123",
      });

      await executeKick(ctx as any);

      expect(mockFindPendingAppByUserId).toHaveBeenCalledWith("guild123", "123456789012345678");
    });

    it("validates user ID format", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => {
        if (name === "reason") return "test";
        if (name === "uid") return "abc"; // Invalid
        return null;
      });
      ctx.interaction.options.getUser = vi.fn(() => null);

      await executeKick(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("Invalid user ID") })
      );
    });

    it("checks claim before kicking", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => {
        if (name === "reason") return "test";
        if (name === "app") return "ABC123";
        return null;
      });
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindAppByShortCode.mockReturnValue({ id: "app-id", user_id: "user123" });
      mockGetClaim.mockReturnValue({ reviewer_id: "other-user" });
      mockClaimGuard.mockReturnValue("This app is claimed by someone else.");

      await executeKick(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: "This app is claimed by someone else." })
      );
    });

    it("handles already kicked status", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => {
        if (name === "reason") return "test";
        if (name === "app") return "ABC123";
        return null;
      });
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindAppByShortCode.mockReturnValue({ id: "app-id", user_id: "user123" });
      mockKickTx.mockReturnValue({ kind: "already" });

      await executeKick(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: "Already kicked." })
      );
    });

    it("handles terminal status", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => {
        if (name === "reason") return "test";
        if (name === "app") return "ABC123";
        return null;
      });
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindAppByShortCode.mockReturnValue({ id: "app-id", user_id: "user123" });
      mockKickTx.mockReturnValue({ kind: "terminal", status: "approved" });

      await executeKick(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("Already resolved") })
      );
    });

    it("executes kick flow on success", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => {
        if (name === "reason") return "test reason";
        if (name === "app") return "ABC123";
        return null;
      });
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindAppByShortCode.mockReturnValue({ id: "app-id", user_id: "user123" });

      await executeKick(ctx as any);

      expect(mockKickFlow).toHaveBeenCalledWith(ctx.interaction.guild, "user123", "test reason");
    });

    it("reports success with DM delivery", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => {
        if (name === "reason") return "test";
        if (name === "app") return "ABC123";
        return null;
      });
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindAppByShortCode.mockReturnValue({ id: "app-id", user_id: "user123" });
      mockKickFlow.mockResolvedValue({ kickSucceeded: true, dmDelivered: true });

      await executeKick(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("kicked and notified") })
      );
    });

    it("reports success without DM delivery", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => {
        if (name === "reason") return "test";
        if (name === "app") return "ABC123";
        return null;
      });
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindAppByShortCode.mockReturnValue({ id: "app-id", user_id: "user123" });
      mockKickFlow.mockResolvedValue({ kickSucceeded: true, dmDelivered: false });

      await executeKick(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("DM delivery failed") })
      );
    });

    it("reports kick failure with error", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => {
        if (name === "reason") return "test";
        if (name === "app") return "ABC123";
        return null;
      });
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindAppByShortCode.mockReturnValue({ id: "app-id", user_id: "user123" });
      mockKickFlow.mockResolvedValue({ kickSucceeded: false, error: "Missing permissions" });

      await executeKick(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("Kick failed") })
      );
    });
  });
});
