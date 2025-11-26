/**
 * Pawtropolis Tech — src/lib/anomaly.ts
 * WHAT: Simple anomaly detection using z-score
 * WHY: Flag moderators with unusual activity patterns
 * DOCS: https://en.wikipedia.org/wiki/Standard_score
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

export interface AnomalyResult {
  isAnomaly: boolean;
  score: number;
  reason: string | null;
}

/**
 * WHAT: Compute mean and standard deviation
 * WHY: Foundation for z-score calculation
 *
 * Uses Bessel's correction (n-1 denominator) for sample std dev.
 * This matters when n is small (< 30) - gives less biased estimate
 * of population variance from a sample.
 */
function computeStats(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

  // Can't compute variance from single value (division by zero with n-1)
  if (values.length === 1) return { mean, std: 0 };

  const variance =
    values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
  const std = Math.sqrt(variance);

  return { mean, std };
}

/**
 * WHAT: Detect if a value is an anomaly using z-score
 * WHY: Alert leadership to unusual moderator activity patterns
 *
 * @param value - Value to check (e.g., daily action count)
 * @param population - Population values for comparison
 * @param threshold - Z-score threshold (default 3.0 = 99.7% within range)
 * @returns Anomaly detection result
 */
export function detectAnomaly(
  value: number,
  population: number[],
  threshold: number = 3.0
): AnomalyResult {
  // Need at least 3 data points for meaningful statistics.
  // With fewer samples, std dev is too unreliable and you get
  // false positives on perfectly normal variation.
  if (population.length < 3) {
    return { isAnomaly: false, score: 0, reason: null };
  }

  const { mean, std } = computeStats(population);

  // Zero variance means everyone had identical counts (common early in server life).
  // Any deviation from the constant is technically infinite z-score, but we
  // handle it explicitly to avoid NaN/Infinity propagating through the system.
  if (std === 0) {
    return {
      isAnomaly: value !== mean,
      score: value !== mean ? Infinity : 0,
      reason: value > mean ? "spike_above_baseline" : value < mean ? "drop_below_baseline" : null,
    };
  }

  // Using absolute z-score because we care about outliers in both directions.
  // A mod suddenly going quiet is just as notable as one going hyperactive.
  const zScore = Math.abs((value - mean) / std);

  if (zScore > threshold) {
    return {
      isAnomaly: true,
      score: zScore,
      reason: value > mean ? "spike_in_total_actions" : "drop_in_total_actions",
    };
  }

  return { isAnomaly: false, score: zScore, reason: null };
}

/**
 * WHAT: Detect anomaly in moderator daily action counts
 * WHY: Compare moderator's recent activity to their historical baseline
 *
 * Uses a lower default threshold (2.5 vs 3.0) because mod activity tends to
 * be more variable than general population stats. 2.5 sigma catches ~99% of
 * normal distribution while being more sensitive to concerning patterns.
 *
 * Caveat: This is self-referential (comparing mod to their own history).
 * A consistently lazy mod won't trigger alerts. Cross-mod comparison would
 * need different approach - maybe percentile ranking within the team.
 *
 * @param dailyCounts - Array of daily action counts (e.g., last 7 days)
 * @param threshold - Z-score threshold
 * @returns Anomaly result for most recent day vs historical average
 */
export function detectModeratorAnomalies(dailyCounts: number[], threshold: number = 2.5): AnomalyResult {
  if (dailyCounts.length < 2) {
    return { isAnomaly: false, score: 0, reason: null };
  }

  // Compare most recent day to historical baseline (everything except latest)
  const mostRecent = dailyCounts[dailyCounts.length - 1];
  const historical = dailyCounts.slice(0, -1);

  return detectAnomaly(mostRecent, historical, threshold);
}
