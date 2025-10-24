/**
 * WHAT: Proves human hints derived from error names/codes are stable (e.g., 10062, 40060, 50013).
 * HOW: Unit-tests hintFor mapping with representative payloads.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { hintFor } from "../../src/lib/errorCard.js";

describe("hintFor", () => {
  it("returns migration hint for sqlite missing table", () => {
    const err = new Error("no such table: main.application");
    err.name = "SqliteError";
    expect(hintFor(err)).toBe("Schema mismatch; avoid legacy __old; use truncate-only reset.");
  });

  it("returns missing permission hint for Discord error code", () => {
    const err = { code: 50013 };
    expect(hintFor(err)).toBe("Missing Discord permission in this channel.");
  });

  it("falls back to default message", () => {
    expect(hintFor(new Error("weird"))).toBe("Unexpected error. Try again or contact staff.");
  });
});
