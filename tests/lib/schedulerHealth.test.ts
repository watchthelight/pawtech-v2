/**
 * Pawtropolis Tech -- tests/lib/schedulerHealth.test.ts
 * WHAT: Tests for scheduler health tracking utility.
 * WHY: Verify health tracking, consecutive failure counting,
 *      and alert thresholds work correctly.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// ===== Mock Setup =====

// Mock logger before importing schedulerHealth module
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: mockLogger,
}));

// Import after mocks are set up
import {
  recordSchedulerRun,
  getSchedulerHealth,
  getSchedulerHealthByName,
  resetSchedulerHealth,
  _clearAllSchedulerHealth,
} from "../../src/lib/schedulerHealth.js";

// ===== Tests =====

describe("schedulerHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear all scheduler health state between tests
    _clearAllSchedulerHealth();
  });

  describe("recordSchedulerRun", () => {
    it("creates new health entry on first run", () => {
      recordSchedulerRun("testScheduler", true);

      const health = getSchedulerHealthByName("testScheduler");
      expect(health).toBeDefined();
      expect(health?.name).toBe("testScheduler");
      expect(health?.totalRuns).toBe(1);
      expect(health?.totalFailures).toBe(0);
      expect(health?.consecutiveFailures).toBe(0);
      expect(health?.lastRunAt).toBeGreaterThan(0);
      expect(health?.lastSuccessAt).toBeGreaterThan(0);
      expect(health?.lastErrorAt).toBeNull();
    });

    it("tracks success correctly", () => {
      recordSchedulerRun("testScheduler", true);
      recordSchedulerRun("testScheduler", true);

      const health = getSchedulerHealthByName("testScheduler");
      expect(health?.totalRuns).toBe(2);
      expect(health?.totalFailures).toBe(0);
      expect(health?.consecutiveFailures).toBe(0);
    });

    it("tracks failure correctly", () => {
      recordSchedulerRun("testScheduler", false);

      const health = getSchedulerHealthByName("testScheduler");
      expect(health?.totalRuns).toBe(1);
      expect(health?.totalFailures).toBe(1);
      expect(health?.consecutiveFailures).toBe(1);
      expect(health?.lastErrorAt).toBeGreaterThan(0);
      expect(health?.lastSuccessAt).toBeNull();
    });

    it("increments consecutive failures on repeated failures", () => {
      recordSchedulerRun("testScheduler", false);
      recordSchedulerRun("testScheduler", false);
      recordSchedulerRun("testScheduler", false);

      const health = getSchedulerHealthByName("testScheduler");
      expect(health?.consecutiveFailures).toBe(3);
      expect(health?.totalFailures).toBe(3);
    });

    it("resets consecutive failures on success", () => {
      recordSchedulerRun("testScheduler", false);
      recordSchedulerRun("testScheduler", false);
      recordSchedulerRun("testScheduler", true);

      const health = getSchedulerHealthByName("testScheduler");
      expect(health?.consecutiveFailures).toBe(0);
      expect(health?.totalFailures).toBe(2);
      expect(health?.totalRuns).toBe(3);
    });

    it("logs alert at 3 consecutive failures", () => {
      recordSchedulerRun("testScheduler", false);
      recordSchedulerRun("testScheduler", false);

      // Should not have logged yet
      expect(mockLogger.error).not.toHaveBeenCalled();

      // Third failure should trigger alert
      recordSchedulerRun("testScheduler", false);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduler: "testScheduler",
          consecutiveFailures: 3,
        }),
        "[scheduler] Multiple consecutive failures - requires attention"
      );
    });

    it("continues logging alert on subsequent failures", () => {
      for (let i = 0; i < 5; i++) {
        recordSchedulerRun("testScheduler", false);
      }

      // Should have logged 3 times (at failures 3, 4, and 5)
      expect(mockLogger.error).toHaveBeenCalledTimes(3);
    });

    it("stops alerting after success resets failures", () => {
      recordSchedulerRun("testScheduler", false);
      recordSchedulerRun("testScheduler", false);
      recordSchedulerRun("testScheduler", false);

      // Reset via success
      recordSchedulerRun("testScheduler", true);
      vi.clearAllMocks();

      // Two more failures should not trigger alert
      recordSchedulerRun("testScheduler", false);
      recordSchedulerRun("testScheduler", false);

      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe("getSchedulerHealth", () => {
    it("returns empty map when no schedulers tracked", () => {
      const health = getSchedulerHealth();
      expect(health.size).toBe(0);
    });

    it("returns all tracked schedulers", () => {
      recordSchedulerRun("scheduler1", true);
      recordSchedulerRun("scheduler2", false);
      recordSchedulerRun("scheduler3", true);

      const health = getSchedulerHealth();
      expect(health.size).toBe(3);
      expect(health.has("scheduler1")).toBe(true);
      expect(health.has("scheduler2")).toBe(true);
      expect(health.has("scheduler3")).toBe(true);
    });

    it("returns a copy of the internal map", () => {
      recordSchedulerRun("testScheduler", true);

      const health1 = getSchedulerHealth();
      const health2 = getSchedulerHealth();

      expect(health1).not.toBe(health2);
    });
  });

  describe("getSchedulerHealthByName", () => {
    it("returns undefined for unknown scheduler", () => {
      const health = getSchedulerHealthByName("unknown");
      expect(health).toBeUndefined();
    });

    it("returns health for known scheduler", () => {
      recordSchedulerRun("testScheduler", true);

      const health = getSchedulerHealthByName("testScheduler");
      expect(health).toBeDefined();
      expect(health?.name).toBe("testScheduler");
    });

    it("returns a copy of the health object", () => {
      recordSchedulerRun("testScheduler", true);

      const health1 = getSchedulerHealthByName("testScheduler");
      const health2 = getSchedulerHealthByName("testScheduler");

      expect(health1).not.toBe(health2);
    });
  });

  describe("resetSchedulerHealth", () => {
    it("removes scheduler from tracking", () => {
      recordSchedulerRun("testScheduler", true);
      expect(getSchedulerHealthByName("testScheduler")).toBeDefined();

      resetSchedulerHealth("testScheduler");

      expect(getSchedulerHealthByName("testScheduler")).toBeUndefined();
    });

    it("logs reset action", () => {
      recordSchedulerRun("testScheduler", true);
      resetSchedulerHealth("testScheduler");

      expect(mockLogger.info).toHaveBeenCalledWith(
        { scheduler: "testScheduler" },
        "[scheduler] Health state reset"
      );
    });

    it("does not throw for unknown scheduler", () => {
      expect(() => resetSchedulerHealth("unknown")).not.toThrow();
    });
  });

  describe("_clearAllSchedulerHealth", () => {
    it("removes all tracked schedulers", () => {
      recordSchedulerRun("scheduler1", true);
      recordSchedulerRun("scheduler2", true);

      _clearAllSchedulerHealth();

      expect(getSchedulerHealth().size).toBe(0);
    });
  });

  describe("timestamp tracking", () => {
    it("updates lastRunAt on each run", () => {
      recordSchedulerRun("testScheduler", true);
      const health1 = getSchedulerHealthByName("testScheduler");
      const firstRunAt = health1?.lastRunAt;

      recordSchedulerRun("testScheduler", true);
      const health2 = getSchedulerHealthByName("testScheduler");

      // lastRunAt should be >= firstRunAt (same or later timestamp)
      expect(health2?.lastRunAt).toBeGreaterThanOrEqual(firstRunAt!);
    });

    it("preserves lastSuccessAt after failure", () => {
      recordSchedulerRun("testScheduler", true);
      const health1 = getSchedulerHealthByName("testScheduler");
      const successAt = health1?.lastSuccessAt;

      recordSchedulerRun("testScheduler", false);
      const health2 = getSchedulerHealthByName("testScheduler");

      expect(health2?.lastSuccessAt).toBe(successAt);
    });

    it("preserves lastErrorAt after success", () => {
      recordSchedulerRun("testScheduler", false);
      const health1 = getSchedulerHealthByName("testScheduler");
      const errorAt = health1?.lastErrorAt;

      recordSchedulerRun("testScheduler", true);
      const health2 = getSchedulerHealthByName("testScheduler");

      expect(health2?.lastErrorAt).toBe(errorAt);
    });
  });
});
