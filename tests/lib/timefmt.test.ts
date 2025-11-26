/**
 * Pawtropolis Tech — tests/lib/timefmt.test.ts
 * WHAT: Unit tests for timestamp formatting utilities.
 * WHY: Lock behavior of Discord timestamp formats and human-readable age calculations.
 *
 * All functions take Unix epoch SECONDS (not milliseconds). This matches Discord's
 * timestamp format and SQLite's strftime output, but differs from JS Date.now().
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import { toDiscordAbs, toDiscordRel, toIso, fmtAgeShort } from "../../src/lib/timefmt.js";

describe("timefmt utilities", () => {
  /**
   * Discord absolute timestamps render as full date+time in the user's locale.
   * Format: <t:EPOCH:F> where F = "full long" style (e.g., "Monday, January 1, 2024 12:00 PM")
   * See: https://discord.com/developers/docs/reference#message-formatting-timestamp-styles
   */
  describe("toDiscordAbs", () => {
    it("formats epoch seconds as Discord absolute timestamp", () => {
      expect(toDiscordAbs(1729468800)).toBe("<t:1729468800:F>");
      // Edge case: epoch zero is valid and should render as Jan 1, 1970.
      expect(toDiscordAbs(0)).toBe("<t:0:F>");
      // Famous "1234567890" timestamp (Feb 13, 2009) — sometimes used as test data.
      expect(toDiscordAbs(1234567890)).toBe("<t:1234567890:F>");
    });
  });

  /**
   * Discord relative timestamps auto-update in the client (e.g., "2 hours ago").
   * Format: <t:EPOCH:R> where R = "relative" style.
   * Useful for showing "how long ago" something happened without client-side JS.
   */
  describe("toDiscordRel", () => {
    it("formats epoch seconds as Discord relative timestamp", () => {
      expect(toDiscordRel(1729468800)).toBe("<t:1729468800:R>");
      expect(toDiscordRel(0)).toBe("<t:0:R>");
      expect(toDiscordRel(1234567890)).toBe("<t:1234567890:R>");
    });
  });

  /**
   * ISO 8601 format for logs, APIs, and anywhere Discord timestamps don't work.
   * Output is always UTC with milliseconds (even though input is seconds).
   */
  describe("toIso", () => {
    it("formats epoch seconds as ISO 8601 string", () => {
      // 1729468800 = 2024-10-21T00:00:00.000Z
      expect(toIso(1729468800)).toBe("2024-10-21T00:00:00.000Z");

      // 0 = 1970-01-01T00:00:00.000Z (Unix epoch)
      expect(toIso(0)).toBe("1970-01-01T00:00:00.000Z");

      // 1234567890 = 2009-02-13T23:31:30.000Z (the famous timestamp)
      expect(toIso(1234567890)).toBe("2009-02-13T23:31:30.000Z");
    });
  });

  /**
   * fmtAgeShort produces compact human-readable durations for UIs with limited space.
   * Key design decisions:
   * - Always rounds UP (ceiling) to avoid showing "0m" for recent events
   * - Uses single-letter units: m/h/d/w (no months/years)
   * - Takes epoch SECONDS, not milliseconds
   */
  describe("fmtAgeShort", () => {
    // Fixed reference time for deterministic tests.
    // All tests use explicit "now" param to avoid flaky tests from real clock.
    const now = 1729468800; // Reference time: 2024-10-21T00:00:00.000Z

    /**
     * Sub-minute ages round up to 1m. This avoids jarring "0s" displays
     * and acknowledges that sub-minute precision rarely matters in our UIs.
     */
    it("formats ages in seconds as minutes (ceil)", () => {
      // 0-59s all become 1m due to ceiling behavior
      expect(fmtAgeShort(now - 1, now)).toBe("1m");
      expect(fmtAgeShort(now - 30, now)).toBe("1m");
      expect(fmtAgeShort(now - 59, now)).toBe("1m");

      // Exactly 60s = 1m, 61-119s = 2m (ceiling)
      expect(fmtAgeShort(now - 60, now)).toBe("1m");
      expect(fmtAgeShort(now - 119, now)).toBe("2m");

      expect(fmtAgeShort(now - 120, now)).toBe("2m");
      expect(fmtAgeShort(now - 179, now)).toBe("3m");
    });

    /**
     * After ~60 minutes, switch to hours.
     * Again, ceiling rounding: 90 minutes = 2 hours, not 1.5h.
     */
    it("formats ages in minutes/hours as hours (ceil)", () => {
      // 60m = 3600s → 1h
      expect(fmtAgeShort(now - 3600, now)).toBe("1h");

      // 90m = 5400s → 2h (ceiling: 1.5h rounds up)
      expect(fmtAgeShort(now - 5400, now)).toBe("2h");

      // 2h = 7200s → 2h
      expect(fmtAgeShort(now - 7200, now)).toBe("2h");
    });

    /**
     * After ~24 hours, switch to days.
     * 36h = 1.5d = 2d (ceiling).
     */
    it("formats ages in hours/days as days (ceil)", () => {
      // 24h = 86400s → 1d
      expect(fmtAgeShort(now - 86400, now)).toBe("1d");

      // 36h = 129600s → 2d (ceiling)
      expect(fmtAgeShort(now - 129600, now)).toBe("2d");

      // 2d = 172800s → 2d
      expect(fmtAgeShort(now - 172800, now)).toBe("2d");
    });

    /**
     * After ~7 days, switch to weeks.
     * No months or years—for very old timestamps, weeks just keeps incrementing.
     */
    it("formats ages in days/weeks as weeks (ceil)", () => {
      // 7d = 604800s → 1w
      expect(fmtAgeShort(now - 604800, now)).toBe("1w");

      // 10d = 864000s → 2w (ceiling: 1.4w rounds up)
      expect(fmtAgeShort(now - 864000, now)).toBe("2w");

      // 14d = 1209600s → 2w
      expect(fmtAgeShort(now - 1209600, now)).toBe("2w");

      // 15d = 1296000s → 3w (ceiling)
      expect(fmtAgeShort(now - 1296000, now)).toBe("3w");
    });

    /**
     * Edge case: future timestamps and exact "now" both return "0m".
     * Handles clock skew and the boundary condition gracefully.
     */
    it("handles future timestamps as 0m", () => {
      expect(fmtAgeShort(now + 100, now)).toBe("0m");
      expect(fmtAgeShort(now, now)).toBe("0m");
    });

    /**
     * When "now" is omitted, function uses Date.now() / 1000.
     * This test is inherently timing-dependent but uses a regex to stay stable.
     */
    it("uses current time by default", () => {
      const result = fmtAgeShort(Math.floor(Date.now() / 1000) - 60);
      // Should be a number followed by m, h, d, or w
      expect(result).toMatch(/^[0-9]+[mhdw]$/);
    });
  });
});
