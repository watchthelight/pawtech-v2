/**
 * WHAT: Proves claim-gating hides scary buttons from non-claimers and shows Claim state appropriately.
 * HOW: Uses buildDecisionComponents and claimGuard along with shortCode helper.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import {
  buildDecisionComponents,
  claimGuard,
  CLAIMED_MESSAGE,
  type ReviewClaimRow,
} from "../../src/features/review.js";
import { shortCode } from "../../src/lib/ids.js";

describe("review decision buttons", () => {
  it("shows only Claim when unclaimed", () => {
    const rows = buildDecisionComponents("submitted", "app-123", "user-123", null);
    expect(rows).toHaveLength(1);
    const buttons = rows[0].components.map((component) => component.toJSON());
    expect(buttons).toHaveLength(1);
    expect(buttons[0].label).toBe("Claim");
    expect(buttons[0].custom_id).toBe(`v1:decide:claim:code${shortCode("app-123")}`);
  });

  it("shows decisions when claimed", () => {
    const claim: ReviewClaimRow = {
      app_id: "app-456",
      reviewer_id: "user-1",
      claimed_at: new Date().toISOString(),
    };
    const userId = "user-456";
    const rows = buildDecisionComponents("submitted", claim.app_id, userId, claim);
    expect(rows).toHaveLength(2); // Main row + secondary row

    // First row: Accept, Reject, Permanently Reject, Kick
    const mainButtons = rows[0].components.map((component) => component.toJSON());
    expect(mainButtons.map((btn) => btn.label)).toEqual([
      "Accept",
      "Reject",
      "Permanently Reject",
      "Kick",
    ]);
    const code = shortCode(claim.app_id);
    expect(mainButtons.slice(0, 4).map((btn) => btn.custom_id)).toEqual([
      `v1:decide:approve:code${code}`,
      `v1:decide:reject:code${code}`,
      `v1:decide:permreject:code${code}`,
      `v1:decide:kick:code${code}`,
    ]);

    // Second row: Modmail, Copy UID, Ping in Unverified
    const secondRowButtons = rows[1].components.map((component) => component.toJSON());
    expect(secondRowButtons).toHaveLength(3);
    expect(secondRowButtons.map((btn) => btn.label)).toEqual([
      "Modmail",
      "Copy UID",
      "Ping in Unverified",
    ]);
    expect(secondRowButtons[0].custom_id).toContain("v1:modmail:open:code");
    expect(secondRowButtons[1].custom_id).toBe(`v1:decide:copyuid:code${code}:user${userId}`);
    expect(secondRowButtons[2].custom_id).toBe(`v1:ping:code${code}:user${userId}`);
  });

  it("hides buttons once resolved", () => {
    const rows = buildDecisionComponents("approved", "app-789", "user-789", {
      app_id: "app-789",
      reviewer_id: "user-2",
      claimed_at: new Date().toISOString(),
    });
    expect(rows).toHaveLength(0);
  });
});

describe("claim guard", () => {
  it("allows claimer", () => {
    const claim: ReviewClaimRow = {
      app_id: "app-aaa",
      reviewer_id: "user-1",
      claimed_at: new Date().toISOString(),
    };
    expect(claimGuard(claim, "user-1")).toBeNull();
  });

  it("denies non-claimer", () => {
    const claim: ReviewClaimRow = {
      app_id: "app-bbb",
      reviewer_id: "user-9",
      claimed_at: new Date().toISOString(),
    };
    expect(claimGuard(claim, "user-1")).toBe(CLAIMED_MESSAGE("user-9"));
  });
});
