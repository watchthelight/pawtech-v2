/**
 * Pawtropolis Tech — tests/lib/rateLimiter.test.ts
 * WHAT: Unit tests for rate limiter utility.
 * WHY: Verify cooldown logic, time formatting, and cleanup.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  checkCooldown,
  clearCooldown,
  formatCooldown,
  COOLDOWNS,
} from "../../src/lib/rateLimiter.js";

// Mock the logger
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("rateLimiter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("checkCooldown", () => {
    it("allows first call for new command/scope", () => {
      const result = checkCooldown("test-cmd-1", "scope-1", 5000);
      expect(result.allowed).toBe(true);
      expect(result.remainingMs).toBeUndefined();
    });

    it("blocks immediate second call", () => {
      checkCooldown("test-cmd-2", "scope-1", 5000);
      const result = checkCooldown("test-cmd-2", "scope-1", 5000);

      expect(result.allowed).toBe(false);
      expect(result.remainingMs).toBeDefined();
      expect(result.remainingMs).toBeGreaterThan(0);
      expect(result.remainingMs).toBeLessThanOrEqual(5000);
    });

    it("allows call after cooldown expires", () => {
      checkCooldown("test-cmd-3", "scope-1", 5000);

      // Advance time past cooldown
      vi.advanceTimersByTime(6000);

      const result = checkCooldown("test-cmd-3", "scope-1", 5000);
      expect(result.allowed).toBe(true);
    });

    it("tracks different scopes independently", () => {
      checkCooldown("test-cmd-4", "scope-1", 5000);

      // Different scope should be allowed
      const result = checkCooldown("test-cmd-4", "scope-2", 5000);
      expect(result.allowed).toBe(true);
    });

    it("tracks different commands independently", () => {
      checkCooldown("cmd-a", "scope-1", 5000);

      // Different command should be allowed
      const result = checkCooldown("cmd-b", "scope-1", 5000);
      expect(result.allowed).toBe(true);
    });

    it("returns accurate remaining time", () => {
      checkCooldown("test-cmd-5", "scope-1", 10000);

      // Advance 3 seconds
      vi.advanceTimersByTime(3000);

      const result = checkCooldown("test-cmd-5", "scope-1", 10000);
      expect(result.allowed).toBe(false);
      expect(result.remainingMs).toBeCloseTo(7000, -2);
    });
  });

  describe("clearCooldown", () => {
    it("clears existing cooldown", () => {
      checkCooldown("test-cmd-6", "scope-1", 60000);

      // Should be blocked
      expect(checkCooldown("test-cmd-6", "scope-1", 60000).allowed).toBe(false);

      // Clear cooldown
      clearCooldown("test-cmd-6", "scope-1");

      // Should now be allowed
      expect(checkCooldown("test-cmd-6", "scope-1", 60000).allowed).toBe(true);
    });

    it("handles clearing non-existent cooldown gracefully", () => {
      // Should not throw
      expect(() => clearCooldown("nonexistent", "scope")).not.toThrow();
    });

    it("only clears specified scope", () => {
      checkCooldown("test-cmd-7", "scope-1", 60000);
      checkCooldown("test-cmd-7", "scope-2", 60000);

      clearCooldown("test-cmd-7", "scope-1");

      // scope-1 should be allowed
      expect(checkCooldown("test-cmd-7", "scope-1", 60000).allowed).toBe(true);

      // scope-2 should still be blocked
      expect(checkCooldown("test-cmd-7", "scope-2", 60000).allowed).toBe(false);
    });
  });

  describe("formatCooldown", () => {
    it("formats seconds correctly", () => {
      expect(formatCooldown(5000)).toBe("5 seconds");
      expect(formatCooldown(59000)).toBe("59 seconds");
    });

    it("formats sub-second as 1 second", () => {
      expect(formatCooldown(500)).toBe("1 seconds");
    });

    it("formats minutes correctly", () => {
      expect(formatCooldown(60 * 1000)).toBe("1 minute");
      expect(formatCooldown(2 * 60 * 1000)).toBe("2 minutes");
      expect(formatCooldown(30 * 60 * 1000)).toBe("30 minutes");
    });

    it("formats hours correctly", () => {
      expect(formatCooldown(60 * 60 * 1000)).toBe("1 hour");
      expect(formatCooldown(2 * 60 * 60 * 1000)).toBe("2 hours");
    });

    it("formats hours with remaining minutes", () => {
      expect(formatCooldown(1.5 * 60 * 60 * 1000)).toBe("1h 30m");
      expect(formatCooldown(2 * 60 * 60 * 1000 + 15 * 60 * 1000)).toBe("2h 15m");
    });
  });

  describe("COOLDOWNS constants", () => {
    it("has expected cooldown values", () => {
      expect(COOLDOWNS.AUDIT_NSFW_MS).toBe(60 * 60 * 1000); // 1 hour
      expect(COOLDOWNS.AUDIT_MEMBERS_MS).toBe(60 * 60 * 1000); // 1 hour
      expect(COOLDOWNS.DATABASE_CHECK_MS).toBe(5 * 60 * 1000); // 5 min
      expect(COOLDOWNS.SYNC_MS).toBe(10 * 60 * 1000); // 10 min
      expect(COOLDOWNS.AVATAR_SCAN_MS).toBe(60 * 60 * 1000); // 1 hour
      expect(COOLDOWNS.BACKFILL_MS).toBe(30 * 60 * 1000); // 30 min
      expect(COOLDOWNS.PURGE_MS).toBe(5 * 60 * 1000); // 5 min
      expect(COOLDOWNS.FLAG_MS).toBe(15 * 1000); // 15 sec
      expect(COOLDOWNS.PASSWORD_FAIL_MS).toBe(30 * 1000); // 30 sec
      expect(COOLDOWNS.SEARCH_MS).toBe(30 * 1000); // 30 sec
      expect(COOLDOWNS.ARTISTQUEUE_SYNC_MS).toBe(5 * 60 * 1000); // 5 min
    });

    it("all values are positive numbers", () => {
      for (const [key, value] of Object.entries(COOLDOWNS)) {
        expect(typeof value).toBe("number");
        expect(value).toBeGreaterThan(0);
      }
    });
  });
});
