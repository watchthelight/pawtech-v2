/**
 * Pawtropolis Tech — tests/lib/dt.test.ts
 * WHAT: Unit tests for Discord timestamp helpers.
 * WHY: Verify Discord timestamp formatting.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import { toUnix, ts } from "../../src/lib/dt.js";

describe("dt", () => {
  describe("toUnix", () => {
    it("converts Date object to Unix seconds", () => {
      const date = new Date("2024-10-20T20:00:00.000Z");
      const result = toUnix(date);

      expect(result).toBe(1729454400);
    });

    it("converts milliseconds number to Unix seconds", () => {
      const ms = 1729454400000; // 2024-10-20T20:00:00.000Z in ms
      const result = toUnix(ms);

      expect(result).toBe(1729454400);
    });

    it("floors sub-second timestamps", () => {
      const date = new Date("2024-10-20T20:00:00.999Z");
      const result = toUnix(date);

      expect(result).toBe(1729454400);
    });

    it("handles epoch zero", () => {
      const date = new Date(0);
      const result = toUnix(date);

      expect(result).toBe(0);
    });

    it("handles milliseconds at epoch", () => {
      const result = toUnix(0);

      expect(result).toBe(0);
    });

    it("returns integer values", () => {
      const date = new Date("2024-10-20T20:00:00.500Z");
      const result = toUnix(date);

      expect(Number.isInteger(result)).toBe(true);
    });
  });

  describe("ts", () => {
    describe("with Date object", () => {
      it("formats short date/time by default", () => {
        const date = new Date("2024-10-20T20:00:00.000Z");
        const result = ts(date);

        expect(result).toBe("<t:1729454400:f>");
      });

      it("formats short date/time with explicit f style", () => {
        const date = new Date("2024-10-20T20:00:00.000Z");
        const result = ts(date, "f");

        expect(result).toBe("<t:1729454400:f>");
      });

      it("formats relative time with R style", () => {
        const date = new Date("2024-10-20T20:00:00.000Z");
        const result = ts(date, "R");

        expect(result).toBe("<t:1729454400:R>");
      });
    });

    describe("with milliseconds number", () => {
      it("formats short date/time by default", () => {
        const ms = 1729454400000;
        const result = ts(ms);

        expect(result).toBe("<t:1729454400:f>");
      });

      it("formats relative time with R style", () => {
        const ms = 1729454400000;
        const result = ts(ms, "R");

        expect(result).toBe("<t:1729454400:R>");
      });
    });

    describe("edge cases", () => {
      it("handles epoch zero", () => {
        const result = ts(new Date(0));

        expect(result).toBe("<t:0:f>");
      });

      it("handles epoch zero in relative style", () => {
        const result = ts(0, "R");

        expect(result).toBe("<t:0:R>");
      });

      it("outputs valid Discord timestamp format", () => {
        const date = new Date();
        const result = ts(date);

        // Should match Discord timestamp format
        expect(result).toMatch(/^<t:\d+:f>$/);
      });

      it("outputs valid Discord timestamp format for relative", () => {
        const date = new Date();
        const result = ts(date, "R");

        // Should match Discord timestamp format
        expect(result).toMatch(/^<t:\d+:R>$/);
      });
    });
  });
});
