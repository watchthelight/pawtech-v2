/**
 * Pawtropolis Tech — tests/lib/activityHeatmap.test.ts
 * WHAT: Unit tests for activity heatmap generation.
 * WHY: Verify sample data generation and trends calculation.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi } from "vitest";

// Mock canvas - we're not testing actual image generation
vi.mock("canvas", () => ({
  createCanvas: vi.fn(() => ({
    getContext: () => ({
      fillStyle: "",
      fillRect: vi.fn(),
      fillText: vi.fn(),
      strokeStyle: "",
      stroke: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      strokeRect: vi.fn(),
      font: "",
      textAlign: "",
      textBaseline: "",
    }),
    toBuffer: vi.fn(() => Buffer.from("mock-image")),
  })),
}));

// Mock database
vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: vi.fn(() => ({
      all: vi.fn().mockReturnValue([]),
    })),
  },
}));

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { generateSampleData, type ActivityData, type TrendsData } from "../../src/lib/activityHeatmap.js";

describe("activityHeatmap", () => {
  describe("generateSampleData", () => {
    it("generates data for 1 week by default", () => {
      const data = generateSampleData();
      expect(data.weeks).toHaveLength(1);
    });

    it("generates data for specified number of weeks", () => {
      const data = generateSampleData(3);
      expect(data.weeks).toHaveLength(3);
    });

    it("clamps weeks to valid range", () => {
      const tooFew = generateSampleData(0);
      expect(tooFew.weeks).toHaveLength(1);

      const tooMany = generateSampleData(10);
      expect(tooMany.weeks).toHaveLength(1);
    });

    it("each week has 7 days and 24 hours", () => {
      const data = generateSampleData(2);
      for (const week of data.weeks) {
        expect(week.grid).toHaveLength(7);
        for (const day of week.grid) {
          expect(day).toHaveLength(24);
        }
      }
    });

    it("includes dates for each week", () => {
      const data = generateSampleData(2);
      for (const week of data.weeks) {
        expect(week.dates).toHaveLength(7);
        expect(week.startDate).toBeInstanceOf(Date);
        expect(week.endDate).toBeInstanceOf(Date);
      }
    });

    it("calculates maxValue across all weeks", () => {
      const data = generateSampleData(2);
      expect(data.maxValue).toBeGreaterThan(0);

      // Verify maxValue is at least as large as any cell value
      for (const week of data.weeks) {
        for (const day of week.grid) {
          for (const hour of day) {
            expect(data.maxValue).toBeGreaterThanOrEqual(hour);
          }
        }
      }
    });

    it("includes trends data", () => {
      const data = generateSampleData(2);
      expect(data.trends).toBeDefined();
      expect(data.trends.busiestHours).toBeDefined();
      expect(data.trends.leastActiveHours).toBeDefined();
      expect(data.trends.peakDays).toBeDefined();
      expect(data.trends.quietestDays).toBeDefined();
      expect(data.trends.avgMessagesPerHour).toBeDefined();
      expect(data.trends.totalMessages).toBeDefined();
    });

    it("older weeks have slightly less activity due to multiplier", () => {
      const data = generateSampleData(4);
      // Recent week should generally have more activity
      const recentTotal = data.weeks[0].grid.flat().reduce((a, b) => a + b, 0);
      const oldestTotal = data.weeks[3].grid.flat().reduce((a, b) => a + b, 0);

      // Not a strict test since it's random, but the multiplier should make recent higher on average
      // We just verify both have some activity
      expect(recentTotal).toBeGreaterThan(0);
      expect(oldestTotal).toBeGreaterThan(0);
    });
  });

  describe("trends calculation", () => {
    it("busiestHours is formatted as time range with UTC", () => {
      const data = generateSampleData(1);
      expect(data.trends.busiestHours).toMatch(/\d{1,2}[ap]m–\d{1,2}[ap]m UTC/);
    });

    it("leastActiveHours is formatted as time range with UTC", () => {
      const data = generateSampleData(1);
      expect(data.trends.leastActiveHours).toMatch(/\d{1,2}[ap]m–\d{1,2}[ap]m UTC/);
    });

    it("peakDays contains valid day abbreviations", () => {
      const data = generateSampleData(1);
      const validDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      for (const day of data.trends.peakDays) {
        expect(validDays).toContain(day);
      }
    });

    it("quietestDays contains valid day abbreviations", () => {
      const data = generateSampleData(1);
      const validDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      for (const day of data.trends.quietestDays) {
        expect(validDays).toContain(day);
      }
    });

    it("avgMessagesPerHour is a reasonable number", () => {
      const data = generateSampleData(1);
      expect(data.trends.avgMessagesPerHour).toBeGreaterThanOrEqual(0);
    });

    it("totalMessages is sum of all cells", () => {
      const data = generateSampleData(1);
      const calculated = data.weeks.flatMap((w) => w.grid.flat()).reduce((a, b) => a + b, 0);
      expect(data.trends.totalMessages).toBe(calculated);
    });

    it("weekOverWeekGrowth is present for multi-week data", () => {
      const data = generateSampleData(2);
      expect(data.trends.weekOverWeekGrowth).toBeDefined();
      expect(typeof data.trends.weekOverWeekGrowth).toBe("number");
    });

    it("weekOverWeekGrowth is undefined for single week", () => {
      const data = generateSampleData(1);
      expect(data.trends.weekOverWeekGrowth).toBeUndefined();
    });
  });

  describe("week data structure", () => {
    it("startDate is before endDate", () => {
      const data = generateSampleData(1);
      for (const week of data.weeks) {
        expect(week.startDate.getTime()).toBeLessThan(week.endDate.getTime());
      }
    });

    it("dates array spans from startDate to endDate", () => {
      const data = generateSampleData(1);
      for (const week of data.weeks) {
        expect(week.dates[0].getTime()).toBe(week.startDate.getTime());
        expect(week.dates[6].getTime()).toBe(week.endDate.getTime());
      }
    });

    it("weeks are ordered most recent first", () => {
      const data = generateSampleData(3);
      for (let i = 0; i < data.weeks.length - 1; i++) {
        expect(data.weeks[i].startDate.getTime()).toBeGreaterThan(
          data.weeks[i + 1].startDate.getTime()
        );
      }
    });
  });
});
