/**
 * Pawtropolis Tech — tests/lib/anomaly.test.ts
 * WHAT: Unit tests for anomaly detection utilities.
 * WHY: Verify z-score calculation and anomaly detection logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import { detectAnomaly, detectModeratorAnomalies } from "../../src/lib/anomaly.js";

describe("anomaly", () => {
  describe("detectAnomaly", () => {
    describe("insufficient data", () => {
      it("returns no anomaly for empty population", () => {
        const result = detectAnomaly(100, []);

        expect(result.isAnomaly).toBe(false);
        expect(result.score).toBe(0);
        expect(result.reason).toBeNull();
      });

      it("returns no anomaly for population of 1", () => {
        const result = detectAnomaly(100, [50]);

        expect(result.isAnomaly).toBe(false);
        expect(result.score).toBe(0);
        expect(result.reason).toBeNull();
      });

      it("returns no anomaly for population of 2", () => {
        const result = detectAnomaly(100, [50, 60]);

        expect(result.isAnomaly).toBe(false);
        expect(result.score).toBe(0);
        expect(result.reason).toBeNull();
      });
    });

    describe("zero variance population", () => {
      it("detects spike above baseline", () => {
        const result = detectAnomaly(15, [10, 10, 10, 10, 10]);

        expect(result.isAnomaly).toBe(true);
        expect(result.score).toBe(Infinity);
        expect(result.reason).toBe("spike_above_baseline");
      });

      it("detects drop below baseline", () => {
        const result = detectAnomaly(5, [10, 10, 10, 10, 10]);

        expect(result.isAnomaly).toBe(true);
        expect(result.score).toBe(Infinity);
        expect(result.reason).toBe("drop_below_baseline");
      });

      it("returns no anomaly when value matches constant baseline", () => {
        const result = detectAnomaly(10, [10, 10, 10, 10, 10]);

        expect(result.isAnomaly).toBe(false);
        expect(result.score).toBe(0);
        expect(result.reason).toBeNull();
      });
    });

    describe("normal distribution detection", () => {
      it("does not flag normal values", () => {
        // Population with mean ~50, std ~14.14
        const population = [30, 40, 50, 60, 70];
        const result = detectAnomaly(55, population);

        expect(result.isAnomaly).toBe(false);
        expect(result.score).toBeLessThan(3.0);
        expect(result.reason).toBeNull();
      });

      it("detects high outlier with default threshold", () => {
        // Population with mean ~50, std ~14.14
        const population = [30, 40, 50, 60, 70];
        // Value 100 is ~3.5 std devs above mean
        const result = detectAnomaly(100, population);

        expect(result.isAnomaly).toBe(true);
        expect(result.score).toBeGreaterThan(3.0);
        expect(result.reason).toBe("spike_in_total_actions");
      });

      it("detects low outlier with default threshold", () => {
        // Population with mean ~50, std ~14.14
        const population = [30, 40, 50, 60, 70];
        // Value 0 is ~3.5 std devs below mean
        const result = detectAnomaly(0, population);

        expect(result.isAnomaly).toBe(true);
        expect(result.score).toBeGreaterThan(3.0);
        expect(result.reason).toBe("drop_in_total_actions");
      });
    });

    describe("custom threshold", () => {
      it("respects lower threshold", () => {
        const population = [30, 40, 50, 60, 70];
        // Value 75 is about 1.77 std devs above mean
        const result = detectAnomaly(75, population, 1.5);

        expect(result.isAnomaly).toBe(true);
        expect(result.reason).toBe("spike_in_total_actions");
      });

      it("respects higher threshold", () => {
        const population = [30, 40, 50, 60, 70];
        // Value 100 is ~3.5 std devs above mean
        const result = detectAnomaly(100, population, 4.0);

        expect(result.isAnomaly).toBe(false);
        expect(result.reason).toBeNull();
      });
    });

    describe("edge cases", () => {
      it("handles all same values in population", () => {
        const result = detectAnomaly(5, [5, 5, 5, 5, 5]);

        expect(result.isAnomaly).toBe(false);
        expect(result.score).toBe(0);
      });

      it("handles negative values in population", () => {
        const population = [-10, -5, 0, 5, 10];
        const result = detectAnomaly(0, population);

        expect(result.isAnomaly).toBe(false);
      });

      it("handles large population", () => {
        const population = Array.from({ length: 100 }, (_, i) => i);
        const result = detectAnomaly(50, population);

        expect(result.isAnomaly).toBe(false);
      });
    });
  });

  describe("detectModeratorAnomalies", () => {
    describe("insufficient data", () => {
      it("returns no anomaly for empty daily counts", () => {
        const result = detectModeratorAnomalies([]);

        expect(result.isAnomaly).toBe(false);
        expect(result.score).toBe(0);
        expect(result.reason).toBeNull();
      });

      it("returns no anomaly for single day of data", () => {
        const result = detectModeratorAnomalies([10]);

        expect(result.isAnomaly).toBe(false);
        expect(result.score).toBe(0);
        expect(result.reason).toBeNull();
      });
    });

    describe("normal activity patterns", () => {
      it("does not flag consistent activity", () => {
        const dailyCounts = [10, 12, 11, 10, 13, 11, 12];
        const result = detectModeratorAnomalies(dailyCounts);

        expect(result.isAnomaly).toBe(false);
      });

      it("does not flag small variations", () => {
        const dailyCounts = [5, 8, 6, 7, 9, 8, 7];
        const result = detectModeratorAnomalies(dailyCounts);

        expect(result.isAnomaly).toBe(false);
      });
    });

    describe("anomalous activity patterns", () => {
      it("detects sudden activity spike", () => {
        // Consistent 10 actions/day, then suddenly 100
        const dailyCounts = [10, 11, 9, 12, 10, 11, 100];
        const result = detectModeratorAnomalies(dailyCounts);

        expect(result.isAnomaly).toBe(true);
        expect(result.reason).toBe("spike_in_total_actions");
      });

      it("detects sudden activity drop", () => {
        // Consistent 50 actions/day, then suddenly 0
        const dailyCounts = [50, 48, 52, 49, 51, 50, 0];
        const result = detectModeratorAnomalies(dailyCounts);

        expect(result.isAnomaly).toBe(true);
        expect(result.reason).toBe("drop_in_total_actions");
      });
    });

    describe("custom threshold", () => {
      it("respects custom threshold parameter", () => {
        // With default 2.5 threshold, this might not flag
        // With 1.5 threshold, should flag
        const dailyCounts = [10, 11, 9, 12, 10, 11, 20];
        const result = detectModeratorAnomalies(dailyCounts, 1.5);

        expect(result.isAnomaly).toBe(true);
      });

      it("allows higher threshold to be less sensitive", () => {
        // With high threshold (5.0), moderate spikes shouldn't flag
        // Historical: [10, 11, 9, 12, 10, 11] → mean=10.5, std≈1.05
        // Value 15: z-score = |15-10.5|/1.05 ≈ 4.29 < 5.0
        const dailyCounts = [10, 11, 9, 12, 10, 11, 15];
        const result = detectModeratorAnomalies(dailyCounts, 5.0);

        expect(result.isAnomaly).toBe(false);
      });
    });

    describe("compares most recent to historical", () => {
      it("uses most recent day as the value to test", () => {
        // If last value is normal, shouldn't flag even if earlier values were weird
        const dailyCounts = [100, 5, 200, 3, 10];
        const result = detectModeratorAnomalies(dailyCounts);

        // The most recent (10) is compared against historical [100, 5, 200, 3]
        // This has high variance, so 10 shouldn't be flagged
        expect(result.isAnomaly).toBe(false);
      });
    });
  });
});
