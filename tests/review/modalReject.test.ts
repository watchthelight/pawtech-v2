// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Modal Rejection Routing Tests
 *
 * These tests verify the modal customId parser correctly identifies reject/confirm
 * modals from Discord interactions. The customId format is:
 *   v1:modal:{type}:code{HEX6}
 *
 * The HEX6 code is a short identifier extracted from the full application UUID,
 * used to link modal submissions back to their source applications without
 * exposing the full ID in the Discord UI.
 */
import { describe, it, expect } from "vitest";
import { identifyModalRoute } from "../../src/lib/modalPatterns.js";

describe("reject modal path", () => {
  // Tests the happy path: valid customId with proper prefix and hex code extraction
  it("matches reject modal customId with hex code", () => {
    const route = identifyModalRoute("v1:modal:reject:codeABC123");
    expect(route).toEqual({
      type: "review_reject",
      code: "ABC123",
    });
  });

  // Verifies type narrowing works correctly - the route object should
  // have the code property accessible after the type guard
  it("extracts code from reject modal", () => {
    const route = identifyModalRoute("v1:modal:reject:codeDEF456");
    expect(route).not.toBeNull();
    expect(route?.type).toBe("review_reject");
    if (route?.type === "review_reject") {
      expect(route.code).toBe("DEF456");
    }
  });

  // Edge case: "code" prefix is required. Without it, the customId is malformed.
  // This guards against someone manually crafting invalid modal IDs.
  it("rejects invalid reject modal patterns", () => {
    const route = identifyModalRoute("v1:modal:reject:invalid");
    expect(route).toBeNull();
  });

  // Different modal namespace (avatar vs review) but same code extraction pattern.
  // confirm18 is the 18+ age verification flow for avatar review.
  it("matches avatar confirm18 modal with code", () => {
    const route = identifyModalRoute("v1:avatar:confirm18:codeFEDCBA");
    expect(route).toEqual({
      type: "avatar_confirm18",
      code: "FEDCBA",
    });
  });
});
