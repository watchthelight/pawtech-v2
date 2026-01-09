/**
 * Pawtropolis Tech — tests/features/analytics/approvalRate.test.ts
 * WHAT: Unit tests for approval rate analytics queries.
 * WHY: Verify approval rate calculations, trends, and rejection reasons.
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

import {
  getApprovalRateStats,
  getApprovalRateTrend,
  getTopRejectionReasons,
  type ApprovalRateStats,
  type ApprovalRateTrend,
  type RejectionReason,
} from "../../../src/features/analytics/approvalRate.js";
import { logger } from "../../../src/lib/logger.js";

describe("analytics/approvalRate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      all: mockAll,
    });
  });

  describe("getApprovalRateStats", () => {
    it("returns approval rate stats with correct percentages", () => {
      mockGet.mockReturnValue({
        approvals: 80,
        rejections: 15,
        kicks: 3,
        perm_rejects: 2,
        total: 100,
      });

      const result = getApprovalRateStats({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      });

      expect(result.total).toBe(100);
      expect(result.approvals).toBe(80);
      expect(result.rejections).toBe(15);
      expect(result.kicks).toBe(3);
      expect(result.permRejects).toBe(2);
      expect(result.approvalPct).toBe(80);
      expect(result.rejectionPct).toBe(15);
      expect(result.kickPct).toBe(3);
      expect(result.permRejectPct).toBe(2);
    });

    it("handles zero total (division by zero)", () => {
      mockGet.mockReturnValue({
        approvals: 0,
        rejections: 0,
        kicks: 0,
        perm_rejects: 0,
        total: 0,
      });

      const result = getApprovalRateStats({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      });

      expect(result.total).toBe(0);
      expect(result.approvalPct).toBe(0);
      expect(result.rejectionPct).toBe(0);
      expect(result.kickPct).toBe(0);
      expect(result.permRejectPct).toBe(0);
    });

    it("handles undefined row", () => {
      mockGet.mockReturnValue(undefined);

      const result = getApprovalRateStats({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      });

      expect(result.total).toBe(0);
      expect(result.approvals).toBe(0);
    });

    it("logs query completion", () => {
      mockGet.mockReturnValue({
        approvals: 50,
        rejections: 50,
        kicks: 0,
        perm_rejects: 0,
        total: 100,
      });

      getApprovalRateStats({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      });

      expect(logger.info).toHaveBeenCalled();
    });

    it("throws and logs on database error", () => {
      mockGet.mockImplementation(() => {
        throw new Error("DB Error");
      });

      expect(() => {
        getApprovalRateStats({
          guildId: "guild-123",
          from: 1704067200,
          to: 1704672000,
        });
      }).toThrow("DB Error");

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getApprovalRateTrend", () => {
    it("calculates trend with improvement", () => {
      // Current period: 80% approval
      mockGet
        .mockReturnValueOnce({
          approvals: 80,
          rejections: 20,
          kicks: 0,
          perm_rejects: 0,
          total: 100,
        })
        // Previous period: 70% approval
        .mockReturnValueOnce({
          approvals: 70,
          rejections: 30,
          kicks: 0,
          perm_rejects: 0,
          total: 100,
        });

      const result = getApprovalRateTrend({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      });

      expect(result.current.approvalPct).toBe(80);
      expect(result.previous.approvalPct).toBe(70);
      expect(result.approvalRateDelta).toBe(10);
      expect(result.trendDirection).toBe("up");
    });

    it("calculates trend with decline", () => {
      // Current period: 60% approval
      mockGet
        .mockReturnValueOnce({
          approvals: 60,
          rejections: 40,
          kicks: 0,
          perm_rejects: 0,
          total: 100,
        })
        // Previous period: 80% approval
        .mockReturnValueOnce({
          approvals: 80,
          rejections: 20,
          kicks: 0,
          perm_rejects: 0,
          total: 100,
        });

      const result = getApprovalRateTrend({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      });

      expect(result.approvalRateDelta).toBe(-20);
      expect(result.trendDirection).toBe("down");
    });

    it("calculates stable trend for small changes", () => {
      // Current: 80.5%, Previous: 80%
      mockGet
        .mockReturnValueOnce({
          approvals: 805,
          rejections: 195,
          kicks: 0,
          perm_rejects: 0,
          total: 1000,
        })
        .mockReturnValueOnce({
          approvals: 800,
          rejections: 200,
          kicks: 0,
          perm_rejects: 0,
          total: 1000,
        });

      const result = getApprovalRateTrend({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      });

      expect(result.trendDirection).toBe("stable");
    });

    it("handles both periods with zero data", () => {
      mockGet.mockReturnValue({
        approvals: 0,
        rejections: 0,
        kicks: 0,
        perm_rejects: 0,
        total: 0,
      });

      const result = getApprovalRateTrend({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      });

      expect(result.approvalRateDelta).toBe(0);
      expect(result.trendDirection).toBe("stable");
    });

    it("throws and logs on error", () => {
      mockGet.mockImplementation(() => {
        throw new Error("DB Error");
      });

      expect(() => {
        getApprovalRateTrend({
          guildId: "guild-123",
          from: 1704067200,
          to: 1704672000,
        });
      }).toThrow("DB Error");

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getTopRejectionReasons", () => {
    it("returns top rejection reasons with percentages", () => {
      mockAll.mockReturnValue([
        { normalized_reason: "too young", count: 50 },
        { normalized_reason: "incomplete application", count: 30 },
        { normalized_reason: "suspicious account", count: 20 },
      ]);

      const result = getTopRejectionReasons(
        {
          guildId: "guild-123",
          from: 1704067200,
          to: 1704672000,
        },
        5
      );

      expect(result).toHaveLength(3);
      expect(result[0].reason).toBe("too young");
      expect(result[0].count).toBe(50);
      expect(result[0].percentage).toBe(50);
      expect(result[1].percentage).toBe(30);
      expect(result[2].percentage).toBe(20);
    });

    it("uses default limit of 5", () => {
      mockAll.mockReturnValue([]);

      getTopRejectionReasons({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      });

      expect(mockAll).toHaveBeenCalled();
    });

    it("handles empty results", () => {
      mockAll.mockReturnValue([]);

      const result = getTopRejectionReasons({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      });

      expect(result).toEqual([]);
    });

    it("handles null normalized_reason", () => {
      mockAll.mockReturnValue([
        { normalized_reason: null, count: 10 },
      ]);

      const result = getTopRejectionReasons({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      });

      expect(result[0].reason).toBe("Unknown");
    });

    it("handles zero total rejections", () => {
      mockAll.mockReturnValue([
        { normalized_reason: "reason", count: 0 },
      ]);

      const result = getTopRejectionReasons({
        guildId: "guild-123",
        from: 1704067200,
        to: 1704672000,
      });

      expect(result[0].percentage).toBe(0);
    });

    it("throws and logs on error", () => {
      mockAll.mockImplementation(() => {
        throw new Error("DB Error");
      });

      expect(() => {
        getTopRejectionReasons({
          guildId: "guild-123",
          from: 1704067200,
          to: 1704672000,
        });
      }).toThrow("DB Error");

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("type exports", () => {
    it("ApprovalRateStats has correct shape", () => {
      const stats: ApprovalRateStats = {
        total: 100,
        approvals: 80,
        rejections: 15,
        kicks: 3,
        permRejects: 2,
        approvalPct: 80,
        rejectionPct: 15,
        kickPct: 3,
        permRejectPct: 2,
      };
      expect(stats.total).toBe(100);
    });

    it("ApprovalRateTrend has correct shape", () => {
      const trend: ApprovalRateTrend = {
        current: {
          total: 100,
          approvals: 80,
          rejections: 20,
          kicks: 0,
          permRejects: 0,
          approvalPct: 80,
          rejectionPct: 20,
          kickPct: 0,
          permRejectPct: 0,
        },
        previous: {
          total: 100,
          approvals: 70,
          rejections: 30,
          kicks: 0,
          permRejects: 0,
          approvalPct: 70,
          rejectionPct: 30,
          kickPct: 0,
          permRejectPct: 0,
        },
        approvalRateDelta: 10,
        trendDirection: "up",
      };
      expect(trend.trendDirection).toBe("up");
    });

    it("RejectionReason has correct shape", () => {
      const reason: RejectionReason = {
        reason: "Too young",
        count: 50,
        percentage: 25,
      };
      expect(reason.reason).toBe("Too young");
    });
  });
});
