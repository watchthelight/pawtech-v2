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
 */
function computeStats(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

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
  // Not enough data for comparison
  if (population.length < 3) {
    return { isAnomaly: false, score: 0, reason: null };
  }

  const { mean, std } = computeStats(population);

  // Zero variance - all values identical
  if (std === 0) {
    return {
      isAnomaly: value !== mean,
      score: value !== mean ? Infinity : 0,
      reason: value > mean ? "spike_above_baseline" : value < mean ? "drop_below_baseline" : null,
    };
  }

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
 * @param recentDailyCounts - Array of daily action counts (e.g., last 7 days)
 * @param threshold - Z-score threshold
 * @returns Anomaly result for most recent day vs historical average
 */
export function detectModeratorAnomalies(dailyCounts: number[], threshold: number = 2.5): AnomalyResult {
  if (dailyCounts.length < 2) {
    return { isAnomaly: false, score: 0, reason: null };
  }

  // Compare most recent day to historical baseline
  const mostRecent = dailyCounts[dailyCounts.length - 1];
  const historical = dailyCounts.slice(0, -1);

  return detectAnomaly(mostRecent, historical, threshold);
}
