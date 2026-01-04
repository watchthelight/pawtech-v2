/**
 * Pawtropolis Tech — tests/store/aiDetectionToggles.test.ts
 * WHAT: Unit tests for AI detection toggle store operations.
 * WHY: Verify per-guild AI service enable/disable functionality.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the database
const mockGet = vi.fn();
const mockRun = vi.fn();
const mockAll = vi.fn();

vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: vi.fn(() => ({
      get: mockGet,
      run: mockRun,
      all: mockAll,
    })),
  },
}));

describe("aiDetectionToggles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("ALL_SERVICES", () => {
    it("exports list of all AI detection services", async () => {
      const { ALL_SERVICES } = await import("../../src/store/aiDetectionToggles.js");
      expect(ALL_SERVICES).toContain("hive");
      expect(ALL_SERVICES).toContain("rapidai");
      expect(ALL_SERVICES).toContain("sightengine");
      expect(ALL_SERVICES).toContain("optic");
      expect(ALL_SERVICES).toHaveLength(4);
    });
  });

  describe("isServiceEnabled", () => {
    it("returns true when service is explicitly enabled", async () => {
      mockGet.mockReturnValue({ enabled: 1 });

      const { isServiceEnabled } = await import("../../src/store/aiDetectionToggles.js");
      const result = isServiceEnabled("guild-123", "hive");

      expect(result).toBe(true);
    });

    it("returns false when service is explicitly disabled", async () => {
      mockGet.mockReturnValue({ enabled: 0 });

      const { isServiceEnabled } = await import("../../src/store/aiDetectionToggles.js");
      const result = isServiceEnabled("guild-123", "hive");

      expect(result).toBe(false);
    });

    it("returns true (default) when no toggle record exists", async () => {
      mockGet.mockReturnValue(undefined);

      const { isServiceEnabled } = await import("../../src/store/aiDetectionToggles.js");
      const result = isServiceEnabled("guild-123", "hive");

      expect(result).toBe(true);
    });

    it("returns true (default) on database error", async () => {
      mockGet.mockImplementation(() => {
        throw new Error("Table not found");
      });

      const { isServiceEnabled } = await import("../../src/store/aiDetectionToggles.js");
      const result = isServiceEnabled("guild-123", "hive");

      expect(result).toBe(true);
    });
  });

  describe("getServiceToggles", () => {
    it("returns all services enabled by default", async () => {
      mockAll.mockReturnValue([]);

      const { getServiceToggles } = await import("../../src/store/aiDetectionToggles.js");
      const result = getServiceToggles("guild-123");

      expect(result).toEqual({
        hive: true,
        rapidai: true,
        sightengine: true,
        optic: true,
      });
    });

    it("returns stored toggle states", async () => {
      mockAll.mockReturnValue([
        { service: "hive", enabled: 0 },
        { service: "optic", enabled: 0 },
      ]);

      const { getServiceToggles } = await import("../../src/store/aiDetectionToggles.js");
      const result = getServiceToggles("guild-123");

      expect(result).toEqual({
        hive: false,
        rapidai: true, // default
        sightengine: true, // default
        optic: false,
      });
    });

    it("returns defaults on database error", async () => {
      mockAll.mockImplementation(() => {
        throw new Error("DB error");
      });

      const { getServiceToggles } = await import("../../src/store/aiDetectionToggles.js");
      const result = getServiceToggles("guild-123");

      expect(result).toEqual({
        hive: true,
        rapidai: true,
        sightengine: true,
        optic: true,
      });
    });
  });

  describe("getEnabledServices", () => {
    it("returns all services when all enabled", async () => {
      mockAll.mockReturnValue([]);

      const { getEnabledServices } = await import("../../src/store/aiDetectionToggles.js");
      const result = getEnabledServices("guild-123");

      expect(result).toEqual(["hive", "rapidai", "sightengine", "optic"]);
    });

    it("returns only enabled services", async () => {
      mockAll.mockReturnValue([
        { service: "hive", enabled: 0 },
        { service: "sightengine", enabled: 0 },
      ]);

      const { getEnabledServices } = await import("../../src/store/aiDetectionToggles.js");
      const result = getEnabledServices("guild-123");

      expect(result).toEqual(["rapidai", "optic"]);
    });

    it("returns empty array when all disabled", async () => {
      mockAll.mockReturnValue([
        { service: "hive", enabled: 0 },
        { service: "rapidai", enabled: 0 },
        { service: "sightengine", enabled: 0 },
        { service: "optic", enabled: 0 },
      ]);

      const { getEnabledServices } = await import("../../src/store/aiDetectionToggles.js");
      const result = getEnabledServices("guild-123");

      expect(result).toEqual([]);
    });
  });

  describe("setServiceEnabled", () => {
    it("enables a service", async () => {
      mockRun.mockReturnValue({ changes: 1 });

      const { setServiceEnabled } = await import("../../src/store/aiDetectionToggles.js");
      setServiceEnabled("guild-123", "hive", true);

      expect(mockRun).toHaveBeenCalledWith("guild-123", "hive", 1);
    });

    it("disables a service", async () => {
      mockRun.mockReturnValue({ changes: 1 });

      const { setServiceEnabled } = await import("../../src/store/aiDetectionToggles.js");
      setServiceEnabled("guild-123", "hive", false);

      expect(mockRun).toHaveBeenCalledWith("guild-123", "hive", 0);
    });
  });

  describe("toggleService", () => {
    it("toggles enabled service to disabled", async () => {
      // isServiceEnabled returns true (currently enabled)
      mockGet.mockReturnValue({ enabled: 1 });
      mockRun.mockReturnValue({ changes: 1 });

      const { toggleService } = await import("../../src/store/aiDetectionToggles.js");
      const result = toggleService("guild-123", "hive");

      expect(result).toBe(false);
      expect(mockRun).toHaveBeenCalledWith("guild-123", "hive", 0);
    });

    it("toggles disabled service to enabled", async () => {
      // isServiceEnabled returns false (currently disabled)
      mockGet.mockReturnValue({ enabled: 0 });
      mockRun.mockReturnValue({ changes: 1 });

      const { toggleService } = await import("../../src/store/aiDetectionToggles.js");
      const result = toggleService("guild-123", "hive");

      expect(result).toBe(true);
      expect(mockRun).toHaveBeenCalledWith("guild-123", "hive", 1);
    });

    it("toggles service that has no record (defaults to enabled)", async () => {
      // isServiceEnabled returns true (default)
      mockGet.mockReturnValue(undefined);
      mockRun.mockReturnValue({ changes: 1 });

      const { toggleService } = await import("../../src/store/aiDetectionToggles.js");
      const result = toggleService("guild-123", "hive");

      expect(result).toBe(false);
      expect(mockRun).toHaveBeenCalledWith("guild-123", "hive", 0);
    });
  });
});
