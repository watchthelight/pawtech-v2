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

  // Sort ascending
  const sorted = [...values].sort((a, b) => a - b);

  // Nearest-rank method: P = ceil(percentile/100 * N)
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;

  // Clamp to valid array bounds
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

  // Sort once
  const sorted = [...values].sort((a, b) => a - b);

  for (const p of percentiles) {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    result.set(p, sorted[Math.max(0, Math.min(index, sorted.length - 1))]);
  }

  return result;
}
