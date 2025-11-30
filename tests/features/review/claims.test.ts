/**
 * Pawtropolis Tech -- tests/features/review/claims.test.ts
 * WHAT: Tests for the review claim management system.
 * WHY: The claim system prevents race conditions when multiple mods review the same app.
 *      These tests verify claim creation, retrieval, guards, and cleanup.
 *
 * Uses a mock database for unit tests of the claim logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// ===== Mock Setup =====

const mockDbStatement = {
  get: vi.fn(),
  run: vi.fn(),
};

const mockDb = vi.hoisted(() => ({
  prepare: vi.fn(() => mockDbStatement),
}));

vi.mock("../../../src/db/db.js", () => ({
  db: mockDb,
}));

// Import after mocks
import {
  claimGuard,
  CLAIMED_MESSAGE,
  getReviewClaim,
  getClaim,
  clearClaim,
} from "../../../src/features/review/claims.js";
import type { ReviewClaimRow } from "../../../src/features/review/types.js";

// ===== Test Setup =====

beforeEach(() => {
  vi.clearAllMocks();
});

// ===== CLAIMED_MESSAGE Tests =====

describe("CLAIMED_MESSAGE", () => {
  it("includes the claimer user ID as a mention", () => {
    const message = CLAIMED_MESSAGE("user-123");
    expect(message).toContain("<@user-123>");
  });

  it("provides helpful context about what to do", () => {
    const message = CLAIMED_MESSAGE("user-456");
    expect(message).toMatch(/ask.*finish|unclaim/i);
  });
});

// ===== claimGuard Tests =====

describe("claimGuard", () => {
  it("allows action when no claim exists", () => {
    const result = claimGuard(null, "user-123");
    expect(result).toBeNull();
  });

  it("allows action when user is the claimer", () => {
    const claim: ReviewClaimRow = {
      app_id: "app-123",
      reviewer_id: "user-123",
      claimed_at: new Date().toISOString(),
    };

    const result = claimGuard(claim, "user-123");
    expect(result).toBeNull();
  });

  it("blocks action when different user holds the claim", () => {
    const claim: ReviewClaimRow = {
      app_id: "app-123",
      reviewer_id: "claimer-456",
      claimed_at: new Date().toISOString(),
    };

    const result = claimGuard(claim, "user-123");
    expect(result).toBe(CLAIMED_MESSAGE("claimer-456"));
  });

  it("returns consistent message format for blocked claims", () => {
    const claim: ReviewClaimRow = {
      app_id: "app-789",
      reviewer_id: "other-user",
      claimed_at: new Date().toISOString(),
    };

    const result = claimGuard(claim, "attempting-user");
    expect(result).toContain("<@other-user>");
    expect(result).not.toContain("attempting-user");
  });
});

// ===== getReviewClaim Tests =====

describe("getReviewClaim", () => {
  it("returns claim row when claim exists", () => {
    const expectedClaim = {
      reviewer_id: "reviewer-123",
      claimed_at: "2024-01-15T10:00:00Z",
    };

    mockDbStatement.get.mockReturnValue(expectedClaim);

    const result = getReviewClaim("app-123");

    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining("SELECT")
    );
    expect(result).toEqual(expectedClaim);
  });

  it("returns undefined when no claim exists", () => {
    mockDbStatement.get.mockReturnValue(undefined);

    const result = getReviewClaim("app-nonexistent");

    expect(result).toBeUndefined();
  });

  it("queries the correct table and app_id", () => {
    mockDbStatement.get.mockReturnValue(undefined);

    getReviewClaim("test-app-id");

    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringMatching(/review_claim.*app_id/)
    );
    expect(mockDbStatement.get).toHaveBeenCalledWith("test-app-id");
  });
});

// ===== getClaim Tests =====

describe("getClaim", () => {
  it("returns claim row when claim exists", () => {
    const expectedClaim = {
      reviewer_id: "reviewer-123",
      claimed_at: "2024-01-15T10:00:00Z",
    };

    mockDbStatement.get.mockReturnValue(expectedClaim);

    const result = getClaim("app-123");

    expect(result).toEqual(expectedClaim);
  });

  it("returns null (not undefined) when no claim exists", () => {
    mockDbStatement.get.mockReturnValue(undefined);

    const result = getClaim("app-nonexistent");

    expect(result).toBeNull();
    expect(result).not.toBeUndefined();
  });
});

// ===== clearClaim Tests =====

describe("clearClaim", () => {
  it("deletes the claim for the specified app", () => {
    clearClaim("app-123");

    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM review_claim/)
    );
    expect(mockDbStatement.run).toHaveBeenCalledWith("app-123");
  });

  it("only affects the specified app_id", () => {
    clearClaim("specific-app");

    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE app_id/)
    );
    expect(mockDbStatement.run).toHaveBeenCalledWith("specific-app");
  });
});

// ===== Claim Workflow Integration Tests =====
// NOTE: Atomic claim operations (claimTx/unclaimTx) are tested in reviewActions.test.ts
// These tests focus on the guard and clear functions used by handlers.

describe("claim workflow", () => {
  it("guard -> clear flow for resolution", () => {
    // 1. Existing claim (set up by claimTx in production)
    const claim: ReviewClaimRow = {
      app_id: "app-workflow",
      reviewer_id: "mod-1",
      claimed_at: new Date().toISOString(),
    };

    // 2. Claimer can take action
    expect(claimGuard(claim, "mod-1")).toBeNull();

    // 3. Another mod is blocked
    expect(claimGuard(claim, "mod-2")).toBe(CLAIMED_MESSAGE("mod-1"));

    // 4. Clear claim after resolution
    clearClaim("app-workflow");
    expect(mockDb.prepare).toHaveBeenLastCalledWith(
      expect.stringMatching(/DELETE/)
    );
  });

  it("clearClaim releases claim for next reviewer", () => {
    // Clear claim
    clearClaim("app-handoff");

    // Verify DELETE was called
    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM review_claim/)
    );
    expect(mockDbStatement.run).toHaveBeenCalledWith("app-handoff");
  });
});

// ===== Edge Cases =====

describe("edge cases", () => {
  it("handles empty string app_id", () => {
    // Shouldn't happen in practice, but let's be defensive
    mockDbStatement.get.mockReturnValue(undefined);

    const result = getClaim("");
    expect(result).toBeNull();
  });

  it("claimGuard handles claim with empty reviewer_id", () => {
    const claim: ReviewClaimRow = {
      app_id: "app-123",
      reviewer_id: "",
      claimed_at: new Date().toISOString(),
    };

    // User with any ID should be blocked (reviewer_id "" !== "user-123")
    const result = claimGuard(claim, "user-123");
    expect(result).toBe(CLAIMED_MESSAGE(""));
  });
});
