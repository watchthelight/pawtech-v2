/**
 * Pawtropolis Tech — tests/config/loggingStore.test.ts
 * WHAT: Unit tests for logging channel configuration storage.
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
  getLoggingChannelId,
  setLoggingChannelId,
  clearLoggingCache,
} from "../../src/config/loggingStore.js";
import { db } from "../../src/db/db.js";
import { LRUCache } from "../../src/lib/lruCache.js";
import { logger } from "../../src/lib/logger.js";

const mockDbFns = db as unknown as {
  _mockGetRun: ReturnType<typeof vi.fn>;
  _mockUpsertRun: ReturnType<typeof vi.fn>;
};

const mockCacheFns = (LRUCache as unknown as { _mockFns: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } })._mockFns;

describe("loggingStore", () => {
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

  describe("getLoggingChannelId", () => {
    it("returns cached value if available", () => {
      mockCacheFns.get.mockReturnValue({ value: "cached-channel" });

      const result = getLoggingChannelId("guild-123");

      expect(result).toBe("cached-channel");
      expect(mockDbFns._mockGetRun).not.toHaveBeenCalled();
    });

    it("returns cached null value without querying DB", () => {
      mockCacheFns.get.mockReturnValue({ value: null });

      const result = getLoggingChannelId("guild-123");

      expect(result).toBeNull();
      expect(mockDbFns._mockGetRun).not.toHaveBeenCalled();
    });

    it("queries database on cache miss", () => {
      mockCacheFns.get.mockReturnValue(undefined);
      mockDbFns._mockGetRun.mockReturnValue({
        logging_channel_id: "db-channel",
      });

      const result = getLoggingChannelId("guild-123");

      expect(result).toBe("db-channel");
    });

    it("caches database result", () => {
      mockDbFns._mockGetRun.mockReturnValue({
        logging_channel_id: "db-channel",
      });

      getLoggingChannelId("guild-123");

      expect(mockCacheFns.set).toHaveBeenCalledWith("guild-123", { value: "db-channel" });
    });

    it("falls back to LOGGING_CHANNEL env when db returns nothing", () => {
      mockDbFns._mockGetRun.mockReturnValue(undefined);
      process.env.LOGGING_CHANNEL = "env-channel";

      const result = getLoggingChannelId("guild-123");

      expect(result).toBe("env-channel");
    });

    it("caches env fallback result", () => {
      mockDbFns._mockGetRun.mockReturnValue(undefined);
      process.env.LOGGING_CHANNEL = "env-channel";

      getLoggingChannelId("guild-123");

      expect(mockCacheFns.set).toHaveBeenCalledWith("guild-123", { value: "env-channel" });
    });

    it("returns null when nothing is configured", () => {
      mockDbFns._mockGetRun.mockReturnValue(undefined);
      delete process.env.LOGGING_CHANNEL;

      const result = getLoggingChannelId("guild-123");

      expect(result).toBeNull();
    });

    it("caches null result when nothing configured", () => {
      mockDbFns._mockGetRun.mockReturnValue(undefined);
      delete process.env.LOGGING_CHANNEL;

      getLoggingChannelId("guild-123");

      expect(mockCacheFns.set).toHaveBeenCalledWith("guild-123", { value: null });
    });

    it("treats empty LOGGING_CHANNEL as null", () => {
      mockDbFns._mockGetRun.mockReturnValue(undefined);
      process.env.LOGGING_CHANNEL = "";

      const result = getLoggingChannelId("guild-123");

      expect(result).toBeNull();
    });

    it("handles db error gracefully with env fallback", () => {
      mockDbFns._mockGetRun.mockImplementation(() => {
        throw new Error("DB error");
      });
      process.env.LOGGING_CHANNEL = "fallback-channel";

      const result = getLoggingChannelId("guild-123");

      expect(result).toBe("fallback-channel");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("uses db channel over env channel", () => {
      mockDbFns._mockGetRun.mockReturnValue({
        logging_channel_id: "db-channel",
      });
      process.env.LOGGING_CHANNEL = "env-channel";

      const result = getLoggingChannelId("guild-123");

      expect(result).toBe("db-channel");
    });

    it("returns null when db has null logging_channel_id", () => {
      mockDbFns._mockGetRun.mockReturnValue({
        logging_channel_id: null,
      });
      delete process.env.LOGGING_CHANNEL;

      const result = getLoggingChannelId("guild-123");

      expect(result).toBeNull();
    });
  });

  describe("setLoggingChannelId", () => {
    it("upserts channel ID to database", () => {
      setLoggingChannelId("guild-123", "channel-456");

      expect(mockDbFns._mockUpsertRun).toHaveBeenCalled();
    });

    it("invalidates cache after write", () => {
      setLoggingChannelId("guild-123", "channel-456");

      expect(mockCacheFns.delete).toHaveBeenCalledWith("guild-123");
    });

    it("logs successful update", () => {
      setLoggingChannelId("guild-123", "channel-456");

      expect(logger.info).toHaveBeenCalled();
    });

    it("throws helpful error for missing column", () => {
      mockDbFns._mockUpsertRun.mockImplementation(() => {
        throw new Error("table has no column named logging_channel_id");
      });

      expect(() => setLoggingChannelId("guild-123", "channel-456")).toThrow(
        "Database schema is outdated"
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it("rethrows other errors", () => {
      mockDbFns._mockUpsertRun.mockImplementation(() => {
        throw new Error("Some other error");
      });

      expect(() => setLoggingChannelId("guild-123", "channel-456")).toThrow(
        "Some other error"
      );
    });
  });

  describe("clearLoggingCache", () => {
    it("deletes cache entry", () => {
      clearLoggingCache("guild-123");

      expect(mockCacheFns.delete).toHaveBeenCalledWith("guild-123");
    });

    it("logs when entry existed", () => {
      mockCacheFns.delete.mockReturnValue(true);

      clearLoggingCache("guild-123");

      expect(logger.debug).toHaveBeenCalled();
    });

    it("does not log when entry did not exist", () => {
      mockCacheFns.delete.mockReturnValue(false);

      clearLoggingCache("guild-123");

      expect(logger.debug).not.toHaveBeenCalled();
    });
  });
});
