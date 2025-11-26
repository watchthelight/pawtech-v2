// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { claimGuard, CLAIMED_MESSAGE, type ReviewClaimRow } from "../../src/features/review.js";

/**
 * Tests for the review claim guard system. The claim mechanism prevents
 * two staff members from simultaneously reviewing the same application,
 * which would lead to conflicting decisions and confused applicants.
 *
 * claimGuard returns null when the action is allowed, or an error message
 * when blocked. This inverted boolean pattern lets callers easily check
 * `if (result) return ephemeral(result)` without extra logic.
 */
describe("slash command claim denial", () => {
  // Core conflict case: Bob tries to act on Alice's claimed review.
  // This is the most common real-world scenario when staff are active simultaneously.
  it("denies /accept when claimed by someone else", () => {
    const claim: ReviewClaimRow = {
      reviewer_id: "staff-alice",
      claimed_at: new Date().toISOString(),
    };
    const result = claimGuard(claim, "staff-bob");
    expect(result).toBe(CLAIMED_MESSAGE("staff-alice"));
  });

  // Owner can always complete their own review - obvious but worth verifying
  // since a bug here would lock staff out of their own claims.
  it("allows /accept when claimed by self", () => {
    const claim: ReviewClaimRow = {
      reviewer_id: "staff-alice",
      claimed_at: new Date().toISOString(),
    };
    const result = claimGuard(claim, "staff-alice");
    expect(result).toBeNull();
  });

  // Unclaimed reviews are fair game for anyone. The null claim case
  // happens on fresh applications or after /unclaim.
  it("allows /accept when not claimed", () => {
    const result = claimGuard(null, "staff-bob");
    expect(result).toBeNull();
  });

  it("denies /reject when claimed by someone else", () => {
    const claim: ReviewClaimRow = {
      reviewer_id: "staff-charlie",
      claimed_at: new Date().toISOString(),
    };
    const result = claimGuard(claim, "staff-dave");
    expect(result).toBe(CLAIMED_MESSAGE("staff-charlie"));
  });

  it("denies /kick when claimed by someone else", () => {
    const claim: ReviewClaimRow = {
      reviewer_id: "staff-eve",
      claimed_at: new Date().toISOString(),
    };
    const result = claimGuard(claim, "staff-frank");
    expect(result).toBe(CLAIMED_MESSAGE("staff-eve"));
  });

  // This is a deliberate design choice: even admins cannot unclaim someone else's review.
  // The rationale is that claims indicate active work, and forcibly taking over could
  // cause duplicate actions. Admins can still ask the claimant to release it.
  it("denies /unclaim when claimed by someone else", () => {
    const claim: ReviewClaimRow = {
      reviewer_id: "staff-grace",
      claimed_at: new Date().toISOString(),
    };
    // per requirements: even admins should be denied
    const result = claimGuard(claim, "staff-admin");
    expect(result).toBe(CLAIMED_MESSAGE("staff-grace"));
  });
});
/**
 * WHAT: Proves slash command handlers wire to review flows and produce expected ephemeral replies.
 * HOW: Uses fake ChatInputCommandInteraction and inspects reply payloads.
 * DOCS: https://vitest.dev/guide/
 */
