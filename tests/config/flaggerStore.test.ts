/**
 * Pawtropolis Tech — tests/config/flaggerStore.test.ts
 * WHAT: Unit tests for flagger configuration storage.
 * WHY: Verify get/set operations, caching, and env fallback.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock LRU cache before import
vi.mock("../../src/lib/lruCache.js", () => {
  const mockGet = vi.fn();
  const mockSet = vi.fn();
  const mockDelete = vi.fn().mockReturnValue(true);
  return {
    LRUCache: class {
      get = mockGet;
      set = mockSet;
      delete = mockDelete;
      static _mockFns = { get: mockGet, set: mockSet, delete: mockDelete };
    },
  };
});

// Mock db with prepared statements
vi.mock("../../src/db/db.js", () => {
  const mockGetRun = vi.fn();
  const mockUpsertRun = vi.fn();
  return {
    db: {
      prepare: vi.fn((sql: string) => {
        if (sql.includes("SELECT")) {
          return { get: mockGetRun };
        }
        return { run: mockUpsertRun };
      }),
      _mockGetRun: mockGetRun,
      _mockUpsertRun: mockUpsertRun,
    },
  };
});

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  getFlaggerConfig,
  setFlagsChannelId,
  setSilentFirstMsgDays,
  clearFlaggerCache,
} from "../../src/config/flaggerStore.js";
import { db } from "../../src/db/db.js";
import { LRUCache } from "../../src/lib/lruCache.js";
import { logger } from "../../src/lib/logger.js";

const mockDbFns = db as unknown as {
  _mockGetRun: ReturnType<typeof vi.fn>;
  _mockUpsertRun: ReturnType<typeof vi.fn>;
};

const mockCacheFns = (LRUCache as unknown as { _mockFns: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } })._mockFns;

describe("flaggerStore", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    mockCacheFns.get.mockReturnValue(undefined);
    mockDbFns._mockGetRun.mockReturnValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getFlaggerConfig", () => {
    it("returns cached value if available", () => {
      const cachedConfig = { channelId: "cached-channel", silentDays: 14 };
      mockCacheFns.get.mockReturnValue(cachedConfig);

      const result = getFlaggerConfig("guild-123");

      expect(result).toBe(cachedConfig);
      expect(mockDbFns._mockGetRun).not.toHaveBeenCalled();
    });

    it("queries database on cache miss", () => {
      mockCacheFns.get.mockReturnValue(undefined);
      mockDbFns._mockGetRun.mockReturnValue({
        flags_channel_id: "db-channel",
        silent_first_msg_days: 30,
      });

      const result = getFlaggerConfig("guild-123");

      expect(result.channelId).toBe("db-channel");
      expect(result.silentDays).toBe(30);
    });

    it("caches database result", () => {
      mockDbFns._mockGetRun.mockReturnValue({
        flags_channel_id: "db-channel",
        silent_first_msg_days: 30,
      });

      getFlaggerConfig("guild-123");

      expect(mockCacheFns.set).toHaveBeenCalledWith("guild-123", {
        channelId: "db-channel",
        silentDays: 30,
      });
    });

    it("falls back to env vars when db returns nothing", () => {
      mockDbFns._mockGetRun.mockReturnValue(undefined);
      process.env.FLAGGED_REPORT_CHANNEL_ID = "env-channel";
      process.env.SILENT_FIRST_MSG_DAYS = "60";

      const result = getFlaggerConfig("guild-123");

      expect(result.channelId).toBe("env-channel");
      expect(result.silentDays).toBe(60);
    });

    it("returns defaults when nothing is configured", () => {
      mockDbFns._mockGetRun.mockReturnValue(undefined);
      delete process.env.FLAGGED_REPORT_CHANNEL_ID;
      delete process.env.SILENT_FIRST_MSG_DAYS;

      const result = getFlaggerConfig("guild-123");

      expect(result.channelId).toBeNull();
      expect(result.silentDays).toBe(7);
    });

    it("handles db error gracefully", () => {
      mockDbFns._mockGetRun.mockImplementation(() => {
        throw new Error("DB error");
      });
      process.env.FLAGGED_REPORT_CHANNEL_ID = "fallback-channel";

      const result = getFlaggerConfig("guild-123");

      expect(result.channelId).toBe("fallback-channel");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("uses db channel over env channel", () => {
      mockDbFns._mockGetRun.mockReturnValue({
        flags_channel_id: "db-channel",
        silent_first_msg_days: null,
      });
      process.env.FLAGGED_REPORT_CHANNEL_ID = "env-channel";

      const result = getFlaggerConfig("guild-123");

      expect(result.channelId).toBe("db-channel");
    });

    it("uses env days when db has null", () => {
      mockDbFns._mockGetRun.mockReturnValue({
        flags_channel_id: null,
        silent_first_msg_days: null,
      });
      process.env.SILENT_FIRST_MSG_DAYS = "45";

      const result = getFlaggerConfig("guild-123");

      expect(result.silentDays).toBe(45);
    });
  });

  describe("setFlagsChannelId", () => {
    it("upserts channel ID to database", () => {
      setFlagsChannelId("guild-123", "channel-456");

      expect(mockDbFns._mockUpsertRun).toHaveBeenCalled();
    });

    it("invalidates cache after write", () => {
      setFlagsChannelId("guild-123", "channel-456");

      expect(mockCacheFns.delete).toHaveBeenCalledWith("guild-123");
    });

    it("logs successful update", () => {
      setFlagsChannelId("guild-123", "channel-456");

      expect(logger.info).toHaveBeenCalled();
    });

    it("throws helpful error for missing column", () => {
      mockDbFns._mockUpsertRun.mockImplementation(() => {
        throw new Error("table has no column named flags_channel_id");
      });

      expect(() => setFlagsChannelId("guild-123", "channel-456")).toThrow(
        "Database schema is outdated"
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it("rethrows other errors", () => {
      mockDbFns._mockUpsertRun.mockImplementation(() => {
        throw new Error("Some other error");
      });

      expect(() => setFlagsChannelId("guild-123", "channel-456")).toThrow(
        "Some other error"
      );
    });
  });

  describe("setSilentFirstMsgDays", () => {
    it("upserts silent days to database", () => {
      setSilentFirstMsgDays("guild-123", 30);

      expect(mockDbFns._mockUpsertRun).toHaveBeenCalled();
    });

    it("invalidates cache after write", () => {
      setSilentFirstMsgDays("guild-123", 30);

      expect(mockCacheFns.delete).toHaveBeenCalledWith("guild-123");
    });

    it("logs successful update", () => {
      setSilentFirstMsgDays("guild-123", 30);

      expect(logger.info).toHaveBeenCalled();
    });

    it("throws for days below minimum (7)", () => {
      expect(() => setSilentFirstMsgDays("guild-123", 3)).toThrow(
        "Silent days threshold must be between 7 and 365 days"
      );
    });

    it("throws for days above maximum (365)", () => {
      expect(() => setSilentFirstMsgDays("guild-123", 400)).toThrow(
        "Silent days threshold must be between 7 and 365 days"
      );
    });

    it("accepts minimum value (7)", () => {
      expect(() => setSilentFirstMsgDays("guild-123", 7)).not.toThrow();
    });

    it("accepts maximum value (365)", () => {
      expect(() => setSilentFirstMsgDays("guild-123", 365)).not.toThrow();
    });

    it("throws helpful error for missing column", () => {
      mockDbFns._mockUpsertRun.mockImplementation(() => {
        throw new Error("table has no column named silent_first_msg_days");
      });

      expect(() => setSilentFirstMsgDays("guild-123", 30)).toThrow(
        "Database schema is outdated"
      );
    });
  });

  describe("clearFlaggerCache", () => {
    it("deletes cache entry", () => {
      clearFlaggerCache("guild-123");

      expect(mockCacheFns.delete).toHaveBeenCalledWith("guild-123");
    });

    it("logs when entry existed", () => {
      mockCacheFns.delete.mockReturnValue(true);

      clearFlaggerCache("guild-123");

      expect(logger.debug).toHaveBeenCalled();
    });

    it("does not log when entry did not exist", () => {
      mockCacheFns.delete.mockReturnValue(false);

      clearFlaggerCache("guild-123");

      expect(logger.debug).not.toHaveBeenCalled();
    });
  });
});
