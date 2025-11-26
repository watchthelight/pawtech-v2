/**
 * Tests for getScan() which retrieves avatar analysis results from the database.
 * The avatar_scan table stores ML model outputs for avatar classification
 * (NSFW detection, furry/scalie scores, edge case flags).
 *
 * Key design decision: getScan never throws. If the table is missing or the row
 * doesn't exist, it returns safe defaults. This prevents review embeds from
 * breaking when the scan pipeline is down or hasn't processed an avatar yet.
 */
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

  /**
   * Simulates a fresh deployment where migrations haven't run yet, or a schema
   * mismatch between environments. The function should gracefully return neutral
   * values rather than crashing the review flow.
   */
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

  /**
   * The scan pipeline runs asynchronously. An application might be submitted
   * before its avatar has been analyzed. The review embed should still render
   * with zeroed-out scores.
   */
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

  /**
   * Tests the snake_case -> camelCase field mapping and NULL coalescing.
   * The DB uses snake_case (edge_score), the API returns camelCase (edgeScore).
   * NULL fields get sensible defaults (0 for scores, "none" for reason).
   */
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
