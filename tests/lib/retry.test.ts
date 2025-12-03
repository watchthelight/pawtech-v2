/**
 * Pawtropolis Tech -- tests/lib/retry.test.ts
 * WHAT: Tests for retry utilities.
 * WHY: These utilities handle transient failures; tests verify backoff
 *      and retry behavior work correctly.
 *
 * NOTE: These tests use real timers with minimal delays to avoid fake timer
 * complexity that can cause unhandled rejection issues.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// ===== Mock Setup =====

// Mock logger before importing retry module
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
import { withRetry } from "../../src/lib/retry.js";
import { createNetworkError } from "../utils/discordMocks.js";

// ===== Test Helpers =====

/**
 * Creates a function that fails N times then succeeds.
 */
function createFailingThenSucceeding<T>(
  failCount: number,
  successValue: T,
  errorFactory: () => Error = () => createNetworkError("ECONNRESET")
): { fn: () => Promise<T>; callCount: () => number } {
  let calls = 0;
  return {
    fn: async () => {
      calls++;
      if (calls <= failCount) {
        throw errorFactory();
      }
      return successValue;
    },
    callCount: () => calls,
  };
}

// ===== withRetry Tests =====

describe("withRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("success cases", () => {
    it("returns result on first success", async () => {
      const fn = vi.fn().mockResolvedValue("success");

      const result = await withRetry(fn, { maxAttempts: 3 });

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("succeeds after retries with minimal delay", async () => {
      const { fn, callCount } = createFailingThenSucceeding(2, "success");

      const result = await withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 1, // Minimal delay for fast tests
        label: "test_op",
      });

      expect(result).toBe("success");
      expect(callCount()).toBe(3); // 2 failures + 1 success
    });
  });

  describe("failure cases", () => {
    it("throws after max attempts exhausted", async () => {
      const error = createNetworkError("ECONNRESET");
      const fn = vi.fn().mockRejectedValue(error);

      await expect(
        withRetry(fn, {
          maxAttempts: 3,
          initialDelayMs: 1,
          label: "failing_op",
        })
      ).rejects.toThrow("ECONNRESET");

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("throws immediately for non-recoverable errors", async () => {
      // Non-recoverable error (validation-like)
      const error = new Error("Invalid input");
      const fn = vi.fn().mockRejectedValue(error);

      await expect(
        withRetry(fn, { maxAttempts: 3, label: "validation" })
      ).rejects.toThrow("Invalid input");

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("respects custom shouldRetry function", async () => {
      const { fn, callCount } = createFailingThenSucceeding(5, "success");

      await expect(
        withRetry(fn, {
          maxAttempts: 10,
          initialDelayMs: 1,
          shouldRetry: (_err, attempt) => attempt < 3, // Only retry twice
          label: "custom_retry",
        })
      ).rejects.toThrow();

      expect(callCount()).toBe(3); // Initial + 2 retries
    });
  });

  describe("backoff behavior", () => {
    it("applies backoff multiplier", async () => {
      const fn = vi.fn().mockRejectedValue(createNetworkError("ECONNRESET"));
      const startTime = Date.now();

      // Use very small delays to make test fast but still verify behavior
      await expect(
        withRetry(fn, {
          maxAttempts: 3,
          initialDelayMs: 5,
          backoffMultiplier: 2,
          maxDelayMs: 100,
          label: "backoff_test",
        })
      ).rejects.toThrow();

      const elapsed = Date.now() - startTime;
      expect(fn).toHaveBeenCalledTimes(3);
      // Should have some delay due to backoff (at least 5ms + ~10ms with jitter)
      expect(elapsed).toBeGreaterThanOrEqual(5);
    });
  });

  describe("validation", () => {
    it("throws for maxAttempts < 1", async () => {
      await expect(
        withRetry(() => Promise.resolve("test"), { maxAttempts: 0 })
      ).rejects.toThrow("maxAttempts must be >= 1");
    });

    it("throws for negative maxAttempts", async () => {
      await expect(
        withRetry(() => Promise.resolve("test"), { maxAttempts: -1 })
      ).rejects.toThrow("maxAttempts must be >= 1");
    });
  });

  describe("logging", () => {
    it("logs retry attempts", async () => {
      const { fn } = createFailingThenSucceeding(1, "success");

      await withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 1,
        label: "logged_op",
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          evt: "retry_attempt",
          label: "logged_op",
          attempt: 1,
        }),
        expect.any(String)
      );
    });

    it("logs exhausted retries", async () => {
      const fn = vi.fn().mockRejectedValue(createNetworkError("ECONNRESET"));

      await expect(
        withRetry(fn, {
          maxAttempts: 2,
          initialDelayMs: 1,
          label: "exhausted_op",
        })
      ).rejects.toThrow();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          evt: "retry_exhausted",
          label: "exhausted_op",
        }),
        expect.any(String)
      );
    });
  });
});
