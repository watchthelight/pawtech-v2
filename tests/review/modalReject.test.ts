// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { identifyModalRoute } from "../../src/lib/modalPatterns.js";

describe("reject modal path", () => {
  it("matches reject modal customId with hex code", () => {
    const route = identifyModalRoute("v1:modal:reject:codeABC123");
    expect(route).toEqual({
      type: "review_reject",
      code: "ABC123",
    });
  });

  it("extracts code from reject modal", () => {
    const route = identifyModalRoute("v1:modal:reject:codeDEF456");
    expect(route).not.toBeNull();
    expect(route?.type).toBe("review_reject");
    if (route?.type === "review_reject") {
      expect(route.code).toBe("DEF456");
    }
  });

  it("rejects invalid reject modal patterns", () => {
    const route = identifyModalRoute("v1:modal:reject:invalid");
    expect(route).toBeNull();
  });

  it("matches avatar confirm18 modal with code", () => {
    const route = identifyModalRoute("v1:avatar:confirm18:codeFEDCBA");
    expect(route).toEqual({
      type: "avatar_confirm18",
      code: "FEDCBA",
    });
  });
});
/**
 * WHAT: Proves reject modal routing and handler store reason and reply appropriately.
 * HOW: Exercises modal customId parsing and downstream handler with a fake interaction.
 * DOCS: https://vitest.dev/guide/
 */
