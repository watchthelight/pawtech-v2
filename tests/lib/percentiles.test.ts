/**
 * Pawtropolis Tech — tests/lib/percentiles.test.ts
 * WHAT: Unit tests for percentile calculation utilities.
 * WHY: Verify percentile computation logic for metrics.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import { computePercentiles } from "../../src/lib/percentiles.js";

describe("percentiles", () => {
  describe("computePercentiles", () => {
    describe("empty input", () => {
      it("returns null for all requested percentiles when values array is empty", () => {
        const result = computePercentiles([], [50, 95]);

        expect(result.get(50)).toBeNull();
        expect(result.get(95)).toBeNull();
      });

      it("handles empty percentiles array", () => {
        const result = computePercentiles([1, 2, 3], []);

        expect(result.size).toBe(0);
      });
    });

    describe("single value", () => {
      it("returns the single value for all percentiles", () => {
        const result = computePercentiles([42], [0, 50, 100]);

        expect(result.get(0)).toBe(42);
        expect(result.get(50)).toBe(42);
        expect(result.get(100)).toBe(42);
      });
    });

    describe("standard percentile calculations", () => {
      it("computes p50 (median) correctly for odd-length array", () => {
        const values = [1, 2, 3, 4, 5];
        const result = computePercentiles(values, [50]);

        expect(result.get(50)).toBe(3);
      });

      it("computes p50 (median) correctly for even-length array", () => {
        const values = [1, 2, 3, 4, 5, 6];
        const result = computePercentiles(values, [50]);

        // Nearest-rank method: ceil(0.5 * 6) - 1 = 2, so index 2 = value 3
        expect(result.get(50)).toBe(3);
      });

      it("computes p95 correctly", () => {
        const values = [100, 200, 300, 400, 500];
        const result = computePercentiles(values, [95]);

        // ceil(0.95 * 5) - 1 = 4, so index 4 = 500
        expect(result.get(95)).toBe(500);
      });

      it("computes multiple percentiles at once", () => {
        const values = [100, 200, 300, 400, 500];
        const result = computePercentiles(values, [50, 95]);

        expect(result.get(50)).toBe(300);
        expect(result.get(95)).toBe(500);
      });
    });

    describe("unsorted input", () => {
      it("handles unsorted input correctly", () => {
        const values = [500, 100, 300, 400, 200];
        const result = computePercentiles(values, [50]);

        expect(result.get(50)).toBe(300);
      });

      it("does not mutate the original array", () => {
        const values = [5, 1, 4, 2, 3];
        const original = [...values];
        computePercentiles(values, [50]);

        expect(values).toEqual(original);
      });
    });

    describe("edge percentiles", () => {
      it("computes p0 (minimum)", () => {
        const values = [10, 20, 30, 40, 50];
        const result = computePercentiles(values, [0]);

        expect(result.get(0)).toBe(10);
      });

      it("computes p100 (maximum)", () => {
        const values = [10, 20, 30, 40, 50];
        const result = computePercentiles(values, [100]);

        expect(result.get(100)).toBe(50);
      });

      it("computes p25 (first quartile)", () => {
        const values = [1, 2, 3, 4, 5, 6, 7, 8];
        const result = computePercentiles(values, [25]);

        // ceil(0.25 * 8) - 1 = 1, so index 1 = 2
        expect(result.get(25)).toBe(2);
      });

      it("computes p75 (third quartile)", () => {
        const values = [1, 2, 3, 4, 5, 6, 7, 8];
        const result = computePercentiles(values, [75]);

        // ceil(0.75 * 8) - 1 = 5, so index 5 = 6
        expect(result.get(75)).toBe(6);
      });
    });

    describe("duplicate values", () => {
      it("handles arrays with duplicate values", () => {
        const values = [5, 5, 5, 5, 5];
        const result = computePercentiles(values, [50, 95]);

        expect(result.get(50)).toBe(5);
        expect(result.get(95)).toBe(5);
      });

      it("handles arrays with some duplicates", () => {
        const values = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
        const result = computePercentiles(values, [50]);

        expect(result.get(50)).toBe(3);
      });
    });

    describe("large arrays", () => {
      it("handles large arrays efficiently", () => {
        const values = Array.from({ length: 1000 }, (_, i) => i + 1);
        const result = computePercentiles(values, [50, 90, 99]);

        expect(result.get(50)).toBe(500);
        expect(result.get(90)).toBe(900);
        expect(result.get(99)).toBe(990);
      });
    });

    describe("decimal values", () => {
      it("handles decimal values in array", () => {
        const values = [1.5, 2.5, 3.5, 4.5, 5.5];
        const result = computePercentiles(values, [50]);

        expect(result.get(50)).toBe(3.5);
      });
    });

    describe("negative values", () => {
      it("handles negative values in array", () => {
        const values = [-5, -3, -1, 0, 1, 3, 5];
        const result = computePercentiles(values, [50]);

        expect(result.get(50)).toBe(0);
      });
    });

    describe("return type", () => {
      it("returns a Map", () => {
        const result = computePercentiles([1, 2, 3], [50]);

        expect(result).toBeInstanceOf(Map);
      });

      it("returns Map with correct size", () => {
        const result = computePercentiles([1, 2, 3], [25, 50, 75, 95]);

        expect(result.size).toBe(4);
      });
    });
  });
});
