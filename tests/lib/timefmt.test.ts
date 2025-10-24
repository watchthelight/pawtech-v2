/**
 * Pawtropolis Tech — tests/lib/timefmt.test.ts
 * WHAT: Unit tests for timestamp formatting utilities.
 * WHY: Lock behavior of Discord timestamp formats and human-readable age calculations.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import { toDiscordAbs, toDiscordRel, toIso, fmtAgeShort } from "../../src/lib/timefmt.js";

describe("timefmt utilities", () => {
  describe("toDiscordAbs", () => {
    it("formats epoch seconds as Discord absolute timestamp", () => {
      expect(toDiscordAbs(1729468800)).toBe("<t:1729468800:F>");
      expect(toDiscordAbs(0)).toBe("<t:0:F>");
      expect(toDiscordAbs(1234567890)).toBe("<t:1234567890:F>");
    });
  });

  describe("toDiscordRel", () => {
    it("formats epoch seconds as Discord relative timestamp", () => {
      expect(toDiscordRel(1729468800)).toBe("<t:1729468800:R>");
      expect(toDiscordRel(0)).toBe("<t:0:R>");
      expect(toDiscordRel(1234567890)).toBe("<t:1234567890:R>");
    });
  });

  describe("toIso", () => {
    it("formats epoch seconds as ISO 8601 string", () => {
      // 1729468800 = 2024-10-21T00:00:00.000Z
      expect(toIso(1729468800)).toBe("2024-10-21T00:00:00.000Z");

      // 0 = 1970-01-01T00:00:00.000Z
      expect(toIso(0)).toBe("1970-01-01T00:00:00.000Z");

      // 1234567890 = 2009-02-13T23:31:30.000Z
      expect(toIso(1234567890)).toBe("2009-02-13T23:31:30.000Z");
    });
  });

  describe("fmtAgeShort", () => {
    const now = 1729468800; // Reference time: 2024-10-21T00:00:00.000Z

    it("formats ages in seconds as minutes (ceil)", () => {
      // 0-59s → 1m
      expect(fmtAgeShort(now - 1, now)).toBe("1m");
      expect(fmtAgeShort(now - 30, now)).toBe("1m");
      expect(fmtAgeShort(now - 59, now)).toBe("1m");

      // 60-119s → 1m
      expect(fmtAgeShort(now - 60, now)).toBe("1m");
      expect(fmtAgeShort(now - 119, now)).toBe("2m");

      // 120-179s → 2m
      expect(fmtAgeShort(now - 120, now)).toBe("2m");
      expect(fmtAgeShort(now - 179, now)).toBe("3m");
    });

    it("formats ages in minutes/hours as hours (ceil)", () => {
      // 60m = 3600s → 1h
      expect(fmtAgeShort(now - 3600, now)).toBe("1h");

      // 90m = 5400s → 2h (ceil)
      expect(fmtAgeShort(now - 5400, now)).toBe("2h");

      // 2h = 7200s → 2h
      expect(fmtAgeShort(now - 7200, now)).toBe("2h");
    });

    it("formats ages in hours/days as days (ceil)", () => {
      // 24h = 86400s → 1d
      expect(fmtAgeShort(now - 86400, now)).toBe("1d");

      // 36h = 129600s → 2d (ceil)
      expect(fmtAgeShort(now - 129600, now)).toBe("2d");

      // 2d = 172800s → 2d
      expect(fmtAgeShort(now - 172800, now)).toBe("2d");
    });

    it("formats ages in days/weeks as weeks (ceil)", () => {
      // 7d = 604800s → 1w
      expect(fmtAgeShort(now - 604800, now)).toBe("1w");

      // 10d = 864000s → 2w (ceil)
      expect(fmtAgeShort(now - 864000, now)).toBe("2w");

      // 14d = 1209600s → 2w
      expect(fmtAgeShort(now - 1209600, now)).toBe("2w");

      // 15d = 1296000s → 3w (ceil)
      expect(fmtAgeShort(now - 1296000, now)).toBe("3w");
    });

    it("handles future timestamps as 0m", () => {
      expect(fmtAgeShort(now + 100, now)).toBe("0m");
      expect(fmtAgeShort(now, now)).toBe("0m");
    });

    it("uses current time by default", () => {
      const result = fmtAgeShort(Math.floor(Date.now() / 1000) - 60);
      expect(result).toMatch(/^[0-9]+[mhdw]$/);
    });
  });
});
