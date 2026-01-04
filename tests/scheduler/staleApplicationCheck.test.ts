/**
 * Pawtropolis Tech — tests/scheduler/staleApplicationCheck.test.ts
 * WHAT: Unit tests for stale application check scheduler.
 * WHY: Verify scheduler lifecycle and env flag handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock database
vi.mock("../../src/db/db.js", () => {
  const mockGet = vi.fn();
  const mockAll = vi.fn().mockReturnValue([]);
  const mockRun = vi.fn();
  return {
    db: {
      prepare: vi.fn(() => ({
        get: mockGet,
        all: mockAll,
        run: mockRun,
      })),
      _mockFns: { get: mockGet, all: mockAll, run: mockRun },
    },
  };
});

// Mock logger with accessor pattern
vi.mock("../../src/lib/logger.js", () => {
  const mockInfo = vi.fn();
  const mockDebug = vi.fn();
  const mockWarn = vi.fn();
  const mockError = vi.fn();
  return {
    logger: {
      debug: mockDebug,
      info: mockInfo,
      warn: mockWarn,
      error: mockError,
      _mocks: { info: mockInfo, debug: mockDebug, warn: mockWarn, error: mockError },
    },
  };
});

// Mock ids helper
vi.mock("../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(0, 6).toUpperCase()),
}));

// Mock scheduler health
vi.mock("../../src/lib/schedulerHealth.js", () => ({
  recordSchedulerRun: vi.fn(),
}));

import {
  startStaleApplicationScheduler,
  stopStaleApplicationScheduler,
} from "../../src/scheduler/staleApplicationCheck.js";
import { logger } from "../../src/lib/logger.js";

const mockLogger = (logger as unknown as { _mocks: { info: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> } })._mocks;

describe("staleApplicationCheck", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
    stopStaleApplicationScheduler();
  });

  describe("startStaleApplicationScheduler", () => {
    it("skips when disabled via env flag", () => {
      process.env.STALE_APP_SCHEDULER_DISABLED = "1";
      const mockClient = { channels: { fetch: vi.fn() } };

      startStaleApplicationScheduler(mockClient as any);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("disabled")
      );
    });

    it("logs scheduler starting when enabled", () => {
      const mockClient = {
        channels: { fetch: vi.fn() },
        guilds: { cache: new Map() },
      };

      startStaleApplicationScheduler(mockClient as any);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ intervalMinutes: 30, thresholdHours: 24 }),
        expect.stringContaining("starting")
      );
    });
  });

  describe("stopStaleApplicationScheduler", () => {
    it("logs when stopping active scheduler", () => {
      const mockClient = {
        channels: { fetch: vi.fn() },
        guilds: { cache: new Map() },
      };

      startStaleApplicationScheduler(mockClient as any);
      vi.clearAllMocks();
      stopStaleApplicationScheduler();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("stopped")
      );
    });

    it("does nothing when not running", () => {
      // Should not throw
      stopStaleApplicationScheduler();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it("can be called multiple times safely", () => {
      const mockClient = {
        channels: { fetch: vi.fn() },
        guilds: { cache: new Map() },
      };

      startStaleApplicationScheduler(mockClient as any);
      stopStaleApplicationScheduler();
      stopStaleApplicationScheduler(); // Second call should be safe
    });
  });
});
