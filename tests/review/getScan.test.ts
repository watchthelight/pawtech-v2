// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "../../src/db/db.js";
import { getScan } from "../../src/features/avatarScan.js";

describe("getScan()", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns safe defaults when avatar_scan table is missing", () => {
    vi.spyOn(db, "prepare").mockImplementation(() => {
      throw new Error("no such table: avatar_scan");
    });

    const result = getScan("missing-app");
    expect(result).toEqual({
      avatarUrl: null,
      finalPct: 0,
      nsfwScore: null,
      edgeScore: 0,
      furryScore: 0,
      scalieScore: 0,
      reason: "none",
      evidence: {
        hard: [],
        soft: [],
        safe: [],
      },
    });
  });

  it("returns safe defaults when no row exists", () => {
    vi.spyOn(db, "prepare").mockReturnValue({
      get: () => undefined,
    } as any);

    const result = getScan("no-row");
    expect(result).toEqual({
      avatarUrl: null,
      finalPct: 0,
      nsfwScore: null,
      edgeScore: 0,
      furryScore: 0,
      scalieScore: 0,
      reason: "none",
      evidence: {
        hard: [],
        soft: [],
        safe: [],
      },
    });
  });

  it("maps database row fields to camelCase with defaults", () => {
    vi.spyOn(db, "prepare").mockReturnValue({
      get: () => ({
        avatar_url: null,
        nsfw_score: 0.42,
        edge_score: null,
        final_pct: 37,
        furry_score: null,
        scalie_score: null,
        reason: null,
      }),
    } as any);

    const result = getScan("app-123");
    expect(result).toEqual({
      avatarUrl: null,
      finalPct: 37,
      nsfwScore: 0.42,
      edgeScore: 0,
      furryScore: 0,
      scalieScore: 0,
      reason: "none",
      evidence: {
        hard: [],
        soft: [],
        safe: [],
      },
    });
  });
});
/**
 * WHAT: Proves getScan returns neutral defaults when row missing and maps DB columns to return shape.
 * HOW: Mocks DB/rows and calls getScan for existing/missing.
 * DOCS: https://vitest.dev/guide/
 */
