/**
 * WHAT: Proves human hints derived from error names/codes are stable (e.g., 10062, 40060, 50013).
 * HOW: Unit-tests hintFor mapping with representative payloads.
 * DOCS: https://vitest.dev/guide/
 *
 * These tests lock the error-to-hint mapping. If you add new error codes or change
 * existing hints, update these tests. The hints appear in user-facing error cards,
 * so changes should be deliberate.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { hintFor } from "../../src/lib/errorCard.js";

describe("hintFor", () => {
  /**
   * SQLite schema errors happen when:
   * - Running on an old DB after a migration
   * - Factory reset leaving orphaned __old tables
   * - Version mismatch between code and schema
   *
   * The hint tells users to use truncate-only reset, which is safer than DROP.
   */
  it("returns migration hint for sqlite missing table", () => {
    const err = new Error("no such table: main.application");
    err.name = "SqliteError";
    expect(hintFor(err)).toBe("Schema mismatch; avoid legacy __old; use truncate-only reset.");
  });

  /**
   * Discord API error 50013 = Missing Permissions.
   * Common causes: bot role too low, channel overwrites blocking bot, missing intents.
   * This is one of the most frequent Discord errors bots encounter.
   */
  it("returns missing permission hint for Discord error code", () => {
    // Discord errors come as objects with numeric codes, not Error instances.
    const err = { code: 50013 };
    expect(hintFor(err)).toBe("Missing Discord permission in this channel.");
  });

  /**
   * Fallback for unrecognized errors. Important that this never throws—
   * we always want SOME hint displayed, even if it's generic.
   */
  it("falls back to default message", () => {
    expect(hintFor(new Error("weird"))).toBe("Unexpected error. Try again or contact staff.");
  });
});
