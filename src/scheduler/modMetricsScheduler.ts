/**
 * Pawtropolis Tech — src/scheduler/modMetricsScheduler.ts
 * WHAT: Periodic scheduler for moderator metrics recalculation.
 * WHY: Keep mod_metrics table fresh without manual triggers.
 * FLOWS:
 *  - Every 15 minutes → recalcModMetrics(guildId) for all guilds
 *  - Logs refresh success/failure
 * DOCS:
 *  - setInterval: https://nodejs.org/api/timers.html#setinterval
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Client } from "discord.js";
import { recalcModMetrics } from "../features/modPerformance.js";
import { logger } from "../lib/logger.js";

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

let _activeInterval: NodeJS.Timeout | null = null;

/**
 * WHAT: Refresh metrics for all guilds the bot is in.
 * WHY: Periodic background task to keep performance data current.
 *
 * @param client - Discord.js client instance
 * @returns Number of guilds processed
 */
async function refreshAllGuildMetrics(client: Client): Promise<number> {
  let processedCount = 0;
  let errorCount = 0;

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const updatedMods = await recalcModMetrics(guildId);
      logger.debug(
        { guildId, guildName: guild.name, updatedMods },
        "[metrics] refreshed successfully"
      );
      processedCount++;
    } catch (err) {
      logger.error({ err, guildId, guildName: guild.name }, "[metrics] refresh failed");
      errorCount++;
    }
  }

  logger.info(
    { processedCount, errorCount, totalGuilds: client.guilds.cache.size },
    "[metrics] batch refresh completed"
  );

  return processedCount;
}

/**
 * WHAT: Start periodic metrics refresh scheduler.
 * WHY: Automatically keep mod_metrics table up-to-date.
 *
 * @param client - Discord.js client instance
 * @returns Interval timer for cleanup
 *
 * @example
 * // In src/index.ts ClientReady event:
 * import { startModMetricsScheduler } from './scheduler/modMetricsScheduler.js';
 * const schedulerInterval = startModMetricsScheduler(client);
 *
 * // Graceful shutdown:
 * process.on('SIGTERM', () => {
 *   clearInterval(schedulerInterval);
 * });
 */
export function startModMetricsScheduler(client: Client): NodeJS.Timeout | null {
  // Opt-out for tests
  if (process.env.METRICS_SCHEDULER_DISABLED === "1") {
    logger.debug("[metrics] scheduler disabled via env flag");
    return null;
  }

  logger.info({ intervalMinutes: REFRESH_INTERVAL_MS / 60000 }, "[metrics] scheduler starting");

  // Run initial refresh immediately on startup
  refreshAllGuildMetrics(client).catch((err) => {
    logger.error({ err }, "[metrics] initial refresh failed");
  });

  // Set up periodic refresh
  const interval = setInterval(() => {
    refreshAllGuildMetrics(client).catch((err) => {
      logger.error({ err }, "[metrics] scheduled refresh failed");
    });
  }, REFRESH_INTERVAL_MS);

  // Prevent interval from keeping process alive during shutdown
  interval.unref();

  _activeInterval = interval;
  return interval;
}

/**
 * WHAT: Stop the metrics refresh scheduler.
 * WHY: Clean shutdown during bot termination.
 *
 * @param interval - Interval timer returned by startModMetricsScheduler
 *
 * @example
 * const schedulerInterval = startModMetricsScheduler(client);
 * process.on('SIGTERM', () => {
 *   stopModMetricsScheduler(schedulerInterval);
 * });
 */
export function stopModMetricsScheduler(interval: NodeJS.Timeout | null): void {
  if (interval) {
    clearInterval(interval);
    logger.info("[metrics] scheduler stopped");
  }
  if (_activeInterval) {
    clearInterval(_activeInterval);
    _activeInterval = null;
  }
}

/**
 * WHAT: Stop scheduler (test-only).
 * WHY: Ensure test isolation without background intervals.
 */
export function __test__stopScheduler(): void {
  if (_activeInterval) {
    clearInterval(_activeInterval);
    _activeInterval = null;
  }
}
