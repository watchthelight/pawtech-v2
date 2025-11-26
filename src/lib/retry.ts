/**
 * Pawtropolis Tech — src/lib/retry.ts
 * WHAT: Retry utilities for handling transient failures
 * WHY: Network errors, rate limits, and database locks can be recovered with retries
 * FLOWS:
 *  - withRetry(fn, options) → Retries fn with exponential backoff
 *  - CircuitBreaker → Prevents cascading failures
 * USAGE:
 *  import { withRetry, CircuitBreaker } from "./retry.js";
 *  const result = await withRetry(() => fetchData(), { maxAttempts: 3 });
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { logger } from "./logger.js";
import { classifyError, isRecoverable, type ClassifiedError } from "./errors.js";

/**
 * Options for retry behavior.
 *
 * The defaults here (3 attempts, 100ms initial, 2x backoff) give you:
 * - Attempt 1: immediate
 * - Attempt 2: after 100ms
 * - Attempt 3: after 200ms
 * Total time: ~300ms worst case, which is usually acceptable for user-facing ops.
 *
 * For background jobs, you might want longer delays (initialDelayMs: 1000)
 * and more attempts (maxAttempts: 5).
 */
export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in ms before first retry (default: 100) */
  initialDelayMs?: number;
  /** Maximum delay in ms (default: 5000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Custom function to determine if error is retryable */
  shouldRetry?: (err: ClassifiedError, attempt: number) => boolean;
  /** Label for logging */
  label?: string;
}

/**
 * Retry an async operation with exponential backoff
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration
 * @returns The result of fn() if successful
 * @throws The last error if all attempts fail
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => fetchFromApi(),
 *   { maxAttempts: 3, label: "api_fetch" }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 100,
    maxDelayMs = 5000,
    backoffMultiplier = 2,
    shouldRetry = (err) => isRecoverable(err),
    label = "operation",
  } = options;

  let lastError: unknown;
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const classified = classifyError(err);

      // Check if we should retry
      if (attempt === maxAttempts || !shouldRetry(classified, attempt)) {
        logger.warn(
          {
            evt: "retry_exhausted",
            label,
            attempt,
            maxAttempts,
            errorKind: classified.kind,
            errorMessage: classified.message,
          },
          `[retry] ${label} failed after ${attempt} attempts`
        );
        throw err;
      }

      // Log retry attempt
      logger.debug(
        {
          evt: "retry_attempt",
          label,
          attempt,
          maxAttempts,
          delayMs,
          errorKind: classified.kind,
        },
        `[retry] ${label} attempt ${attempt} failed, retrying in ${delayMs}ms`
      );

      // Wait before retrying. Note: no jitter here. If you're seeing
      // thundering herd issues (many clients retrying simultaneously),
      // add random jitter: delayMs * (0.5 + Math.random())
      await sleep(delayMs);

      // Exponential backoff with cap. The cap prevents absurdly long waits
      // if someone misconfigures the multiplier or maxAttempts.
      delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
    }
  }

  // Should never reach here, but TypeScript needs this for control flow analysis.
  // If we hit this line, there's a bug in the loop logic above.
  throw lastError;
}

/**
 * Circuit breaker states.
 *
 * The names come from electrical circuit breakers:
 * - CLOSED: Current flows (requests go through)
 * - OPEN: Circuit broken (requests fail immediately)
 * - HALF-OPEN: Testing if we can close the circuit again
 */
type CircuitState = "closed" | "open" | "half-open";

/**
 * Circuit breaker to prevent cascading failures.
 *
 * Use this when calling external services that might be down or slow.
 * Instead of hammering a dead service (and making things worse), the
 * breaker "opens" after N failures and fails fast for a cooldown period.
 *
 * State machine:
 * - CLOSED -> OPEN: After `threshold` consecutive failures
 * - OPEN -> HALF-OPEN: After `resetTimeMs` has passed
 * - HALF-OPEN -> CLOSED: After `halfOpenSuccesses` successes
 * - HALF-OPEN -> OPEN: On any failure (back to square one)
 *
 * This is a simplified implementation. Production circuit breakers often
 * track failure *rate* rather than count, and use sliding windows.
 * But for a Discord bot calling a few external services, this is fine.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private lastFailure = 0;
  private lastStateChange = Date.now();

  constructor(
    private name: string,
    private options: {
      /** Number of failures before opening circuit (default: 5) */
      threshold?: number;
      /** Time in ms before attempting to close circuit (default: 60000) */
      resetTimeMs?: number;
      /** Number of successes needed in half-open to close (default: 2) */
      halfOpenSuccesses?: number;
    } = {}
  ) {}

  private get threshold() {
    return this.options.threshold ?? 5;
  }

  private get resetTimeMs() {
    return this.options.resetTimeMs ?? 60000;
  }

  private get halfOpenSuccesses() {
    return this.options.halfOpenSuccesses ?? 2;
  }

  /**
   * Execute a function through the circuit breaker.
   *
   * If the circuit is open, this throws immediately without calling fn().
   * That's the whole point - we fail fast instead of waiting for a timeout.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we should transition from open to half-open.
    // This is time-based: after resetTimeMs, we let one request through to test.
    if (this.state === "open") {
      if (Date.now() - this.lastFailure > this.resetTimeMs) {
        this.transitionTo("half-open");
      } else {
        // Fail fast - don't even try
        logger.debug(
          { breaker: this.name, state: this.state },
          `[circuit-breaker] ${this.name} is open, failing fast`
        );
        throw new CircuitBreakerOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /**
   * Execute with fallback when circuit is open
   */
  async executeWithFallback<T>(
    fn: () => Promise<T>,
    fallback: () => T | Promise<T>
  ): Promise<T> {
    try {
      return await this.execute(fn);
    } catch (err) {
      if (err instanceof CircuitBreakerOpenError) {
        logger.debug(
          { breaker: this.name },
          `[circuit-breaker] ${this.name} using fallback`
        );
        return await fallback();
      }
      throw err;
    }
  }

  private onSuccess() {
    if (this.state === "half-open") {
      // We're testing if the service recovered. Count successes.
      this.successes++;
      if (this.successes >= this.halfOpenSuccesses) {
        // Service is healthy again - close the circuit
        this.transitionTo("closed");
      }
    } else if (this.state === "closed") {
      // Reset failure count on success. A single success means the service
      // is working, so we start the failure count fresh.
      this.failures = 0;
    }
  }

  private onFailure() {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.state === "half-open") {
      // We were testing recovery and it failed. Back to open state.
      // This is intentionally aggressive - we don't want to let more
      // requests through if the service is still struggling.
      this.transitionTo("open");
    } else if (this.state === "closed" && this.failures >= this.threshold) {
      // Too many failures - open the circuit to stop the bleeding
      this.transitionTo("open");
    }
  }

  private transitionTo(newState: CircuitState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === "half-open") {
      this.successes = 0;
    } else if (newState === "closed") {
      this.failures = 0;
      this.successes = 0;
    }

    logger.info(
      {
        evt: "circuit_breaker_transition",
        breaker: this.name,
        from: oldState,
        to: newState,
        failures: this.failures,
      },
      `[circuit-breaker] ${this.name} transitioned from ${oldState} to ${newState}`
    );
  }

  /**
   * Get current state for monitoring
   */
  getState(): { state: CircuitState; failures: number; lastFailure: number } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailure: this.lastFailure,
    };
  }

  /**
   * Force reset the circuit breaker (for testing/admin)
   */
  reset() {
    this.failures = 0;
    this.successes = 0;
    this.state = "closed";
    this.lastStateChange = Date.now();
    logger.info({ breaker: this.name }, `[circuit-breaker] ${this.name} manually reset`);
  }
}

/**
 * Error thrown when circuit breaker is open.
 *
 * Callers can catch this specifically to handle the "service down" case
 * differently from other errors. For example, showing a cached result
 * or a degraded UI instead of an error message.
 */
export class CircuitBreakerOpenError extends Error {
  constructor(public breakerName: string) {
    super(`Circuit breaker [${breakerName}] is open`);
    this.name = "CircuitBreakerOpenError";
  }
}

/**
 * Simple sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry with circuit breaker combined.
 *
 * This wraps the function in both retry logic AND circuit breaker protection.
 * The order matters: we retry THROUGH the breaker, not the other way around.
 * That means each retry attempt goes through the breaker's execute(), and
 * if the breaker opens mid-retry, subsequent attempts fail fast.
 *
 * For most use cases, this is what you want. The alternative (breaker outside
 * retry) would let all retries complete even if every one fails, which defeats
 * the purpose of the circuit breaker.
 */
export async function withRetryAndBreaker<T>(
  fn: () => Promise<T>,
  breaker: CircuitBreaker,
  options: RetryOptions = {}
): Promise<T> {
  return withRetry(() => breaker.execute(fn), options);
}
