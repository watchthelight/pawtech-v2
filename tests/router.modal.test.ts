/**
 * WHAT: Proves custom-id routing regexes catch intended patterns and reject unknowns.
 * HOW: Unit-tests identifyModalRoute() and button regexes by example strings.
 * DOCS: https://vitest.dev/guide/
 *
 * Discord custom IDs are how we route button clicks and modal submissions to
 * the right handler. They're essentially our "URLs" for interactive components.
 * Format: v1:{type}:{action}:{params} - the v1 prefix allows future format changes.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { BTN_DECIDE_RE, identifyModalRoute } from "../src/lib/modalPatterns.js";

describe("identifyModalRoute", () => {
  // Gate modals use session IDs to track multi-page application flows.
  // The "abcd" is a random session ID, "p0" means page 0 (first page).
  it("matches gate modal page with session id", () => {
    const route = identifyModalRoute("v1:modal:abcd:p0");
    expect(route).toEqual({ type: "gate_submit_page", sessionId: "abcd", pageIndex: 0 });
  });

  // Reject modals include an application code to identify which review.
  // The "code" prefix is stripped; we only need the hex identifier.
  it("matches review reject modal", () => {
    const route = identifyModalRoute("v1:modal:reject:codeA1B2C3");
    expect(route).toEqual({ type: "review_reject", code: "A1B2C3" });
  });

  // Avatar confirmation for 18+ content is a separate flow with its own modal.
  // Uses "avatar" namespace instead of "modal" to distinguish the feature.
  it("matches avatar confirm 18 modal", () => {
    const route = identifyModalRoute("v1:avatar:confirm18:codeABCDEF");
    expect(route).toEqual({ type: "avatar_confirm18", code: "ABCDEF" });
  });

  // Legacy format from before we added session IDs. These old buttons may
  // still exist in cached messages - returning null triggers a "please retry" response.
  it("treats legacy page ids as unmatched", () => {
    expect(identifyModalRoute("v1:modal:p0")).toBeNull();
  });

  // Garbage in, null out. Unknown patterns should fail gracefully, not crash.
  it("returns null for unknown patterns", () => {
    expect(identifyModalRoute("v1:modal:weird:thing")).toBeNull();
  });
});

describe("button patterns", () => {
  // BTN_DECIDE_RE handles accept/reject/kick button clicks.
  // The regex captures both the action type and the 6-char hex code.
  it("matches review actions with hex code", () => {
    const match = BTN_DECIDE_RE.exec("v1:decide:approve:codeABC123");
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("approve");
    expect(match?.[2]).toBe("ABC123");
  });

  // Codes must be exactly 6 hex chars (uppercase A-F, 0-9).
  // This one is only 5 chars - should be rejected to prevent routing errors.
  it("rejects invalid codes", () => {
    expect(BTN_DECIDE_RE.test("v1:decide:approve:codeXYZ12")).toBe(false);
  });
});
