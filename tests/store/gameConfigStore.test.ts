/**
 * Pawtropolis Tech — tests/store/gameConfigStore.test.ts
 * WHAT: Unit tests for game config store CRUD operations.
 * WHY: Verify game night configuration get/set operations.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the database
const mockGet = vi.fn();
const mockRun = vi.fn();

vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: vi.fn(() => ({
      get: mockGet,
      run: mockRun,
    })),
  },
}));

describe("gameConfigStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("getGameConfig", () => {
    it("returns stored config when exists", async () => {
      mockGet.mockReturnValue({
        qualification_percentage: 75,
        attendance_mode: "continuous",
      });

      const { getGameConfig } = await import("../../src/store/gameConfigStore.js");
      const result = getGameConfig("guild-123");

      expect(result).toEqual({
        guildId: "guild-123",
        qualificationPercentage: 75,
        attendanceMode: "continuous",
      });
    });

    it("returns defaults when no config exists", async () => {
      mockGet.mockReturnValue(undefined);

      const { getGameConfig } = await import("../../src/store/gameConfigStore.js");
      const result = getGameConfig("guild-new");

      expect(result).toEqual({
        guildId: "guild-new",
        qualificationPercentage: 50, // default
        attendanceMode: "cumulative", // default
      });
    });

    it("returns defaults on database error", async () => {
      mockGet.mockImplementation(() => {
        throw new Error("Table not found");
      });

      const { getGameConfig } = await import("../../src/store/gameConfigStore.js");
      const result = getGameConfig("guild-123");

      expect(result).toEqual({
        guildId: "guild-123",
        qualificationPercentage: 50,
        attendanceMode: "cumulative",
      });
    });
  });

  describe("getGameQualificationPercentage", () => {
    it("returns stored percentage when exists", async () => {
      mockGet.mockReturnValue({ qualification_percentage: 60 });

      const { getGameQualificationPercentage } = await import("../../src/store/gameConfigStore.js");
      const result = getGameQualificationPercentage("guild-123");

      expect(result).toBe(60);
    });

    it("returns default (50) when no config", async () => {
      mockGet.mockReturnValue(undefined);

      const { getGameQualificationPercentage } = await import("../../src/store/gameConfigStore.js");
      const result = getGameQualificationPercentage("guild-123");

      expect(result).toBe(50);
    });

    it("returns default on database error", async () => {
      mockGet.mockImplementation(() => {
        throw new Error("DB error");
      });

      const { getGameQualificationPercentage } = await import("../../src/store/gameConfigStore.js");
      const result = getGameQualificationPercentage("guild-123");

      expect(result).toBe(50);
    });
  });

  describe("getGameAttendanceMode", () => {
    it("returns stored mode when exists", async () => {
      mockGet.mockReturnValue({ attendance_mode: "continuous" });

      const { getGameAttendanceMode } = await import("../../src/store/gameConfigStore.js");
      const result = getGameAttendanceMode("guild-123");

      expect(result).toBe("continuous");
    });

    it("returns default (cumulative) when no config", async () => {
      mockGet.mockReturnValue(undefined);

      const { getGameAttendanceMode } = await import("../../src/store/gameConfigStore.js");
      const result = getGameAttendanceMode("guild-123");

      expect(result).toBe("cumulative");
    });

    it("returns default on database error", async () => {
      mockGet.mockImplementation(() => {
        throw new Error("DB error");
      });

      const { getGameAttendanceMode } = await import("../../src/store/gameConfigStore.js");
      const result = getGameAttendanceMode("guild-123");

      expect(result).toBe("cumulative");
    });
  });

  describe("setGameQualificationPercentage", () => {
    it("sets percentage successfully", async () => {
      mockRun.mockReturnValue({ changes: 1 });

      const { setGameQualificationPercentage } = await import("../../src/store/gameConfigStore.js");
      setGameQualificationPercentage("guild-123", 75);

      expect(mockRun).toHaveBeenCalledWith("guild-123", 75);
    });

    it("throws error when percentage below 10", async () => {
      const { setGameQualificationPercentage } = await import("../../src/store/gameConfigStore.js");

      expect(() => setGameQualificationPercentage("guild-123", 5)).toThrow(
        "Percentage must be between 10 and 90"
      );
    });

    it("throws error when percentage above 90", async () => {
      const { setGameQualificationPercentage } = await import("../../src/store/gameConfigStore.js");

      expect(() => setGameQualificationPercentage("guild-123", 95)).toThrow(
        "Percentage must be between 10 and 90"
      );
    });

    it("accepts boundary value 10", async () => {
      mockRun.mockReturnValue({ changes: 1 });

      const { setGameQualificationPercentage } = await import("../../src/store/gameConfigStore.js");
      setGameQualificationPercentage("guild-123", 10);

      expect(mockRun).toHaveBeenCalledWith("guild-123", 10);
    });

    it("accepts boundary value 90", async () => {
      mockRun.mockReturnValue({ changes: 1 });

      const { setGameQualificationPercentage } = await import("../../src/store/gameConfigStore.js");
      setGameQualificationPercentage("guild-123", 90);

      expect(mockRun).toHaveBeenCalledWith("guild-123", 90);
    });
  });

  describe("setGameAttendanceMode", () => {
    it("sets cumulative mode", async () => {
      mockRun.mockReturnValue({ changes: 1 });

      const { setGameAttendanceMode } = await import("../../src/store/gameConfigStore.js");
      setGameAttendanceMode("guild-123", "cumulative");

      expect(mockRun).toHaveBeenCalledWith("guild-123", "cumulative");
    });

    it("sets continuous mode", async () => {
      mockRun.mockReturnValue({ changes: 1 });

      const { setGameAttendanceMode } = await import("../../src/store/gameConfigStore.js");
      setGameAttendanceMode("guild-123", "continuous");

      expect(mockRun).toHaveBeenCalledWith("guild-123", "continuous");
    });
  });

  describe("updateGameConfig", () => {
    it("updates both fields when provided", async () => {
      // First call for getGameConfig
      mockGet.mockReturnValue({
        qualification_percentage: 50,
        attendance_mode: "cumulative",
      });
      mockRun.mockReturnValue({ changes: 1 });

      const { updateGameConfig } = await import("../../src/store/gameConfigStore.js");
      updateGameConfig("guild-123", {
        qualificationPercentage: 80,
        attendanceMode: "continuous",
      });

      expect(mockRun).toHaveBeenCalledWith("guild-123", 80, "continuous");
    });

    it("preserves existing values when partial update", async () => {
      // First call for getGameConfig
      mockGet.mockReturnValue({
        qualification_percentage: 60,
        attendance_mode: "continuous",
      });
      mockRun.mockReturnValue({ changes: 1 });

      const { updateGameConfig } = await import("../../src/store/gameConfigStore.js");
      updateGameConfig("guild-123", {
        qualificationPercentage: 70,
        // attendanceMode not provided - should keep existing
      });

      expect(mockRun).toHaveBeenCalledWith("guild-123", 70, "continuous");
    });

    it("uses defaults when no existing config", async () => {
      mockGet.mockReturnValue(undefined);
      mockRun.mockReturnValue({ changes: 1 });

      const { updateGameConfig } = await import("../../src/store/gameConfigStore.js");
      updateGameConfig("guild-new", {
        qualificationPercentage: 65,
      });

      // Should use default "cumulative" for attendance mode
      expect(mockRun).toHaveBeenCalledWith("guild-new", 65, "cumulative");
    });
  });
});
