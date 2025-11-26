/**
 * Claim-gating tests. The review system requires mods to "claim" an application
 * before they can make decisions on it. This prevents two mods from accidentally
 * approving/rejecting the same application simultaneously.
 *
 * The UI reflects claim state:
 * - Unclaimed: Only shows "Claim" button
 * - Claimed: Shows full decision palette (Accept, Reject, Kick, etc.)
 * - Resolved: No buttons (application already processed)
 *
 * The claimGuard function enforces that only the claiming mod can make decisions.
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
  /**
   * Unclaimed apps only show the Claim button. This is the first state any
   * application is in when it enters the review queue.
   */
  it("shows only Claim when unclaimed", () => {
    const rows = buildDecisionComponents("submitted", "app-123", "user-123", null);
    expect(rows).toHaveLength(1);
    const buttons = rows[0].components.map((component) => component.toJSON());
    expect(buttons).toHaveLength(1);
    expect(buttons[0].label).toBe("Claim");
    expect(buttons[0].custom_id).toBe(`v1:decide:claim:code${shortCode("app-123")}`);
  });

  /**
   * Once claimed, the full button palette appears. Note there are TWO action rows:
   * Row 1: Terminal decisions (Accept, Reject, Permanently Reject, Kick)
   * Row 2: Non-terminal actions (Modmail, Copy UID, Ping)
   *
   * The button custom_ids include the shortCode which maps back to the app_id.
   */
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

  /**
   * Resolved applications (approved, rejected, etc.) show no buttons.
   * The claim row exists but the status is terminal so there's nothing to do.
   */
  it("hides buttons once resolved", () => {
    const rows = buildDecisionComponents("approved", "app-789", "user-789", {
      app_id: "app-789",
      reviewer_id: "user-2",
      claimed_at: new Date().toISOString(),
    });
    expect(rows).toHaveLength(0);
  });
});

/**
 * claimGuard is the authorization check that runs before any decision action.
 * It ensures the user clicking the button is the same one who claimed the app.
 */
describe("claim guard", () => {
  /**
   * Happy path: the mod who claimed the app is making the decision.
   * Returns null to indicate "proceed".
   */
  it("allows claimer", () => {
    const claim: ReviewClaimRow = {
      app_id: "app-aaa",
      reviewer_id: "user-1",
      claimed_at: new Date().toISOString(),
    };
    expect(claimGuard(claim, "user-1")).toBeNull();
  });

  /**
   * Someone else tries to make a decision on an app they didn't claim.
   * Returns an error message that gets shown as an ephemeral reply.
   * The message includes the claimer's ID so the user knows who to talk to.
   */
  it("denies non-claimer", () => {
    const claim: ReviewClaimRow = {
      app_id: "app-bbb",
      reviewer_id: "user-9",
      claimed_at: new Date().toISOString(),
    };
    expect(claimGuard(claim, "user-1")).toBe(CLAIMED_MESSAGE("user-9"));
  });
});
