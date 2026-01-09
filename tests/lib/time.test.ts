/**
 * Pawtropolis Tech — tests/lib/time.test.ts
 * WHAT: Unit tests for Unix timestamp utilities.
 * WHY: Verify timestamp conversion and formatting logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nowUtc, tsToIso, formatUtc, formatRelative } from "../../src/lib/time.js";

describe("time", () => {
  describe("nowUtc", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns current Unix timestamp in seconds", () => {
      // Set to a known time: 2024-10-20 20:00:00 UTC
      vi.setSystemTime(new Date("2024-10-20T20:00:00.000Z"));

      const result = nowUtc();

      expect(result).toBe(1729454400);
    });

    it("floors sub-second timestamps", () => {
      // Set to a known time with milliseconds
      vi.setSystemTime(new Date("2024-10-20T20:00:00.999Z"));

      const result = nowUtc();

      // Should floor, not round
      expect(result).toBe(1729454400);
    });

    it("returns integer values", () => {
      vi.setSystemTime(new Date("2024-10-20T20:00:00.500Z"));

      const result = nowUtc();

      expect(Number.isInteger(result)).toBe(true);
    });
  });

  describe("tsToIso", () => {
    it("converts Unix seconds to ISO8601 string", () => {
      const result = tsToIso(1729454400);

      expect(result).toBe("2024-10-20T20:00:00.000Z");
    });

    it("handles epoch zero", () => {
      const result = tsToIso(0);

      expect(result).toBe("1970-01-01T00:00:00.000Z");
    });

    it("handles future timestamps", () => {
      // Year 2100
      const result = tsToIso(4102444800);

      expect(result).toBe("2100-01-01T00:00:00.000Z");
    });

    it("handles timestamps from early 2000s", () => {
      // 2000-01-01 00:00:00 UTC
      const result = tsToIso(946684800);

      expect(result).toBe("2000-01-01T00:00:00.000Z");
    });
  });

  describe("formatUtc", () => {
    it("formats timestamp as readable UTC string", () => {
      const result = formatUtc(1729454400);

      expect(result).toBe("2024-10-20 20:00 UTC");
    });

    it("handles midnight correctly", () => {
      // 2024-01-01 00:00:00 UTC
      const result = formatUtc(1704067200);

      expect(result).toBe("2024-01-01 00:00 UTC");
    });

    it("handles end of day correctly", () => {
      // 2024-01-01 23:59:00 UTC
      const result = formatUtc(1704153540);

      expect(result).toBe("2024-01-01 23:59 UTC");
    });

    it("strips seconds from output", () => {
      // Time with seconds: 2024-01-01 12:34:56 UTC
      const result = formatUtc(1704112496);

      expect(result).not.toContain(":56");
      expect(result).toBe("2024-01-01 12:34 UTC");
    });
  });

  describe("formatRelative", () => {
    const fixedNow = 1700000000; // Reference time

    it("shows 'just now' for current time", () => {
      const result = formatRelative(fixedNow, fixedNow);

      expect(result).toBe("just now");
    });

    it("shows seconds for recent times", () => {
      expect(formatRelative(fixedNow - 30, fixedNow)).toBe("30s ago");
      expect(formatRelative(fixedNow - 59, fixedNow)).toBe("59s ago");
    });

    it("shows minutes for times under an hour", () => {
      expect(formatRelative(fixedNow - 60, fixedNow)).toBe("1m ago");
      expect(formatRelative(fixedNow - 120, fixedNow)).toBe("2m ago");
      expect(formatRelative(fixedNow - 840, fixedNow)).toBe("14m ago");
      expect(formatRelative(fixedNow - 3540, fixedNow)).toBe("59m ago");
    });

    it("shows hours for times under a day", () => {
      expect(formatRelative(fixedNow - 3600, fixedNow)).toBe("1h ago");
      expect(formatRelative(fixedNow - 7200, fixedNow)).toBe("2h ago");
      expect(formatRelative(fixedNow - 82800, fixedNow)).toBe("23h ago");
    });

    it("shows days for times under a week", () => {
      expect(formatRelative(fixedNow - 86400, fixedNow)).toBe("1d ago");
      expect(formatRelative(fixedNow - 172800, fixedNow)).toBe("2d ago");
      expect(formatRelative(fixedNow - 518400, fixedNow)).toBe("6d ago");
    });

    it("shows weeks for times under a month", () => {
      expect(formatRelative(fixedNow - 604800, fixedNow)).toBe("1wk ago");
      expect(formatRelative(fixedNow - 1209600, fixedNow)).toBe("2wk ago");
    });

    it("shows months for times under a year", () => {
      // Need to be well past the week threshold (4.348 weeks = ~30.44 days)
      // Use 35 days which is clearly past 4.348 weeks
      const thirtyFiveDays = 35 * 24 * 60 * 60;
      expect(formatRelative(fixedNow - thirtyFiveDays, fixedNow)).toBe("1mo ago");
      // 6 months = ~183 days
      const sixMonths = 183 * 24 * 60 * 60;
      expect(formatRelative(fixedNow - sixMonths, fixedNow)).toBe("6mo ago");
    });

    it("shows years for very old times", () => {
      // The algorithm converts: seconds → minutes → hours → days → weeks → months → years
      // To get years, we need >= 12 months in the algorithm's calculation
      // 12 months = 12 * 4.348 weeks * 7 days = ~365.23 days
      // Use 400 days to be safely in years territory
      const fourHundredDays = 400 * 24 * 60 * 60;
      expect(formatRelative(fixedNow - fourHundredDays, fixedNow)).toBe("1y ago");
      // 5 years = well over 400 * 5 days
      const fiveYearsApprox = 2000 * 24 * 60 * 60;
      expect(formatRelative(fixedNow - fiveYearsApprox, fixedNow)).toBe("5y ago");
    });

    it("clamps future timestamps to 'just now'", () => {
      // Future time (clock skew scenario)
      const result = formatRelative(fixedNow + 100, fixedNow);

      expect(result).toBe("just now");
    });

    it("uses current time when nowSec not provided", () => {
      // This test just verifies it doesn't throw
      const result = formatRelative(Math.floor(Date.now() / 1000) - 60);

      expect(result).toMatch(/\d+[smhdwkoy]+ ago|just now/);
    });
  });
});
