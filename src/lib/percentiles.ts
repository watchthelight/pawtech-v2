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
