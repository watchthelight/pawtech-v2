/**
 * Pawtropolis Tech — tests/features/events/gameQualification.test.ts
 * WHAT: Unit tests for game night qualification logic.
 * WHY: Verify percentage-based qualification calculations work correctly.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import {
  calculateGameQualification,
  calculateGameSessionQualification,
  formatQualificationResult,
  minutesNeededToQualify,
} from "../../../src/features/events/gameQualification.js";
import type { EventSession, GuildGameConfig } from "../../../src/features/events/types.js";

describe("gameQualification", () => {
  describe("calculateGameQualification", () => {
    describe("basic qualification logic", () => {
      it("qualifies user who meets exact threshold percentage", () => {
        // 2-hour event (120 min), 50% threshold = need 60 min
        const startTime = 0;
        const endTime = 120 * 60 * 1000; // 120 minutes in ms
        const result = calculateGameQualification(60, startTime, endTime, 50);

        expect(result.qualified).toBe(true);
        expect(result.userMinutes).toBe(60);
        expect(result.eventDurationMinutes).toBe(120);
        expect(result.attendancePercentage).toBe(50);
        expect(result.thresholdPercentage).toBe(50);
        expect(result.requiredMinutes).toBe(60);
      });

      it("qualifies user who exceeds threshold percentage", () => {
        const startTime = 0;
        const endTime = 120 * 60 * 1000;
        const result = calculateGameQualification(90, startTime, endTime, 50);

        expect(result.qualified).toBe(true);
        expect(result.attendancePercentage).toBe(75);
      });

      it("does not qualify user below threshold percentage", () => {
        const startTime = 0;
        const endTime = 120 * 60 * 1000;
        const result = calculateGameQualification(30, startTime, endTime, 50);

        expect(result.qualified).toBe(false);
        expect(result.attendancePercentage).toBe(25);
        expect(result.requiredMinutes).toBe(60);
      });

      it("does not qualify user with zero minutes", () => {
        const startTime = 0;
        const endTime = 120 * 60 * 1000;
        const result = calculateGameQualification(0, startTime, endTime, 50);

        expect(result.qualified).toBe(false);
        expect(result.attendancePercentage).toBe(0);
        expect(result.userMinutes).toBe(0);
      });
    });

    describe("different threshold percentages", () => {
      it("calculates correctly with 25% threshold", () => {
        const startTime = 0;
        const endTime = 100 * 60 * 1000; // 100 minutes
        const result = calculateGameQualification(25, startTime, endTime, 25);

        expect(result.qualified).toBe(true);
        expect(result.requiredMinutes).toBe(25);
      });

      it("calculates correctly with 75% threshold", () => {
        const startTime = 0;
        const endTime = 100 * 60 * 1000;
        const result = calculateGameQualification(74, startTime, endTime, 75);

        expect(result.qualified).toBe(false);
        expect(result.requiredMinutes).toBe(75);
      });

      it("calculates correctly with 100% threshold", () => {
        const startTime = 0;
        const endTime = 60 * 60 * 1000;
        const result = calculateGameQualification(60, startTime, endTime, 100);

        expect(result.qualified).toBe(true);
        expect(result.requiredMinutes).toBe(60);
      });

      it("calculates correctly with 1% threshold", () => {
        const startTime = 0;
        const endTime = 100 * 60 * 1000;
        const result = calculateGameQualification(1, startTime, endTime, 1);

        expect(result.qualified).toBe(true);
        expect(result.requiredMinutes).toBe(1);
      });
    });

    describe("different event durations", () => {
      it("handles short 30-minute event", () => {
        const startTime = 0;
        const endTime = 30 * 60 * 1000;
        const result = calculateGameQualification(15, startTime, endTime, 50);

        expect(result.qualified).toBe(true);
        expect(result.eventDurationMinutes).toBe(30);
        expect(result.requiredMinutes).toBe(15);
      });

      it("handles 3-hour event", () => {
        const startTime = 0;
        const endTime = 180 * 60 * 1000;
        const result = calculateGameQualification(90, startTime, endTime, 50);

        expect(result.qualified).toBe(true);
        expect(result.eventDurationMinutes).toBe(180);
        expect(result.requiredMinutes).toBe(90);
      });

      it("handles very long 6-hour event", () => {
        const startTime = 0;
        const endTime = 360 * 60 * 1000;
        const result = calculateGameQualification(180, startTime, endTime, 50);

        expect(result.qualified).toBe(true);
        expect(result.eventDurationMinutes).toBe(360);
      });
    });

    describe("edge cases", () => {
      it("handles zero-duration event (division by zero protection)", () => {
        const time = Date.now();
        const result = calculateGameQualification(10, time, time, 50);

        // When event duration is 0, required minutes is 0 (ceil(0 * 0.50) = 0)
        // User has 10 minutes, 10 >= 0, so they qualify
        expect(result.qualified).toBe(true);
        expect(result.eventDurationMinutes).toBe(0);
        expect(result.attendancePercentage).toBe(0);
        expect(result.requiredMinutes).toBe(0);
      });

      it("handles user with more minutes than event duration", () => {
        const startTime = 0;
        const endTime = 60 * 60 * 1000;
        // User attended 90 min but event was only 60 min (possible with early join)
        const result = calculateGameQualification(90, startTime, endTime, 50);

        expect(result.qualified).toBe(true);
        expect(result.attendancePercentage).toBe(150);
      });

      it("uses ceiling for required minutes (avoids rounding exploits)", () => {
        // 59 minute event, 50% threshold
        // 50% of 59 = 29.5, should round UP to 30
        const startTime = 0;
        const endTime = 59 * 60 * 1000;
        const result = calculateGameQualification(29, startTime, endTime, 50);

        expect(result.qualified).toBe(false);
        expect(result.requiredMinutes).toBe(30); // Ceiling of 29.5
      });

      it("rounds attendance percentage to nearest integer", () => {
        const startTime = 0;
        const endTime = 120 * 60 * 1000;
        // 65 / 120 = 54.166...
        const result = calculateGameQualification(65, startTime, endTime, 50);

        expect(result.attendancePercentage).toBe(54);
      });

      it("handles realistic Unix timestamps", () => {
        const startTime = 1704067200000; // Jan 1, 2024 00:00:00 UTC
        const endTime = 1704074400000; // Jan 1, 2024 02:00:00 UTC (2 hours later)
        const result = calculateGameQualification(60, startTime, endTime, 50);

        expect(result.qualified).toBe(true);
        expect(result.eventDurationMinutes).toBe(120);
      });
    });

    describe("boundary conditions", () => {
      it("qualifies at exactly required minutes", () => {
        const startTime = 0;
        const endTime = 100 * 60 * 1000;
        // 50% of 100 = 50 minutes required
        const result = calculateGameQualification(50, startTime, endTime, 50);

        expect(result.qualified).toBe(true);
      });

      it("does not qualify at one minute below required", () => {
        const startTime = 0;
        const endTime = 100 * 60 * 1000;
        const result = calculateGameQualification(49, startTime, endTime, 50);

        expect(result.qualified).toBe(false);
      });

      it("handles fractional minute events correctly", () => {
        // 90 seconds = 1 minute when floored
        const startTime = 0;
        const endTime = 90 * 1000;
        const result = calculateGameQualification(1, startTime, endTime, 50);

        expect(result.eventDurationMinutes).toBe(1);
        expect(result.requiredMinutes).toBe(1); // ceil(0.5) = 1
      });
    });
  });

  describe("calculateGameSessionQualification", () => {
    const baseConfig: GuildGameConfig = {
      guildId: "guild-123",
      qualificationPercentage: 50,
      attendanceMode: "cumulative",
    };

    describe("cumulative mode", () => {
      it("uses totalMinutes in cumulative mode", () => {
        const session: EventSession = {
          currentSessionStart: null,
          longestSessionMinutes: 30,
          totalMinutes: 60,
        };
        const startTime = 0;
        const endTime = 120 * 60 * 1000;
        const config = { ...baseConfig, attendanceMode: "cumulative" as const };

        const result = calculateGameSessionQualification(session, startTime, endTime, config);

        expect(result.qualified).toBe(true);
        expect(result.userMinutes).toBe(60); // Uses totalMinutes
      });

      it("sums multiple short sessions correctly", () => {
        const session: EventSession = {
          currentSessionStart: null,
          longestSessionMinutes: 20,
          totalMinutes: 80, // Four 20-min sessions
        };
        const startTime = 0;
        const endTime = 120 * 60 * 1000;
        const config = { ...baseConfig, attendanceMode: "cumulative" as const };

        const result = calculateGameSessionQualification(session, startTime, endTime, config);

        expect(result.qualified).toBe(true);
        expect(result.attendancePercentage).toBe(67);
      });
    });

    describe("continuous mode", () => {
      it("uses longestSessionMinutes in continuous mode", () => {
        const session: EventSession = {
          currentSessionStart: null,
          longestSessionMinutes: 60,
          totalMinutes: 90,
        };
        const startTime = 0;
        const endTime = 120 * 60 * 1000;
        const config = { ...baseConfig, attendanceMode: "continuous" as const };

        const result = calculateGameSessionQualification(session, startTime, endTime, config);

        expect(result.qualified).toBe(true);
        expect(result.userMinutes).toBe(60); // Uses longestSessionMinutes
      });

      it("does not qualify with many short sessions in continuous mode", () => {
        const session: EventSession = {
          currentSessionStart: null,
          longestSessionMinutes: 25, // Longest single session
          totalMinutes: 100, // High total but fragmented
        };
        const startTime = 0;
        const endTime = 120 * 60 * 1000;
        const config = { ...baseConfig, attendanceMode: "continuous" as const };

        const result = calculateGameSessionQualification(session, startTime, endTime, config);

        expect(result.qualified).toBe(false);
        expect(result.userMinutes).toBe(25); // Uses longest, not total
      });
    });

    describe("edge cases", () => {
      it("handles session with active currentSessionStart", () => {
        const session: EventSession = {
          currentSessionStart: Date.now(),
          longestSessionMinutes: 30,
          totalMinutes: 60,
        };
        const startTime = 0;
        const endTime = 120 * 60 * 1000;

        const result = calculateGameSessionQualification(session, startTime, endTime, baseConfig);

        // Should still use the recorded totalMinutes
        expect(result.userMinutes).toBe(60);
      });

      it("handles zero-minutes session", () => {
        const session: EventSession = {
          currentSessionStart: null,
          longestSessionMinutes: 0,
          totalMinutes: 0,
        };
        const startTime = 0;
        const endTime = 120 * 60 * 1000;

        const result = calculateGameSessionQualification(session, startTime, endTime, baseConfig);

        expect(result.qualified).toBe(false);
        expect(result.userMinutes).toBe(0);
      });
    });
  });

  describe("formatQualificationResult", () => {
    it("formats qualified result correctly", () => {
      const result = {
        qualified: true,
        userMinutes: 65,
        eventDurationMinutes: 120,
        attendancePercentage: 54,
        thresholdPercentage: 50,
        requiredMinutes: 60,
      };

      const formatted = formatQualificationResult(result);

      expect(formatted).toBe("Qualified (65 min / 120 min, 54%)");
    });

    it("formats not qualified result correctly", () => {
      const result = {
        qualified: false,
        userMinutes: 25,
        eventDurationMinutes: 120,
        attendancePercentage: 21,
        thresholdPercentage: 50,
        requiredMinutes: 60,
      };

      const formatted = formatQualificationResult(result);

      expect(formatted).toBe("Not Qualified (25 min / 120 min, 21% - needed 50%)");
    });

    it("handles zero minutes case", () => {
      const result = {
        qualified: false,
        userMinutes: 0,
        eventDurationMinutes: 60,
        attendancePercentage: 0,
        thresholdPercentage: 50,
        requiredMinutes: 30,
      };

      const formatted = formatQualificationResult(result);

      expect(formatted).toBe("Not Qualified (0 min / 60 min, 0% - needed 50%)");
    });

    it("handles 100% attendance case", () => {
      const result = {
        qualified: true,
        userMinutes: 60,
        eventDurationMinutes: 60,
        attendancePercentage: 100,
        thresholdPercentage: 50,
        requiredMinutes: 30,
      };

      const formatted = formatQualificationResult(result);

      expect(formatted).toBe("Qualified (60 min / 60 min, 100%)");
    });

    it("handles over 100% attendance case", () => {
      const result = {
        qualified: true,
        userMinutes: 90,
        eventDurationMinutes: 60,
        attendancePercentage: 150,
        thresholdPercentage: 50,
        requiredMinutes: 30,
      };

      const formatted = formatQualificationResult(result);

      expect(formatted).toBe("Qualified (90 min / 60 min, 150%)");
    });
  });

  describe("minutesNeededToQualify", () => {
    it("returns 0 for qualified result", () => {
      const result = {
        qualified: true,
        userMinutes: 65,
        eventDurationMinutes: 120,
        attendancePercentage: 54,
        thresholdPercentage: 50,
        requiredMinutes: 60,
      };

      expect(minutesNeededToQualify(result)).toBe(0);
    });

    it("calculates minutes needed correctly", () => {
      const result = {
        qualified: false,
        userMinutes: 25,
        eventDurationMinutes: 120,
        attendancePercentage: 21,
        thresholdPercentage: 50,
        requiredMinutes: 60,
      };

      expect(minutesNeededToQualify(result)).toBe(35); // 60 - 25
    });

    it("returns full required minutes when user has 0 minutes", () => {
      const result = {
        qualified: false,
        userMinutes: 0,
        eventDurationMinutes: 100,
        attendancePercentage: 0,
        thresholdPercentage: 50,
        requiredMinutes: 50,
      };

      expect(minutesNeededToQualify(result)).toBe(50);
    });

    it("returns 1 minute when just below threshold", () => {
      const result = {
        qualified: false,
        userMinutes: 49,
        eventDurationMinutes: 100,
        attendancePercentage: 49,
        thresholdPercentage: 50,
        requiredMinutes: 50,
      };

      expect(minutesNeededToQualify(result)).toBe(1);
    });
  });
});
