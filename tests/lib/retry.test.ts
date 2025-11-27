/**
 * Pawtropolis Tech -- tests/lib/retry.test.ts
 * WHAT: Tests for retry utilities and circuit breaker.
 * WHY: These utilities handle transient failures; tests verify backoff,
 *      state transitions, and combined behavior work correctly.
 *
 * NOTE: These tests use real timers with minimal delays to avoid fake timer
 * complexity that can cause unhandled rejection issues.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
import {
  withRetry,
  CircuitBreaker,
  CircuitBreakerOpenError,
  withRetryAndBreaker,
} from "../../src/lib/retry.js";
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

// ===== CircuitBreaker Tests =====

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("closed state", () => {
    it("executes function normally when closed", async () => {
      const breaker = new CircuitBreaker("test");
      const fn = vi.fn().mockResolvedValue("result");

      const result = await breaker.execute(fn);

      expect(result).toBe("result");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("resets failure count on success", async () => {
      const breaker = new CircuitBreaker("test", { threshold: 5 });

      // Cause some failures (but not enough to open)
      for (let i = 0; i < 3; i++) {
        await expect(
          breaker.execute(() => Promise.reject(new Error("fail")))
        ).rejects.toThrow();
      }

      // Success should reset counter
      await breaker.execute(() => Promise.resolve("ok"));

      // Should be able to fail 4 more times without opening
      for (let i = 0; i < 4; i++) {
        await expect(
          breaker.execute(() => Promise.reject(new Error("fail")))
        ).rejects.toThrow();
      }

      // Still closed
      expect(breaker.getState().state).toBe("closed");
    });

    it("tracks consecutive failures", async () => {
      const breaker = new CircuitBreaker("test", { threshold: 3 });

      // Cause 2 failures
      for (let i = 0; i < 2; i++) {
        await expect(
          breaker.execute(() => Promise.reject(new Error("fail")))
        ).rejects.toThrow();
      }

      const state = breaker.getState();
      expect(state.state).toBe("closed");
      expect(state.failures).toBe(2);
    });
  });

  describe("opening the circuit", () => {
    it("opens after threshold failures", async () => {
      const breaker = new CircuitBreaker("test", { threshold: 3 });

      // Cause exactly threshold failures
      for (let i = 0; i < 3; i++) {
        await expect(
          breaker.execute(() => Promise.reject(new Error("fail")))
        ).rejects.toThrow();
      }

      expect(breaker.getState().state).toBe("open");
    });

    it("fails fast when open", async () => {
      const breaker = new CircuitBreaker("test", { threshold: 2 });

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        await expect(
          breaker.execute(() => Promise.reject(new Error("fail")))
        ).rejects.toThrow();
      }

      const fn = vi.fn().mockResolvedValue("should not run");

      await expect(breaker.execute(fn)).rejects.toThrow(CircuitBreakerOpenError);
      expect(fn).not.toHaveBeenCalled();
    });

    it("logs state transition", async () => {
      const breaker = new CircuitBreaker("transition_test", { threshold: 2 });

      for (let i = 0; i < 2; i++) {
        await expect(
          breaker.execute(() => Promise.reject(new Error("fail")))
        ).rejects.toThrow();
      }

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          evt: "circuit_breaker_transition",
          breaker: "transition_test",
          from: "closed",
          to: "open",
        }),
        expect.any(String)
      );
    });
  });

  describe("half-open state", () => {
    it("transitions to half-open after resetTimeMs", async () => {
      const breaker = new CircuitBreaker("test", {
        threshold: 2,
        resetTimeMs: 10, // Very short for testing
      });

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        await expect(
          breaker.execute(() => Promise.reject(new Error("fail")))
        ).rejects.toThrow();
      }

      expect(breaker.getState().state).toBe("open");

      // Wait past resetTimeMs
      await new Promise((r) => setTimeout(r, 20));

      // Next execution should enter half-open state and succeed
      const result = await breaker.execute(() => Promise.resolve("recovered"));
      expect(result).toBe("recovered");
    });

    it("returns to open on failure during half-open", async () => {
      const breaker = new CircuitBreaker("test", {
        threshold: 2,
        resetTimeMs: 10,
        halfOpenSuccesses: 2,
      });

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        await expect(
          breaker.execute(() => Promise.reject(new Error("fail")))
        ).rejects.toThrow();
      }

      // Wait past reset time
      await new Promise((r) => setTimeout(r, 20));

      // Fail during half-open test
      await expect(
        breaker.execute(() => Promise.reject(new Error("still broken")))
      ).rejects.toThrow();

      // Should be back to open
      expect(breaker.getState().state).toBe("open");
    });

    it("closes after halfOpenSuccesses", async () => {
      const breaker = new CircuitBreaker("test", {
        threshold: 2,
        resetTimeMs: 10,
        halfOpenSuccesses: 2,
      });

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        await expect(
          breaker.execute(() => Promise.reject(new Error("fail")))
        ).rejects.toThrow();
      }

      // Wait past reset time
      await new Promise((r) => setTimeout(r, 20));

      // Succeed twice during half-open
      await breaker.execute(() => Promise.resolve("ok1"));
      await breaker.execute(() => Promise.resolve("ok2"));

      expect(breaker.getState().state).toBe("closed");
    });
  });

  describe("executeWithFallback", () => {
    it("returns primary result when circuit is closed", async () => {
      const breaker = new CircuitBreaker("test");

      const result = await breaker.executeWithFallback(
        () => Promise.resolve("primary"),
        () => "fallback"
      );

      expect(result).toBe("primary");
    });

    it("returns fallback when circuit is open", async () => {
      const breaker = new CircuitBreaker("test", { threshold: 2 });

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        await expect(
          breaker.execute(() => Promise.reject(new Error("fail")))
        ).rejects.toThrow();
      }

      const result = await breaker.executeWithFallback(
        () => Promise.resolve("primary"),
        () => "fallback"
      );

      expect(result).toBe("fallback");
    });

    it("propagates non-circuit-breaker errors", async () => {
      const breaker = new CircuitBreaker("test");

      await expect(
        breaker.executeWithFallback(
          () => Promise.reject(new Error("not circuit error")),
          () => "fallback"
        )
      ).rejects.toThrow("not circuit error");
    });

    it("supports async fallback", async () => {
      const breaker = new CircuitBreaker("test", { threshold: 2 });

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        await expect(
          breaker.execute(() => Promise.reject(new Error("fail")))
        ).rejects.toThrow();
      }

      const result = await breaker.executeWithFallback(
        () => Promise.resolve("primary"),
        async () => "async fallback"
      );

      expect(result).toBe("async fallback");
    });
  });

  describe("getState", () => {
    it("returns current state information", () => {
      const breaker = new CircuitBreaker("test");
      const state = breaker.getState();

      expect(state).toEqual({
        state: "closed",
        failures: 0,
        lastFailure: 0,
      });
    });

    it("tracks lastFailure timestamp", async () => {
      const breaker = new CircuitBreaker("test");
      const before = Date.now();

      await expect(
        breaker.execute(() => Promise.reject(new Error("fail")))
      ).rejects.toThrow();

      const state = breaker.getState();
      expect(state.lastFailure).toBeGreaterThanOrEqual(before);
      expect(state.lastFailure).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("reset", () => {
    it("resets breaker to closed state", async () => {
      const breaker = new CircuitBreaker("test", { threshold: 2 });

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        await expect(
          breaker.execute(() => Promise.reject(new Error("fail")))
        ).rejects.toThrow();
      }

      expect(breaker.getState().state).toBe("open");

      breaker.reset();

      expect(breaker.getState().state).toBe("closed");
      expect(breaker.getState().failures).toBe(0);
    });

    it("logs reset action", () => {
      const breaker = new CircuitBreaker("reset_test");
      breaker.reset();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ breaker: "reset_test" }),
        expect.stringContaining("manually reset")
      );
    });
  });
});

// ===== CircuitBreakerOpenError Tests =====

describe("CircuitBreakerOpenError", () => {
  it("includes breaker name in message", () => {
    const error = new CircuitBreakerOpenError("my_service");

    expect(error.message).toBe("Circuit breaker [my_service] is open");
    expect(error.breakerName).toBe("my_service");
    expect(error.name).toBe("CircuitBreakerOpenError");
  });

  it("is instanceof Error", () => {
    const error = new CircuitBreakerOpenError("test");
    expect(error).toBeInstanceOf(Error);
  });
});

// ===== withRetryAndBreaker Tests =====

describe("withRetryAndBreaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("combines retry and circuit breaker", async () => {
    const breaker = new CircuitBreaker("combined_test", { threshold: 5 });
    const { fn, callCount } = createFailingThenSucceeding(2, "success");

    const result = await withRetryAndBreaker(fn, breaker, {
      maxAttempts: 3,
      initialDelayMs: 1,
      label: "combined",
    });

    expect(result).toBe("success");
    expect(callCount()).toBe(3);
    expect(breaker.getState().state).toBe("closed");
  });

  it("opens breaker after repeated failures across retries", async () => {
    const breaker = new CircuitBreaker("threshold_test", { threshold: 3 });
    const fn = vi.fn().mockRejectedValue(createNetworkError("ECONNRESET"));

    // First call with retries (3 attempts = 3 failures, opens breaker)
    await expect(
      withRetryAndBreaker(fn, breaker, {
        maxAttempts: 3,
        initialDelayMs: 1,
        label: "test1",
      })
    ).rejects.toThrow();

    // Breaker should now be open
    expect(breaker.getState().state).toBe("open");
  });

  it("fails fast when breaker is open", async () => {
    const breaker = new CircuitBreaker("open_test", { threshold: 2 });

    // Open the breaker
    for (let i = 0; i < 2; i++) {
      await expect(
        breaker.execute(() => Promise.reject(new Error("fail")))
      ).rejects.toThrow();
    }

    const fn = vi.fn().mockResolvedValue("should not run");

    await expect(
      withRetryAndBreaker(fn, breaker, { maxAttempts: 3, label: "test" })
    ).rejects.toThrow(CircuitBreakerOpenError);

    expect(fn).not.toHaveBeenCalled();
  });
});
