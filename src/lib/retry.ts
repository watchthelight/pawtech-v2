/**
 * Pawtropolis Tech — src/lib/retry.ts
 * WHAT: Retry utilities for handling transient failures
 * WHY: Network errors, rate limits, and database locks can be recovered with retries
 * FLOWS:
 *  - withRetry(fn, options) → Retries fn with exponential backoff
 * USAGE:
 *  import { withRetry } from "./retry.js";
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

  // Validate maxAttempts to prevent undefined behavior.
  // Someone will eventually pass 0 or -1. When they do, fail loudly instead of
  // silently returning undefined or looping forever.
  if (maxAttempts < 1) {
    throw new Error(`withRetry: maxAttempts must be >= 1, got ${maxAttempts}`);
  }

  // lastError is typed as unknown because we genuinely don't know what fn() throws.
  // Could be an Error, could be a string, could be a number someone threw as a joke.
  let lastError: unknown;
  let delayMs = initialDelayMs;

  // The classic retry loop. Attempt 1 is immediate, subsequent attempts have delay.
  // If you're here debugging a production issue at 2am, the log lines include
  // attempt number and delay - check your log aggregator for "retry_attempt".
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const classified = classifyError(err);

      /*
       * Decision time: should we retry?
       * Order matters here - check maxAttempts first so we don't call shouldRetry
       * unnecessarily on the final attempt. Micro-optimization? Sure. But also clearer.
       */
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

      // Add jitter to prevent thundering herd (0.5x to 1.5x of base delay).
      // Without jitter, if 100 requests all fail at once, they'd all retry
      // at exactly the same time, hammering the already-struggling service.
      // Randomizing spreads them out. This is standard practice but often forgotten.
      const jitteredDelayMs = Math.floor(delayMs * (0.5 + Math.random()));

      // Log retry attempt
      logger.debug(
        {
          evt: "retry_attempt",
          label,
          attempt,
          maxAttempts,
          delayMs: jitteredDelayMs,
          errorKind: classified.kind,
        },
        `[retry] ${label} attempt ${attempt} failed, retrying in ${jitteredDelayMs}ms`
      );

      // Wait before retrying with jitter to prevent thundering herd
      await sleep(jitteredDelayMs);

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
 * Simple sleep helper.
 * Not exported because it's trivial enough that every project has its own version.
 * If you need sleep() elsewhere, just copy this or use timers/promises.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
