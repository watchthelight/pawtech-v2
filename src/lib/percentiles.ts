/**
 * Pawtropolis Tech — src/lib/percentiles.ts
 * WHAT: Compute percentiles from numeric arrays
 * WHY: Performance metrics (p50, p95) for moderator response times
 * DOCS: https://en.wikipedia.org/wiki/Percentile (nearest-rank method)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/**
 * WHAT: Compute multiple percentiles at once
 * WHY: Avoid multiple sorts when computing p50, p95 together
 *
 * Uses nearest-rank method: take the value at ceil((p/100)*n)-1.
 * This is slightly biased for small datasets but good enough for
 * response time monitoring. If you need interpolated percentiles
 * for scientific accuracy, look elsewhere.
 *
 * @param values - Array of numeric values
 * @param percentiles - Array of percentiles to compute (e.g., [50, 95])
 * @returns Map of percentile -> value (null if empty input)
 *
 * @example
 * computePercentiles([100, 200, 300, 400, 500], [50, 95])
 * // Map { 50 => 300, 95 => 500 }
 */
export function computePercentiles(
  values: number[],
  percentiles: number[]
): Map<number, number | null> {
  const result = new Map<number, number | null>();

  if (values.length === 0) {
    for (const p of percentiles) {
      result.set(p, null);
    }
    return result;
  }

  // Sort once, compute many - O(n log n) dominates regardless of how many
  // percentiles you request. Much better than calling computePercentile in a loop.
  // The spread copy prevents mutating the original array. Yes, it allocates.
  // If you're computing percentiles on million-element arrays, (a) why, and
  // (b) consider a streaming quantile algorithm like t-digest instead.
  const sorted = [...values].sort((a, b) => a - b);

  for (const p of percentiles) {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    result.set(p, sorted[Math.max(0, Math.min(index, sorted.length - 1))]);
  }

  return result;
}
