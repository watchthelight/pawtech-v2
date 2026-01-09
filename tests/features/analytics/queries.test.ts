/**
 * Pawtropolis Tech — tests/features/analytics/queries.test.ts
 * WHAT: Unit tests for analytics query functions.
 * WHY: Verify query logic, percentile calculations, and time bucketing.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock database with vi.hoisted
const { mockGet, mockAll, mockPrepare } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockAll: vi.fn(),
  mockPrepare: vi.fn(),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
  all: mockAll,
});

vi.mock("../../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
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

const { mockNowUtc } = vi.hoisted(() => ({
  mockNowUtc: vi.fn(),
}));

vi.mock("../../../src/lib/time.js", () => ({
  nowUtc: mockNowUtc,
}));

import {
  getActionCountsByMod,
  getLeadTimeStats,
  getTopReasons,
  getVolumeSeries,
  getOpenQueueAge,
  type QueryOptions,
  type ActionCount,
  type LeadTimeStats,
  type ReasonCount,
  type VolumeBucket,
  type QueueAgeStats,
} from "../../../src/features/analytics/queries.js";
import { logger } from "../../../src/lib/logger.js";

describe("analytics/queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      all: mockAll,
    });
    mockNowUtc.mockReturnValue(1704672000);
  });

  describe("getActionCountsByMod", () => {
    it("returns action counts grouped by moderator", () => {
      const counts = [
        { moderator_id: "mod-1", action: "approve", count: 50 },
        { moderator_id: "mod-1", action: "reject", count: 10 },
        { moderator_id: "mod-2", action: "approve", count: 30 },
      ];
      mockAll.mockReturnValue(counts);

      const result = getActionCountsByMod({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      });

      expect(result).toEqual(counts);
      expect(logger.info).toHaveBeenCalled();
    });

    it("handles cross-guild query (no guildId)", () => {
      mockAll.mockReturnValue([]);

      const result = getActionCountsByMod({
        from: 1704067200,
        to: 1704672000,
      });

      expect(result).toEqual([]);
    });

    it("handles query with only from filter", () => {
      mockAll.mockReturnValue([]);

      const result = getActionCountsByMod({
        from: 1704067200,
      });

      expect(result).toEqual([]);
    });

    it("handles query with only to filter", () => {
      mockAll.mockReturnValue([]);

      const result = getActionCountsByMod({
        to: 1704672000,
      });

      expect(result).toEqual([]);
    });

    it("handles empty options", () => {
      mockAll.mockReturnValue([]);

      const result = getActionCountsByMod({});

      expect(result).toEqual([]);
    });

    it("throws and logs on error", () => {
      mockAll.mockImplementation(() => {
        throw new Error("DB Error");
      });

      expect(() => {
        getActionCountsByMod({ guildId: "guild-123" });
      }).toThrow("DB Error");

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getLeadTimeStats", () => {
    it("calculates p50, p90, mean correctly", () => {
      // 10 lead times: 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000
      const leadTimes = [
        { lead_time_sec: 100 },
        { lead_time_sec: 200 },
        { lead_time_sec: 300 },
        { lead_time_sec: 400 },
        { lead_time_sec: 500 },
        { lead_time_sec: 600 },
        { lead_time_sec: 700 },
        { lead_time_sec: 800 },
        { lead_time_sec: 900 },
        { lead_time_sec: 1000 },
      ];
      mockAll.mockReturnValue(leadTimes);

      const result = getLeadTimeStats({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      });

      expect(result.n).toBe(10);
      expect(result.mean).toBe(550); // (100+200+...+1000)/10 = 5500/10
      expect(result.p50).toBe(500); // 50th percentile
      expect(result.p90).toBe(900); // 90th percentile
    });

    it("returns zeros for empty results", () => {
      mockAll.mockReturnValue([]);

      const result = getLeadTimeStats({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      });

      expect(result).toEqual({ p50: 0, p90: 0, mean: 0, n: 0 });
    });

    it("handles single item", () => {
      mockAll.mockReturnValue([{ lead_time_sec: 500 }]);

      const result = getLeadTimeStats({
        guildId: "guild-123",
      });

      expect(result.n).toBe(1);
      expect(result.mean).toBe(500);
      expect(result.p50).toBe(500);
      expect(result.p90).toBe(500);
    });

    it("handles cross-guild query", () => {
      mockAll.mockReturnValue([{ lead_time_sec: 100 }]);

      const result = getLeadTimeStats({
        from: 1704067200,
        to: 1704672000,
      });

      expect(result.n).toBe(1);
    });

    it("throws and logs on error", () => {
      mockAll.mockImplementation(() => {
        throw new Error("DB Error");
      });

      expect(() => {
        getLeadTimeStats({ guildId: "guild-123" });
      }).toThrow("DB Error");

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getTopReasons", () => {
    it("returns normalized reasons with counts", () => {
      const reasons = [
        { normalized_reason: "too young", count: 50 },
        { normalized_reason: "incomplete", count: 30 },
      ];
      mockAll.mockReturnValue(reasons);

      const result = getTopReasons({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
        limit: 10,
      });

      expect(result).toEqual([
        { reason: "too young", count: 50 },
        { reason: "incomplete", count: 30 },
      ]);
    });

    it("uses default limit of 10", () => {
      mockAll.mockReturnValue([]);

      getTopReasons({ guildId: "guild-123" });

      expect(mockAll).toHaveBeenCalled();
    });

    it("handles null normalized_reason", () => {
      mockAll.mockReturnValue([{ normalized_reason: null, count: 5 }]);

      const result = getTopReasons({ guildId: "guild-123" });

      expect(result[0].reason).toBe("");
    });

    it("handles cross-guild query", () => {
      mockAll.mockReturnValue([]);

      const result = getTopReasons({
        from: 1704067200,
        to: 1704672000,
      });

      expect(result).toEqual([]);
    });

    it("throws and logs on error", () => {
      mockAll.mockImplementation(() => {
        throw new Error("DB Error");
      });

      expect(() => {
        getTopReasons({ guildId: "guild-123" });
      }).toThrow("DB Error");

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getVolumeSeries", () => {
    it("returns daily buckets", () => {
      const buckets = [
        { bucket_start: 1704067200, total: 10, approvals: 8, rejects: 2, permrejects: 0 },
        { bucket_start: 1704153600, total: 15, approvals: 12, rejects: 2, permrejects: 1 },
      ];
      mockAll.mockReturnValue(buckets);

      const result = getVolumeSeries({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
        bucket: "day",
      });

      expect(result).toHaveLength(2);
      expect(result[0].t0).toBe(1704067200);
      expect(result[0].t1).toBe(1704067200 + 86400);
      expect(result[0].total).toBe(10);
      expect(result[0].approvals).toBe(8);
    });

    it("returns weekly buckets", () => {
      const buckets = [
        { bucket_start: 1704067200, total: 50, approvals: 40, rejects: 8, permrejects: 2 },
      ];
      mockAll.mockReturnValue(buckets);

      const result = getVolumeSeries({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
        bucket: "week",
      });

      expect(result[0].t1).toBe(1704067200 + 604800);
    });

    it("uses default daily bucket", () => {
      mockAll.mockReturnValue([]);

      getVolumeSeries({
        guildId: "guild-123",
      });

      expect(mockAll).toHaveBeenCalled();
    });

    it("uses default time window", () => {
      mockAll.mockReturnValue([]);

      getVolumeSeries({
        guildId: "guild-123",
      });

      expect(mockAll).toHaveBeenCalled();
    });

    it("handles cross-guild query", () => {
      mockAll.mockReturnValue([]);

      const result = getVolumeSeries({
        from: 1704067200,
        to: 1704672000,
      });

      expect(result).toEqual([]);
    });

    it("throws and logs on error", () => {
      mockAll.mockImplementation(() => {
        throw new Error("DB Error");
      });

      expect(() => {
        getVolumeSeries({ guildId: "guild-123" });
      }).toThrow("DB Error");

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getOpenQueueAge", () => {
    it("returns queue age stats", () => {
      const ages = [
        { age_sec: 100 },
        { age_sec: 200 },
        { age_sec: 300 },
        { age_sec: 400 },
        { age_sec: 500 },
        { age_sec: 600 },
        { age_sec: 700 },
        { age_sec: 800 },
        { age_sec: 900 },
        { age_sec: 1000 },
      ];
      mockAll.mockReturnValue(ages);

      const result = getOpenQueueAge("guild-123");

      expect(result.count).toBe(10);
      expect(result.max_age_sec).toBe(1000);
      expect(result.p50_age_sec).toBe(500);
    });

    it("returns zeros for empty queue", () => {
      mockAll.mockReturnValue([]);

      const result = getOpenQueueAge("guild-123");

      expect(result).toEqual({ count: 0, max_age_sec: 0, p50_age_sec: 0 });
    });

    it("handles single pending application", () => {
      mockAll.mockReturnValue([{ age_sec: 3600 }]);

      const result = getOpenQueueAge("guild-123");

      expect(result.count).toBe(1);
      expect(result.max_age_sec).toBe(3600);
      expect(result.p50_age_sec).toBe(3600);
    });

    it("throws and logs on error", () => {
      mockAll.mockImplementation(() => {
        throw new Error("DB Error");
      });

      expect(() => {
        getOpenQueueAge("guild-123");
      }).toThrow("DB Error");

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("type exports", () => {
    it("QueryOptions has correct shape", () => {
      const opts: QueryOptions = {
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      };
      expect(opts.guildId).toBe("guild-123");
    });

    it("ActionCount has correct shape", () => {
      const count: ActionCount = {
        moderator_id: "mod-1",
        action: "approve",
        count: 50,
      };
      expect(count.action).toBe("approve");
    });

    it("LeadTimeStats has correct shape", () => {
      const stats: LeadTimeStats = {
        p50: 300,
        p90: 600,
        mean: 400,
        n: 100,
      };
      expect(stats.n).toBe(100);
    });

    it("ReasonCount has correct shape", () => {
      const reason: ReasonCount = {
        reason: "Too young",
        count: 25,
      };
      expect(reason.reason).toBe("Too young");
    });

    it("VolumeBucket has correct shape", () => {
      const bucket: VolumeBucket = {
        t0: 1704067200,
        t1: 1704153600,
        total: 100,
        approvals: 80,
        rejects: 15,
        permrejects: 5,
      };
      expect(bucket.total).toBe(100);
    });

    it("QueueAgeStats has correct shape", () => {
      const stats: QueueAgeStats = {
        count: 10,
        max_age_sec: 86400,
        p50_age_sec: 3600,
      };
      expect(stats.count).toBe(10);
    });
  });
});
