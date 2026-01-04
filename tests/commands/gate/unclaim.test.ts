/**
 * Pawtropolis Tech — tests/commands/gate/unclaim.test.ts
 * WHAT: Unit tests for /unclaim command.
 * WHY: Verify unclaim command validation, lookup, and claim release.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock shared dependencies
vi.mock("../../../src/commands/gate/shared.js", () => ({
  requireGatekeeper: vi.fn(() => true),
  findAppByShortCode: vi.fn(),
  findPendingAppByUserId: vi.fn(),
  ensureReviewMessage: vi.fn().mockResolvedValue(undefined),
  getClaim: vi.fn(),
  clearClaim: vi.fn(),
  CLAIMED_MESSAGE: vi.fn((id: string) => `Claimed by <@${id}>.`),
  ensureDeferred: vi.fn().mockResolvedValue(undefined),
  replyOrEdit: vi.fn().mockResolvedValue(undefined),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { unclaimData, executeUnclaim } from "../../../src/commands/gate/unclaim.js";
import {
  requireGatekeeper,
  findAppByShortCode,
  findPendingAppByUserId,
  getClaim,
  clearClaim,
  CLAIMED_MESSAGE,
  replyOrEdit,
} from "../../../src/commands/gate/shared.js";

const mockRequireGatekeeper = requireGatekeeper as ReturnType<typeof vi.fn>;
const mockFindAppByShortCode = findAppByShortCode as ReturnType<typeof vi.fn>;
const mockFindPendingAppByUserId = findPendingAppByUserId as ReturnType<typeof vi.fn>;
const mockGetClaim = getClaim as ReturnType<typeof vi.fn>;
const mockClearClaim = clearClaim as ReturnType<typeof vi.fn>;
const mockReplyOrEdit = replyOrEdit as ReturnType<typeof vi.fn>;
const mockClaimedMessage = CLAIMED_MESSAGE as ReturnType<typeof vi.fn>;

function createMockContext(overrides: Record<string, unknown> = {}) {
  return {
    interaction: {
      guildId: "guild123",
      guild: { id: "guild123" },
      user: { id: "user456" },
      client: {},
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

describe("commands/gate/unclaim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireGatekeeper.mockReturnValue(true);
  });

  describe("unclaimData", () => {
    it("has correct command name", () => {
      expect(unclaimData.name).toBe("unclaim");
    });

    it("has optional app option", () => {
      const options = unclaimData.options;
      const appOption = options.find((o: any) => o.name === "app");
      expect(appOption).toBeDefined();
      expect(appOption?.required).toBe(false);
    });

    it("has optional user option", () => {
      const options = unclaimData.options;
      const userOption = options.find((o: any) => o.name === "user");
      expect(userOption).toBeDefined();
      expect(userOption?.required).toBe(false);
    });

    it("has optional uid option", () => {
      const options = unclaimData.options;
      const uidOption = options.find((o: any) => o.name === "uid");
      expect(uidOption).toBeDefined();
      expect(uidOption?.required).toBe(false);
    });

    it("is disabled for DMs", () => {
      expect(unclaimData.dm_permission).toBe(false);
    });
  });

  describe("executeUnclaim", () => {
    it("rejects non-guild commands", async () => {
      const ctx = createMockContext();
      ctx.interaction.guildId = null;
      ctx.interaction.guild = null;

      await executeUnclaim(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: "Guild only." })
      );
    });

    it("checks gatekeeper permission", async () => {
      mockRequireGatekeeper.mockReturnValue(false);
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn(() => null);
      ctx.interaction.options.getUser = vi.fn(() => null);

      await executeUnclaim(ctx as any);

      expect(mockRequireGatekeeper).toHaveBeenCalled();
    });

    it("requires at least one identifier option", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn(() => null);
      ctx.interaction.options.getUser = vi.fn(() => null);

      await executeUnclaim(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("provide one of") })
      );
    });

    it("rejects multiple identifier options", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => {
        if (name === "app") return "ABC123";
        if (name === "uid") return "123456789";
        return null;
      });
      ctx.interaction.options.getUser = vi.fn(() => null);

      await executeUnclaim(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("only one") })
      );
    });

    it("looks up app by short code", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => (name === "app" ? "ABC123" : null));
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindAppByShortCode.mockReturnValue({ id: "app-id" });
      mockGetClaim.mockReturnValue({ reviewer_id: "user456" });

      await executeUnclaim(ctx as any);

      expect(mockFindAppByShortCode).toHaveBeenCalledWith("guild123", "ABC123");
    });

    it("handles app not found by code", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => (name === "app" ? "NOTFOUND" : null));
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindAppByShortCode.mockReturnValue(null);

      await executeUnclaim(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("No application with code") })
      );
    });

    it("looks up app by user mention", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn(() => null);
      ctx.interaction.options.getUser = vi.fn(() => ({ id: "user789" }));

      mockFindPendingAppByUserId.mockReturnValue({ id: "app-id" });
      mockGetClaim.mockReturnValue({ reviewer_id: "user456" });

      await executeUnclaim(ctx as any);

      expect(mockFindPendingAppByUserId).toHaveBeenCalledWith("guild123", "user789");
    });

    it("looks up app by raw user ID", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) =>
        name === "uid" ? "123456789012345678" : null
      );
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindPendingAppByUserId.mockReturnValue({ id: "app-id" });
      mockGetClaim.mockReturnValue({ reviewer_id: "user456" });

      await executeUnclaim(ctx as any);

      expect(mockFindPendingAppByUserId).toHaveBeenCalledWith("guild123", "123456789012345678");
    });

    it("validates user ID format", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => (name === "uid" ? "abc" : null));
      ctx.interaction.options.getUser = vi.fn(() => null);

      await executeUnclaim(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("Invalid user ID") })
      );
    });

    it("handles no current claim", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => (name === "app" ? "ABC123" : null));
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindAppByShortCode.mockReturnValue({ id: "app-id" });
      mockGetClaim.mockReturnValue(null);

      await executeUnclaim(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("not currently claimed") })
      );
    });

    it("rejects unclaim by non-claimer", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => (name === "app" ? "ABC123" : null));
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindAppByShortCode.mockReturnValue({ id: "app-id" });
      mockGetClaim.mockReturnValue({ reviewer_id: "other-user" });

      await executeUnclaim(ctx as any);

      expect(mockClaimedMessage).toHaveBeenCalledWith("other-user");
      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: expect.stringContaining("Claimed by") })
      );
    });

    it("clears claim when user is claimer", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => (name === "app" ? "ABC123" : null));
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindAppByShortCode.mockReturnValue({ id: "app-id" });
      mockGetClaim.mockReturnValue({ reviewer_id: "user456" });

      await executeUnclaim(ctx as any);

      expect(mockClearClaim).toHaveBeenCalledWith("app-id");
    });

    it("reports success after unclaim", async () => {
      const ctx = createMockContext();
      ctx.interaction.options.getString = vi.fn((name) => (name === "app" ? "ABC123" : null));
      ctx.interaction.options.getUser = vi.fn(() => null);

      mockFindAppByShortCode.mockReturnValue({ id: "app-id" });
      mockGetClaim.mockReturnValue({ reviewer_id: "user456" });

      await executeUnclaim(ctx as any);

      expect(mockReplyOrEdit).toHaveBeenCalledWith(
        ctx.interaction,
        expect.objectContaining({ content: "Claim removed." })
      );
    });
  });
});
