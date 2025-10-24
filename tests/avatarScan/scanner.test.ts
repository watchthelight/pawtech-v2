/**
 * WHAT: Proves avatar scanning falls back gracefully when deps are unavailable and that weights/thresholds combine as expected.
 * HOW: Mocks fetch buffer and imports scan/combine; asserts neutral defaults and deterministic finalPct.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalFetch = global.fetch;

async function importScanner() {
  const mod = await import("../../src/features/avatarScan.js");
  return mod;
}

describe("scanAvatar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    global.fetch = originalFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetModules();
  });

  it("returns fallback values when dependencies are unavailable", async () => {
    const { scanAvatar } = await importScanner();

    const buffer = Buffer.from([0]);
    global.fetch = vi.fn().mockResolvedValue(
      new Response(buffer, {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    );

    const result = await scanAvatar("https://cdn.discordapp.com/avatar.png", {
      nsfwThreshold: 0.6,
      edgeThreshold: 0.2,
    });

    // With WD tagger, even when tagger fails or returns empty, we get numeric scores
    expect(result.avatarUrl).toContain("avatar.png");
    expect(result.nsfwScore).toBe(0);
    expect(result.edgeScore).toBe(0);
    expect(result.reason).toBe("none");
    expect(result.finalPct).toBe(0);
  });

  it("combines weights and thresholds consistently", async () => {
    const { combineScanScores } = await importScanner();
    const outcome = combineScanScores(0.8, 1, {
      nsfwThreshold: 0.5,
      edgeThreshold: 0.5,
      wModel: 0.6,
      wEdge: 0.4,
    });

    expect(outcome.reason).toBe("both");
    expect(outcome.finalPct).toBe(88);
  });
});
