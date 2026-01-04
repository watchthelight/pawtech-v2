/**
 * Pawtropolis Tech — tests/scheduler/modMetricsScheduler.test.ts
 * WHAT: Unit tests for mod metrics refresh scheduler.
 * WHY: Verify scheduler lifecycle and env flag handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Create mock functions INSIDE the factory to avoid hoisting issues
vi.mock("../../src/features/modPerformance.js", () => ({
  recalcModMetrics: vi.fn().mockResolvedValue(5),
}));

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

vi.mock("../../src/lib/schedulerHealth.js", () => ({
  recordSchedulerRun: vi.fn(),
}));

import {
  startModMetricsScheduler,
  stopModMetricsScheduler,
} from "../../src/scheduler/modMetricsScheduler.js";
import { logger } from "../../src/lib/logger.js";

const mockLogger = (logger as unknown as { _mocks: { info: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> } })._mocks;

describe("modMetricsScheduler", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env = { ...originalEnv };
    delete process.env.METRICS_SCHEDULER_DISABLED; // Ensure scheduler is enabled by default
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
    stopModMetricsScheduler();
  });

  describe("startModMetricsScheduler", () => {
    it("skips when disabled via env flag", () => {
      process.env.METRICS_SCHEDULER_DISABLED = "1";
      const mockClient = createMockClient([]);

      startModMetricsScheduler(mockClient as any);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("disabled")
      );
    });

    it("logs scheduler starting when enabled", () => {
      const mockClient = createMockClient([]);

      startModMetricsScheduler(mockClient as any);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ intervalMinutes: 15 }),
        expect.stringContaining("starting")
      );
    });
  });

  describe("stopModMetricsScheduler", () => {
    it("logs when stopping active scheduler", () => {
      const mockClient = createMockClient([]);

      startModMetricsScheduler(mockClient as any);
      vi.clearAllMocks();
      stopModMetricsScheduler();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("stopped")
      );
    });

    it("does nothing when not running", () => {
      // Should not throw
      stopModMetricsScheduler();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it("can be called multiple times safely", () => {
      const mockClient = createMockClient([]);

      startModMetricsScheduler(mockClient as any);
      stopModMetricsScheduler();
      stopModMetricsScheduler(); // Second call should be safe

      // Only one "stopped" log
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("stopped")
      );
    });
  });
});

function createMockClient(guilds: Array<{ id: string; name: string }>) {
  const guildMap = new Map(guilds.map(g => [g.id, g]));
  return {
    guilds: {
      cache: guildMap,
    },
  };
}
