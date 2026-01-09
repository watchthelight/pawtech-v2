/**
 * Pawtropolis Tech — tests/features/artJobs/index.test.ts
 * WHAT: Unit tests for art jobs barrel file exports.
 * WHY: Verify all modules are properly re-exported.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi } from "vitest";

// Mock dependencies
vi.mock("../../../src/db/db.js", () => ({
  db: {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn(),
      all: vi.fn(),
      run: vi.fn(),
    }),
    transaction: vi.fn((fn) => fn),
  },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("artJobs/index", () => {
  it("exports all expected types", async () => {
    const exports = await import("../../../src/features/artJobs/index.js");

    // From types.ts
    expect(exports).toHaveProperty("JOB_STATUSES");
  });

  it("exports all expected store functions", async () => {
    const exports = await import("../../../src/features/artJobs/index.js");

    // From store.ts
    expect(exports).toHaveProperty("createJob");
    expect(exports).toHaveProperty("getJobById");
    expect(exports).toHaveProperty("getJobByNumber");
    expect(exports).toHaveProperty("getJobByArtistNumber");
    expect(exports).toHaveProperty("getJobByRecipient");
    expect(exports).toHaveProperty("getActiveJobsForArtist");
    expect(exports).toHaveProperty("getAllActiveJobs");
    expect(exports).toHaveProperty("getActiveJobsForRecipient");
    expect(exports).toHaveProperty("updateJobStatus");
    expect(exports).toHaveProperty("finishJob");
    expect(exports).toHaveProperty("getMonthlyLeaderboard");
    expect(exports).toHaveProperty("getAllTimeLeaderboard");
    expect(exports).toHaveProperty("getArtistStats");
    expect(exports).toHaveProperty("formatJobNumber");
  });

  it("exports JOB_STATUSES with correct values", async () => {
    const { JOB_STATUSES } = await import("../../../src/features/artJobs/index.js");

    expect(JOB_STATUSES).toContain("assigned");
    expect(JOB_STATUSES).toContain("sketching");
    expect(JOB_STATUSES).toContain("lining");
    expect(JOB_STATUSES).toContain("coloring");
    expect(JOB_STATUSES).toContain("done");
    expect(JOB_STATUSES).toHaveLength(5);
  });

  it("exports functions that are callable", async () => {
    const exports = await import("../../../src/features/artJobs/index.js");

    expect(typeof exports.createJob).toBe("function");
    expect(typeof exports.getJobById).toBe("function");
    expect(typeof exports.formatJobNumber).toBe("function");
  });
});
