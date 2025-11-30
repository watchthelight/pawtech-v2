/**
 * Pawtropolis Tech — src/lib/schedulerHealth.ts
 * WHAT: Health tracking utility for scheduled background tasks.
 * WHY: Enables monitoring of scheduler failures, consecutive error tracking,
 *      and alerting when schedulers consistently fail.
 * FLOWS:
 *  - recordSchedulerRun(name, success) → update health state → alert if threshold exceeded
 *  - getSchedulerHealth() → return all scheduler health states
 *  - getSchedulerHealthByName(name) → return single scheduler health
 * DOCS:
 *  - Issue #85: Add Health Monitoring for Scheduler Failures
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { logger } from "./logger.js";

/**
 * Health state for a single scheduler.
 */
export interface SchedulerHealth {
  /** Scheduler name (e.g., "modMetrics", "opsHealth", "staleApplicationCheck") */
  name: string;
  /** Timestamp of last run attempt (success or failure), null if never run */
  lastRunAt: number | null;
  /** Timestamp of last successful run, null if never succeeded */
  lastSuccessAt: number | null;
  /** Timestamp of last failed run, null if never failed */
  lastErrorAt: number | null;
  /** Count of consecutive failures since last success */
  consecutiveFailures: number;
  /** Total number of run attempts */
  totalRuns: number;
  /** Total number of failed runs */
  totalFailures: number;
}

/** Threshold of consecutive failures before emitting an alert log */
const CONSECUTIVE_FAILURE_ALERT_THRESHOLD = 3;

/** Internal storage for scheduler health states */
const schedulerHealth = new Map<string, SchedulerHealth>();

/**
 * WHAT: Record a scheduler run result (success or failure).
 * WHY: Updates health tracking and alerts if consecutive failures exceed threshold.
 *
 * @param name - Scheduler name (e.g., "modMetrics")
 * @param success - Whether the run succeeded
 *
 * @example
 * try {
 *   await doScheduledWork();
 *   recordSchedulerRun("myScheduler", true);
 * } catch (err) {
 *   recordSchedulerRun("myScheduler", false);
 *   logger.error({ err }, "[myScheduler] failed");
 * }
 */
export function recordSchedulerRun(name: string, success: boolean): void {
  const now = Date.now();

  const existing = schedulerHealth.get(name);
  const health: SchedulerHealth = existing ?? {
    name,
    lastRunAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    totalRuns: 0,
    totalFailures: 0,
  };

  health.lastRunAt = now;
  health.totalRuns++;

  if (success) {
    health.lastSuccessAt = now;
    health.consecutiveFailures = 0;
  } else {
    health.lastErrorAt = now;
    health.consecutiveFailures++;
    health.totalFailures++;
  }

  schedulerHealth.set(name, health);

  // Alert if consecutive failures exceed threshold
  if (health.consecutiveFailures >= CONSECUTIVE_FAILURE_ALERT_THRESHOLD) {
    logger.error(
      {
        scheduler: name,
        consecutiveFailures: health.consecutiveFailures,
        totalFailures: health.totalFailures,
        totalRuns: health.totalRuns,
      },
      "[scheduler] Multiple consecutive failures - requires attention"
    );
  }
}

/**
 * WHAT: Get health states for all schedulers.
 * WHY: Allows admin commands to display scheduler health overview.
 *
 * @returns Map of scheduler names to their health states
 *
 * @example
 * const health = getSchedulerHealth();
 * for (const [name, state] of health) {
 *   console.log(`${name}: ${state.consecutiveFailures} consecutive failures`);
 * }
 */
export function getSchedulerHealth(): Map<string, SchedulerHealth> {
  return new Map(schedulerHealth);
}

/**
 * WHAT: Get health state for a specific scheduler.
 * WHY: Allows querying individual scheduler status.
 *
 * @param name - Scheduler name
 * @returns Health state or undefined if scheduler not tracked
 *
 * @example
 * const modMetricsHealth = getSchedulerHealthByName("modMetrics");
 * if (modMetricsHealth?.consecutiveFailures > 0) {
 *   // Handle degraded state
 * }
 */
export function getSchedulerHealthByName(name: string): SchedulerHealth | undefined {
  const health = schedulerHealth.get(name);
  return health ? { ...health } : undefined;
}

/**
 * WHAT: Reset health state for a scheduler.
 * WHY: Allows clearing state after manual intervention or for testing.
 *
 * @param name - Scheduler name to reset
 *
 * @example
 * // After fixing an issue, reset the scheduler's failure count
 * resetSchedulerHealth("modMetrics");
 */
export function resetSchedulerHealth(name: string): void {
  schedulerHealth.delete(name);
  logger.info({ scheduler: name }, "[scheduler] Health state reset");
}

/**
 * WHAT: Clear all scheduler health state.
 * WHY: Primarily for testing - allows clean slate between tests.
 * NOTE: Not exported by default - use with caution.
 */
export function _clearAllSchedulerHealth(): void {
  schedulerHealth.clear();
}
