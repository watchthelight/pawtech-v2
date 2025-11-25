/**
 * WHAT: Proves custom-id routing regexes catch intended patterns and reject unknowns.
 * HOW: Unit-tests identifyModalRoute() and button regexes by example strings.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { BTN_DECIDE_RE, identifyModalRoute } from "../src/lib/modalPatterns.js";

describe("identifyModalRoute", () => {
  it("matches gate modal page with session id", () => {
    const route = identifyModalRoute("v1:modal:abcd:p0");
    expect(route).toEqual({ type: "gate_submit_page", sessionId: "abcd", pageIndex: 0 });
  });

  it("matches review reject modal", () => {
    const route = identifyModalRoute("v1:modal:reject:codeA1B2C3");
    expect(route).toEqual({ type: "review_reject", code: "A1B2C3" });
  });

  it("matches avatar confirm 18 modal", () => {
    const route = identifyModalRoute("v1:avatar:confirm18:codeABCDEF");
    expect(route).toEqual({ type: "avatar_confirm18", code: "ABCDEF" });
  });

  it("treats legacy page ids as unmatched", () => {
    expect(identifyModalRoute("v1:modal:p0")).toBeNull();
  });

  it("returns null for unknown patterns", () => {
    expect(identifyModalRoute("v1:modal:weird:thing")).toBeNull();
  });
});

describe("button patterns", () => {
  it("matches review actions with hex code", () => {
    const match = BTN_DECIDE_RE.exec("v1:decide:approve:codeABC123");
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("approve");
    expect(match?.[2]).toBe("ABC123");
  });

  it("rejects invalid codes", () => {
    expect(BTN_DECIDE_RE.test("v1:decide:approve:codeXYZ12")).toBe(false);
  });
});
