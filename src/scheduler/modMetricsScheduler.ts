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
import { recordSchedulerRun } from "../lib/schedulerHealth.js";

// WHY 15 minutes? It's a Goldilocks number. 5 min would be too aggressive
// (these recalcs touch a lot of rows), 30 min means stale leaderboards.
// Also, 15 min intervals mean the scheduler fires at :00, :15, :30, :45
// which is predictable for debugging. "When did metrics last update?" -> "Quarter past."
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

  // GOTCHA: client.guilds.cache is populated lazily. If the bot just started
  // and hasn't received GUILD_CREATE events yet, this loop might be empty.
  // The initial setTimeout in startModMetricsScheduler() helps, but edge cases exist.
  // Not a big deal - next interval will catch everything.
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
 *
 * @example
 * // In src/index.ts ClientReady event:
 * import { startModMetricsScheduler } from './scheduler/modMetricsScheduler.js';
 * startModMetricsScheduler(client);
 *
 * // Graceful shutdown:
 * import { stopModMetricsScheduler } from './scheduler/modMetricsScheduler.js';
 * process.on('SIGTERM', () => {
 *   stopModMetricsScheduler();
 * });
 */
export function startModMetricsScheduler(client: Client): void {
  // Opt-out for tests
  if (process.env.METRICS_SCHEDULER_DISABLED === "1") {
    logger.debug("[metrics] scheduler disabled via env flag");
    return;
  }

  logger.info({ intervalMinutes: REFRESH_INTERVAL_MS / 60000 }, "[metrics] scheduler starting");

  // Run initial refresh immediately on startup
  refreshAllGuildMetrics(client)
    .then(() => {
      recordSchedulerRun("modMetrics", true);
    })
    .catch((err) => {
      recordSchedulerRun("modMetrics", false);
      logger.error({ err }, "[metrics] initial refresh failed");
    });

  // Set up periodic refresh
  const interval = setInterval(async () => {
    try {
      await refreshAllGuildMetrics(client);
      recordSchedulerRun("modMetrics", true);
    } catch (err) {
      recordSchedulerRun("modMetrics", false);
      logger.error({ err }, "[metrics] scheduled refresh failed");
    }
  }, REFRESH_INTERVAL_MS);

  // Prevent interval from keeping process alive during shutdown
  interval.unref();

  _activeInterval = interval;
}

/**
 * WHAT: Stop the metrics refresh scheduler.
 * WHY: Clean shutdown during bot termination.
 *
 * @example
 * import { stopModMetricsScheduler } from './scheduler/modMetricsScheduler.js';
 * process.on('SIGTERM', () => {
 *   stopModMetricsScheduler();
 * });
 */
export function stopModMetricsScheduler(): void {
  if (_activeInterval) {
    clearInterval(_activeInterval);
    _activeInterval = null;
    logger.info("[metrics] scheduler stopped");
  }
}
