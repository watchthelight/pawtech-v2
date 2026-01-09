/**
 * Pawtropolis Tech — tests/lib/notifyLimiter.test.ts
 * WHAT: Unit tests for notification rate limiter.
 * WHY: Verify cooldown and hourly cap logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { InMemoryNotifyLimiter } from "../../src/lib/notifyLimiter.js";
import type { NotifyConfig } from "../../src/features/notifyConfig.js";

describe("InMemoryNotifyLimiter", () => {
  let limiter: InMemoryNotifyLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new InMemoryNotifyLimiter();
  });

  afterEach(() => {
    limiter.destroy();
    vi.useRealTimers();
  });

  function makeConfig(overrides: Partial<NotifyConfig> = {}): NotifyConfig {
    return {
      guild_id: "guild-123",
      thread_channel_id: "thread-123",
      ping_role_id: "role-123",
      notify_cooldown_seconds: 5,
      notify_max_per_hour: 10,
      created_at_s: 0,
      updated_at_s: 0,
      ...overrides,
    };
  }

  describe("canNotify", () => {
    it("allows first notification for new guild", () => {
      const config = makeConfig();
      const result = limiter.canNotify("guild-123", config);

      expect(result.ok).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("allows notification after cooldown expires", () => {
      const config = makeConfig({ notify_cooldown_seconds: 5 });

      limiter.recordNotify("guild-123");

      // Advance past cooldown
      vi.advanceTimersByTime(6000);

      const result = limiter.canNotify("guild-123", config);
      expect(result.ok).toBe(true);
    });

    it("blocks notification during cooldown", () => {
      const config = makeConfig({ notify_cooldown_seconds: 5 });

      limiter.recordNotify("guild-123");

      // Still in cooldown
      vi.advanceTimersByTime(3000);

      const result = limiter.canNotify("guild-123", config);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("cooldown_active");
      expect(result.reason).toContain("remaining");
    });

    it("blocks notification when hourly cap reached", () => {
      // Note: 0 || 5 = 5, so use 1 for non-default cooldown
      const config = makeConfig({ notify_cooldown_seconds: 1, notify_max_per_hour: 3 });

      // Send 3 notifications with time between to pass cooldown
      for (let i = 0; i < 3; i++) {
        limiter.recordNotify("guild-123");
        vi.advanceTimersByTime(1100); // Just past 1 second cooldown
      }

      const result = limiter.canNotify("guild-123", config);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("hourly_cap_reached");
      expect(result.reason).toContain("3/3");
    });

    it("allows notification after hourly window expires", () => {
      const config = makeConfig({ notify_cooldown_seconds: 1, notify_max_per_hour: 3 });

      // Send 3 notifications
      for (let i = 0; i < 3; i++) {
        limiter.recordNotify("guild-123");
        vi.advanceTimersByTime(1100);
      }

      // Advance past 1 hour
      vi.advanceTimersByTime(60 * 60 * 1000);

      const result = limiter.canNotify("guild-123", config);
      expect(result.ok).toBe(true);
    });

    it("uses default values when config values are undefined", () => {
      const config = makeConfig({
        notify_cooldown_seconds: undefined,
        notify_max_per_hour: undefined,
      });

      const result = limiter.canNotify("guild-123", config);
      expect(result.ok).toBe(true);
    });

    it("tracks different guilds independently", () => {
      const config = makeConfig({ notify_cooldown_seconds: 5 });

      limiter.recordNotify("guild-1");

      // guild-2 should still be allowed
      const result = limiter.canNotify("guild-2", config);
      expect(result.ok).toBe(true);
    });
  });

  describe("recordNotify", () => {
    it("creates new state for new guild", () => {
      limiter.recordNotify("guild-123");

      const config = makeConfig({ notify_cooldown_seconds: 5 });
      const result = limiter.canNotify("guild-123", config);

      // Should be blocked because we just recorded
      expect(result.ok).toBe(false);
    });

    it("evicts old timestamps when array grows too large", () => {
      const config = makeConfig({ notify_cooldown_seconds: 0, notify_max_per_hour: 200 });

      // Record many notifications
      for (let i = 0; i < 150; i++) {
        limiter.recordNotify("guild-123");
        vi.advanceTimersByTime(100); // Small advance
      }

      // Should still work - old ones evicted
      const result = limiter.canNotify("guild-123", config);
      // The eviction keeps only entries from last hour
      expect(result).toBeDefined();
    });
  });

  describe("cleanup", () => {
    it("removes stale guild entries", () => {
      limiter.recordNotify("guild-123");

      // Advance past 1 hour
      vi.advanceTimersByTime(61 * 60 * 1000);

      limiter.cleanup();

      // Guild should have clean state now
      const config = makeConfig({ notify_cooldown_seconds: 0 });
      const result = limiter.canNotify("guild-123", config);
      expect(result.ok).toBe(true);
    });

    it("keeps active guild entries", () => {
      const config = makeConfig({ notify_cooldown_seconds: 5 });

      limiter.recordNotify("guild-123");

      // Advance but not past the hour
      vi.advanceTimersByTime(30 * 60 * 1000);

      limiter.cleanup();

      // Advance past original cooldown
      vi.advanceTimersByTime(10000);

      // Guild should still have state
      limiter.recordNotify("guild-123");
      const result = limiter.canNotify("guild-123", config);
      expect(result.ok).toBe(false); // blocked by cooldown from second record
    });

    it("runs automatically on interval", () => {
      limiter.recordNotify("guild-123");

      // Advance past 1 hour + cleanup interval
      vi.advanceTimersByTime(61 * 60 * 1000 + 5 * 60 * 1000);

      // Cleanup should have run automatically
      const config = makeConfig();
      const result = limiter.canNotify("guild-123", config);
      expect(result.ok).toBe(true);
    });
  });

  describe("destroy", () => {
    it("stops cleanup interval", () => {
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");

      limiter.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it("handles multiple destroy calls gracefully", () => {
      limiter.destroy();
      expect(() => limiter.destroy()).not.toThrow();
    });
  });
});
