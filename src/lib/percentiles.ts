/**
 * Pawtropolis Tech — src/lib/percentiles.ts
 * WHAT: Compute percentiles from numeric arrays
 * WHY: Performance metrics (p50, p95) for moderator response times
 * DOCS: https://en.wikipedia.org/wiki/Percentile (nearest-rank method)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/**
 * WHAT: Compute percentile using nearest-rank method
 * WHY: Simple, efficient percentile calculation for small-medium datasets
 *
 * @param values - Array of numeric values
 * @param percentile - Percentile to compute (0-100)
 * @returns Percentile value, or null if array is empty
 */
export function computePercentile(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];

  // Creates a copy to avoid mutating input - intentional trade-off of O(n) space
  // for cleaner API. If you're computing percentiles on huge arrays frequently,
  // consider an in-place sort variant or streaming quantile algorithms.
  const sorted = [...values].sort((a, b) => a - b);

  // Nearest-rank method: P = ceil(percentile/100 * N)
  // Note: percentile=0 gives index=-1 which the clamp handles.
  // If you need linear interpolation (e.g., for smoother p99), use a different algo.
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;

  // Clamp handles edge cases: percentile <= 0 returns min, >= 100 returns max
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

/**
 * WHAT: Compute multiple percentiles at once
 * WHY: Avoid multiple sorts when computing p50, p95 together
 *
 * @param values - Array of numeric values
 * @param percentiles - Array of percentiles to compute (e.g., [50, 95])
 * @returns Map of percentile -> value
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
  const sorted = [...values].sort((a, b) => a - b);

  for (const p of percentiles) {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    result.set(p, sorted[Math.max(0, Math.min(index, sorted.length - 1))]);
  }

  return result;
}
