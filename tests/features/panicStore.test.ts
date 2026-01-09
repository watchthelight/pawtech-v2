/**
 * Pawtropolis Tech — tests/features/panicStore.test.ts
 * WHAT: Unit tests for panic mode store (emergency shutoff).
 * WHY: Verify cache management, persistence, and state queries.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the logger before importing the module
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the database
vi.mock("../../src/db/db.js", () => {
  const allFn = vi.fn(() => []);
  const runFn = vi.fn();
  const getFn = vi.fn();
  return {
    db: {
      prepare: vi.fn(() => ({
        all: allFn,
        run: runFn,
        get: getFn,
      })),
      _allFn: allFn,
      _runFn: runFn,
      _getFn: getFn,
    },
  };
});

describe("panicStore", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules(); // Clear module cache to reset panic state
  });

  describe("loadPanicState", () => {
    it("loads panic state from database on startup", async () => {
      const { db } = await import("../../src/db/db.js");
      const { loadPanicState, isPanicMode } = await import("../../src/features/panicStore.js");

      // Mock the database to return guilds in panic mode
      (db as any)._allFn.mockReturnValue([
        { guild_id: "guild-1", panic_mode: 1 },
        { guild_id: "guild-2", panic_mode: 1 },
      ]);

      loadPanicState();

      // isPanicMode should return true for loaded guilds
      expect(isPanicMode("guild-1")).toBe(true);
      expect(isPanicMode("guild-2")).toBe(true);
      expect(isPanicMode("guild-3")).toBe(false); // Not in panic
    });

    it("handles empty database gracefully", async () => {
      const { db } = await import("../../src/db/db.js");
      const { loadPanicState, isPanicMode } = await import("../../src/features/panicStore.js");

      (db as any)._allFn.mockReturnValue([]);

      loadPanicState();

      expect(isPanicMode("any-guild")).toBe(false);
    });

    it("handles database errors gracefully", async () => {
      const { db } = await import("../../src/db/db.js");
      const { loadPanicState, isPanicMode } = await import("../../src/features/panicStore.js");
      const { logger } = await import("../../src/lib/logger.js");

      (db as any)._allFn.mockImplementation(() => {
        throw new Error("Database connection failed");
      });

      // Should not throw
      loadPanicState();

      expect(logger.error).toHaveBeenCalled();
      expect(isPanicMode("any-guild")).toBe(false);
    });
  });

  describe("isPanicMode", () => {
    it("returns false by default for unknown guilds", async () => {
      const { isPanicMode } = await import("../../src/features/panicStore.js");

      expect(isPanicMode("unknown-guild")).toBe(false);
    });
  });

  describe("setPanicMode", () => {
    it("enables panic mode and persists to database", async () => {
      const { db } = await import("../../src/db/db.js");
      const { setPanicMode, isPanicMode } = await import("../../src/features/panicStore.js");

      setPanicMode("guild-123", true, "mod-456");

      expect(isPanicMode("guild-123")).toBe(true);
      expect((db as any)._runFn).toHaveBeenCalled();
    });

    it("disables panic mode and persists to database", async () => {
      const { db } = await import("../../src/db/db.js");
      const { setPanicMode, isPanicMode } = await import("../../src/features/panicStore.js");

      // First enable
      setPanicMode("guild-123", true);
      expect(isPanicMode("guild-123")).toBe(true);

      // Then disable
      setPanicMode("guild-123", false);
      expect(isPanicMode("guild-123")).toBe(false);
    });

    it("updates cache even if database fails", async () => {
      const { db } = await import("../../src/db/db.js");
      const { setPanicMode, isPanicMode } = await import("../../src/features/panicStore.js");
      const { logger } = await import("../../src/lib/logger.js");

      // Make database fail
      (db as any)._runFn.mockImplementation(() => {
        throw new Error("Database write failed");
      });

      setPanicMode("guild-456", true, "mod-789");

      // Cache should still be updated
      expect(isPanicMode("guild-456")).toBe(true);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getPanicGuilds", () => {
    it("returns all guilds in panic mode", async () => {
      const { setPanicMode, getPanicGuilds } = await import("../../src/features/panicStore.js");

      setPanicMode("guild-a", true);
      setPanicMode("guild-b", true);
      setPanicMode("guild-c", false);

      const panicGuilds = getPanicGuilds();

      expect(panicGuilds).toContain("guild-a");
      expect(panicGuilds).toContain("guild-b");
      expect(panicGuilds).not.toContain("guild-c");
    });

    it("returns empty array when no guilds in panic", async () => {
      const { getPanicGuilds } = await import("../../src/features/panicStore.js");

      const panicGuilds = getPanicGuilds();

      expect(panicGuilds).toEqual([]);
    });
  });

  describe("clearPanicCache", () => {
    it("removes guild from cache", async () => {
      const { setPanicMode, isPanicMode, clearPanicCache } = await import("../../src/features/panicStore.js");

      setPanicMode("guild-123", true);
      expect(isPanicMode("guild-123")).toBe(true);

      clearPanicCache("guild-123");

      expect(isPanicMode("guild-123")).toBe(false);
    });

    it("handles clearing non-existent guild gracefully", async () => {
      const { clearPanicCache, isPanicMode } = await import("../../src/features/panicStore.js");

      // Should not throw
      clearPanicCache("non-existent-guild");

      expect(isPanicMode("non-existent-guild")).toBe(false);
    });
  });

  describe("getPanicDetails", () => {
    it("returns panic details from database", async () => {
      const { db } = await import("../../src/db/db.js");
      const { getPanicDetails } = await import("../../src/features/panicStore.js");

      const nowS = Math.floor(Date.now() / 1000);
      (db as any)._getFn.mockReturnValue({
        panic_mode: 1,
        panic_enabled_at: nowS,
        panic_enabled_by: "mod-123",
      });

      const details = getPanicDetails("guild-123");

      expect(details).not.toBeNull();
      expect(details!.enabled).toBe(true);
      expect(details!.enabledBy).toBe("mod-123");
      expect(details!.enabledAt).toBeInstanceOf(Date);
    });

    it("returns disabled state when no config row exists", async () => {
      const { db } = await import("../../src/db/db.js");
      const { getPanicDetails } = await import("../../src/features/panicStore.js");

      (db as any)._getFn.mockReturnValue(undefined);

      const details = getPanicDetails("guild-123");

      expect(details).not.toBeNull();
      expect(details!.enabled).toBe(false);
      expect(details!.enabledAt).toBeNull();
      expect(details!.enabledBy).toBeNull();
    });

    it("returns disabled state when panic_mode is 0", async () => {
      const { db } = await import("../../src/db/db.js");
      const { getPanicDetails } = await import("../../src/features/panicStore.js");

      (db as any)._getFn.mockReturnValue({
        panic_mode: 0,
        panic_enabled_at: null,
        panic_enabled_by: null,
      });

      const details = getPanicDetails("guild-123");

      expect(details!.enabled).toBe(false);
    });

    it("falls back to cache when database fails", async () => {
      const { db } = await import("../../src/db/db.js");
      const { getPanicDetails, setPanicMode } = await import("../../src/features/panicStore.js");

      // Set panic in cache
      setPanicMode("guild-789", true);

      // Make database fail
      (db as any)._getFn.mockImplementation(() => {
        throw new Error("Database error");
      });

      const details = getPanicDetails("guild-789");

      expect(details!.enabled).toBe(true);
      expect(details!.enabledAt).toBeNull(); // Lost details due to DB error
      expect(details!.enabledBy).toBeNull();
    });
  });
});
