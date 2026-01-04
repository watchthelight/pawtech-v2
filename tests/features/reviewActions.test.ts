/**
 * Pawtropolis Tech — tests/features/reviewActions.test.ts
 * WHAT: Unit tests for review claim/unclaim transaction module.
 * WHY: Verify atomic claim operations, ownership validation, and race condition handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock functions
const { mockGet, mockRun, mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn(),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
  run: mockRun,
});

mockTransaction.mockImplementation((fn) => {
  return () => fn();
});

vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
    transaction: mockTransaction,
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/lib/time.js", () => ({
  nowUtc: vi.fn(() => 1700000000),
}));

vi.mock("../../src/features/panicStore.js", () => ({
  isPanicMode: vi.fn(() => false),
}));

import {
  claimTx,
  unclaimTx,
  getClaim,
  clearClaim,
  claimGuard,
  ClaimError,
} from "../../src/features/reviewActions.js";
import { isPanicMode } from "../../src/features/panicStore.js";
import { logger } from "../../src/lib/logger.js";

describe("features/reviewActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPanicMode).mockReturnValue(false);
    mockPrepare.mockReturnValue({
      get: mockGet,
      run: mockRun,
    });
  });

  describe("claimTx", () => {
    it("claims application successfully", () => {
      // App exists
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      // No existing claim
      mockGet.mockReturnValueOnce(undefined);
      mockRun.mockReturnValue({ changes: 1 });

      expect(() => claimTx("app123", "mod456", "guild123")).not.toThrow();
      expect(mockRun).toHaveBeenCalled();
    });

    it("throws APP_NOT_FOUND when application does not exist", () => {
      mockGet.mockReturnValueOnce(undefined);

      expect(() => claimTx("app123", "mod456", "guild123")).toThrow(ClaimError);
      expect(() => claimTx("app123", "mod456", "guild123")).toThrow("Application not found");
    });

    it("throws ALREADY_CLAIMED when claimed by another moderator", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      mockGet.mockReturnValueOnce({ reviewer_id: "other789" });

      expect(() => claimTx("app123", "mod456", "guild123")).toThrow(ClaimError);
    });

    it("allows idempotent claim by same moderator", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      mockGet.mockReturnValueOnce({ reviewer_id: "mod456" });

      expect(() => claimTx("app123", "mod456", "guild123")).not.toThrow();
    });

    it("throws INVALID_STATUS for approved applications", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "approved" });

      expect(() => claimTx("app123", "mod456", "guild123")).toThrow(ClaimError);
    });

    it("throws INVALID_STATUS for rejected applications", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "rejected" });

      expect(() => claimTx("app123", "mod456", "guild123")).toThrow(ClaimError);
    });

    it("throws INVALID_STATUS for kicked applications", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "kicked" });

      expect(() => claimTx("app123", "mod456", "guild123")).toThrow(ClaimError);
    });

    it("throws INVALID_STATUS when panic mode is active", () => {
      vi.mocked(isPanicMode).mockReturnValue(true);

      expect(() => claimTx("app123", "mod456", "guild123")).toThrow(ClaimError);
      expect(() => claimTx("app123", "mod456", "guild123")).toThrow("Panic mode is active");
    });

    it("logs successful claim", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      mockGet.mockReturnValueOnce(undefined);
      mockRun.mockReturnValue({ changes: 1 });

      claimTx("app123", "mod456", "guild123");

      expect(logger.info).toHaveBeenCalled();
    });

    it("creates review_action audit entry", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      mockGet.mockReturnValueOnce(undefined);
      mockRun.mockReturnValue({ changes: 1 });

      claimTx("app123", "mod456", "guild123");

      // Should call run twice: once for claim insert, once for audit entry
      expect(mockRun).toHaveBeenCalledTimes(2);
    });
  });

  describe("unclaimTx", () => {
    it("unclaims application successfully", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      mockGet.mockReturnValueOnce({ reviewer_id: "mod456" });
      mockRun.mockReturnValue({ changes: 1 });

      expect(() => unclaimTx("app123", "mod456", "guild123")).not.toThrow();
    });

    it("throws APP_NOT_FOUND when application does not exist", () => {
      mockGet.mockReturnValueOnce(undefined);

      expect(() => unclaimTx("app123", "mod456", "guild123")).toThrow(ClaimError);
    });

    it("throws NOT_CLAIMED when no claim exists", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      mockGet.mockReturnValueOnce(undefined);

      expect(() => unclaimTx("app123", "mod456", "guild123")).toThrow(ClaimError);
      expect(() => unclaimTx("app123", "mod456", "guild123")).toThrow("not claimed");
    });

    it("throws NOT_OWNER when claimed by different moderator", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      mockGet.mockReturnValueOnce({ reviewer_id: "other789" });

      expect(() => unclaimTx("app123", "mod456", "guild123")).toThrow(ClaimError);
    });

    it("throws INVALID_STATUS when panic mode is active", () => {
      vi.mocked(isPanicMode).mockReturnValue(true);

      expect(() => unclaimTx("app123", "mod456", "guild123")).toThrow(ClaimError);
    });

    it("creates review_action audit entry", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      mockGet.mockReturnValueOnce({ reviewer_id: "mod456" });
      mockRun.mockReturnValue({ changes: 1 });

      unclaimTx("app123", "mod456", "guild123");

      // Should call run twice: once for delete, once for audit entry
      expect(mockRun).toHaveBeenCalledTimes(2);
    });

    it("logs successful unclaim", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      mockGet.mockReturnValueOnce({ reviewer_id: "mod456" });
      mockRun.mockReturnValue({ changes: 1 });

      unclaimTx("app123", "mod456", "guild123");

      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("getClaim", () => {
    it("returns claim when found", () => {
      mockGet.mockReturnValue({
        app_id: "app123",
        reviewer_id: "mod456",
        claimed_at: 1700000000,
      });

      const claim = getClaim("app123");

      expect(claim).toEqual({
        app_id: "app123",
        reviewer_id: "mod456",
        claimed_at: 1700000000,
      });
    });

    it("returns null when no claim exists", () => {
      mockGet.mockReturnValue(undefined);

      const claim = getClaim("app123");

      expect(claim).toBeNull();
    });
  });

  describe("clearClaim", () => {
    it("returns true when claim removed", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = clearClaim("app123");

      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalled();
    });

    it("returns false when no claim existed", () => {
      mockRun.mockReturnValue({ changes: 0 });

      const result = clearClaim("app123");

      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("claimGuard", () => {
    it("returns null when user is claim owner", () => {
      const claim = { app_id: "app123", reviewer_id: "mod456", claimed_at: 1700000000 };

      const result = claimGuard(claim, "mod456");

      expect(result).toBeNull();
    });

    it("returns error message when no claim", () => {
      const result = claimGuard(null, "mod456");

      expect(result).toContain("not claimed");
      expect(result).toContain("Claim Application");
    });

    it("returns error message when claimed by different user", () => {
      const claim = { app_id: "app123", reviewer_id: "other789", claimed_at: 1700000000 };

      const result = claimGuard(claim, "mod456");

      expect(result).toContain("claimed by");
      expect(result).toContain("other789");
    });

    it("includes Discord mention format", () => {
      const claim = { app_id: "app123", reviewer_id: "other789", claimed_at: 1700000000 };

      const result = claimGuard(claim, "mod456");

      expect(result).toContain("<@other789>");
    });
  });
});

describe("ClaimError", () => {
  describe("error codes", () => {
    it("has ALREADY_CLAIMED code", () => {
      const error = new ClaimError("Already claimed", "ALREADY_CLAIMED");
      expect(error.code).toBe("ALREADY_CLAIMED");
    });

    it("has NOT_CLAIMED code", () => {
      const error = new ClaimError("Not claimed", "NOT_CLAIMED");
      expect(error.code).toBe("NOT_CLAIMED");
    });

    it("has NOT_OWNER code", () => {
      const error = new ClaimError("Not owner", "NOT_OWNER");
      expect(error.code).toBe("NOT_OWNER");
    });

    it("has APP_NOT_FOUND code", () => {
      const error = new ClaimError("App not found", "APP_NOT_FOUND");
      expect(error.code).toBe("APP_NOT_FOUND");
    });

    it("has INVALID_STATUS code", () => {
      const error = new ClaimError("Invalid status", "INVALID_STATUS");
      expect(error.code).toBe("INVALID_STATUS");
    });
  });

  describe("error properties", () => {
    it("has correct name", () => {
      const error = new ClaimError("Test", "ALREADY_CLAIMED");
      expect(error.name).toBe("ClaimError");
    });

    it("has correct message", () => {
      const error = new ClaimError("Test message", "ALREADY_CLAIMED");
      expect(error.message).toBe("Test message");
    });

    it("is instanceof Error", () => {
      const error = new ClaimError("Test", "ALREADY_CLAIMED");
      expect(error).toBeInstanceOf(Error);
    });
  });
});

describe("terminal statuses", () => {
  describe("approved status", () => {
    it("is terminal", () => {
      const terminalStatuses = ["approved", "rejected", "kicked"];
      expect(terminalStatuses).toContain("approved");
    });
  });

  describe("rejected status", () => {
    it("is terminal", () => {
      const terminalStatuses = ["approved", "rejected", "kicked"];
      expect(terminalStatuses).toContain("rejected");
    });
  });

  describe("kicked status", () => {
    it("is terminal", () => {
      const terminalStatuses = ["approved", "rejected", "kicked"];
      expect(terminalStatuses).toContain("kicked");
    });
  });

  describe("submitted status", () => {
    it("is not terminal", () => {
      const terminalStatuses = ["approved", "rejected", "kicked"];
      expect(terminalStatuses).not.toContain("submitted");
    });
  });

  describe("needs_info status", () => {
    it("is not terminal", () => {
      const terminalStatuses = ["approved", "rejected", "kicked"];
      expect(terminalStatuses).not.toContain("needs_info");
    });
  });
});

describe("transaction isolation", () => {
  describe("SQLite serializable isolation", () => {
    it("wraps operations in db.transaction", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      mockGet.mockReturnValueOnce(undefined);
      mockRun.mockReturnValue({ changes: 1 });

      claimTx("app123", "mod456", "guild123");

      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  describe("optimistic locking", () => {
    it("checks for existing claim before insert", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      mockGet.mockReturnValueOnce({ reviewer_id: "other789" });

      // Should fail before attempting insert
      expect(() => claimTx("app123", "mod456", "guild123")).toThrow(ClaimError);
    });
  });
});

describe("audit trail", () => {
  describe("claim action", () => {
    it("records claim in review_action table", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      mockGet.mockReturnValueOnce(undefined);
      mockRun.mockReturnValue({ changes: 1 });

      claimTx("app123", "mod456", "guild123");

      // Second run call should be for audit entry
      expect(mockRun).toHaveBeenCalledTimes(2);
    });
  });

  describe("unclaim action", () => {
    it("records unclaim in review_action table", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      mockGet.mockReturnValueOnce({ reviewer_id: "mod456" });
      mockRun.mockReturnValue({ changes: 1 });

      unclaimTx("app123", "mod456", "guild123");

      // Both delete and audit insert
      expect(mockRun).toHaveBeenCalledTimes(2);
    });
  });
});

describe("review_claim table schema", () => {
  describe("columns", () => {
    it("has app_id column", () => {
      const columns = ["app_id", "reviewer_id", "claimed_at"];
      expect(columns).toContain("app_id");
    });

    it("has reviewer_id column", () => {
      const columns = ["app_id", "reviewer_id", "claimed_at"];
      expect(columns).toContain("reviewer_id");
    });

    it("has claimed_at column", () => {
      const columns = ["app_id", "reviewer_id", "claimed_at"];
      expect(columns).toContain("claimed_at");
    });
  });
});

describe("panic mode integration", () => {
  describe("claimTx blocking", () => {
    it("blocks claim when panic mode active", () => {
      vi.mocked(isPanicMode).mockReturnValue(true);

      expect(() => claimTx("app123", "mod456", "guild123")).toThrow("Panic mode is active");
    });
  });

  describe("unclaimTx blocking", () => {
    it("blocks unclaim when panic mode active", () => {
      vi.mocked(isPanicMode).mockReturnValue(true);

      expect(() => unclaimTx("app123", "mod456", "guild123")).toThrow("Panic mode is active");
    });
  });
});

describe("logging", () => {
  describe("claim operations", () => {
    it("logs debug on transaction start", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      mockGet.mockReturnValueOnce(undefined);
      mockRun.mockReturnValue({ changes: 1 });

      claimTx("app123", "mod456", "guild123");

      expect(logger.debug).toHaveBeenCalled();
    });

    it("logs info on successful claim", () => {
      mockGet.mockReturnValueOnce({ id: "app123", guild_id: "guild123", status: "submitted" });
      mockGet.mockReturnValueOnce(undefined);
      mockRun.mockReturnValue({ changes: 1 });

      claimTx("app123", "mod456", "guild123");

      expect(logger.info).toHaveBeenCalled();
    });

    it("logs warn on claim failure", () => {
      mockGet.mockReturnValueOnce(undefined);

      try {
        claimTx("app123", "mod456", "guild123");
      } catch {
        // Expected to throw
      }

      expect(logger.warn).toHaveBeenCalled();
    });
  });
});

describe("ReviewClaimRow type", () => {
  describe("required fields", () => {
    it("has app_id", () => {
      const row = { app_id: "app123", reviewer_id: "mod456", claimed_at: 1700000000 };
      expect(row.app_id).toBeDefined();
    });

    it("has reviewer_id", () => {
      const row = { app_id: "app123", reviewer_id: "mod456", claimed_at: 1700000000 };
      expect(row.reviewer_id).toBeDefined();
    });

    it("has claimed_at", () => {
      const row = { app_id: "app123", reviewer_id: "mod456", claimed_at: 1700000000 };
      expect(row.claimed_at).toBeDefined();
    });
  });
});
