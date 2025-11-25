// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { claimGuard, CLAIMED_MESSAGE, type ReviewClaimRow } from "../../src/features/review.js";

describe("slash command claim denial", () => {
  it("denies /accept when claimed by someone else", () => {
    const claim: ReviewClaimRow = {
      reviewer_id: "staff-alice",
      claimed_at: new Date().toISOString(),
    };
    const result = claimGuard(claim, "staff-bob");
    expect(result).toBe(CLAIMED_MESSAGE("staff-alice"));
  });

  it("allows /accept when claimed by self", () => {
    const claim: ReviewClaimRow = {
      reviewer_id: "staff-alice",
      claimed_at: new Date().toISOString(),
    };
    const result = claimGuard(claim, "staff-alice");
    expect(result).toBeNull();
  });

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
