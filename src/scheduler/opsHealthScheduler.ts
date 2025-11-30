/**
 * Pawtropolis Tech — src/scheduler/opsHealthScheduler.ts
 * WHAT: Periodic scheduler for automated operations health checks
 * WHY: Continuously monitor bot health and trigger alerts when thresholds crossed
 * FLOWS:
 *  - Every N seconds (default 60) → runCheck(guildId) → evaluate alerts
 *  - Logs check success/failure
 * DOCS:
 *  - setInterval: https://nodejs.org/api/timers.html#setinterval
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Client } from "discord.js";
import { runCheck } from "../features/opsHealth.js";
import { logger } from "../lib/logger.js";
import { env } from "../lib/env.js";
import { recordSchedulerRun } from "../lib/schedulerHealth.js";

const DEFAULT_INTERVAL_SECONDS = 60;

let _activeInterval: NodeJS.Timeout | null = null;

/**
 * WHAT: Run health check for all guilds the bot is in.
 * WHY: Automated monitoring across all guilds.
 *
 * @param client - Discord.js client instance
 * @returns Number of guilds processed
 */
async function runHealthCheckForAllGuilds(client: Client): Promise<number> {
  let processedCount = 0;
  let errorCount = 0;

  // For simplicity, check primary guild only (can extend to all guilds)
  const guildId = env.GUILD_ID;
  if (!guildId) {
    logger.warn("[opshealth:scheduler] GUILD_ID not configured, skipping health check");
    return 0;
  }

  try {
    const result = await runCheck(guildId, client);
    logger.debug(
      {
        guildId,
        triggeredAlertsCount: result.triggeredAlerts.length,
        backlog: result.summary.queue.backlog,
        wsPingMs: result.summary.wsPingMs,
      },
      "[opshealth:scheduler] health check completed"
    );
    processedCount++;
  } catch (err: any) {
    logger.error({ err: err.message, guildId }, "[opshealth:scheduler] health check failed");
    errorCount++;
  }

  if (processedCount > 0 || errorCount > 0) {
    logger.info(
      { processedCount, errorCount },
      "[opshealth:scheduler] batch health check completed"
    );
  }

  return processedCount;
}

/**
 * WHAT: Start periodic health check scheduler.
 * WHY: Automatically monitor health and trigger alerts.
 *
 * @param client - Discord.js client instance
 *
 * @example
 * // In src/index.ts ClientReady event:
 * import { startOpsHealthScheduler } from './scheduler/opsHealthScheduler.js';
 * startOpsHealthScheduler(client);
 *
 * // Graceful shutdown:
 * import { stopOpsHealthScheduler } from './scheduler/opsHealthScheduler.js';
 * process.on('SIGTERM', () => {
 *   stopOpsHealthScheduler();
 * });
 */
export function startOpsHealthScheduler(client: Client): void {
  // Opt-out for tests or when disabled
  if (process.env.OPS_HEALTH_SCHEDULER_DISABLED === "1") {
    logger.debug("[opshealth:scheduler] scheduler disabled via env flag");
    return;
  }

  const intervalSeconds =
    parseInt(process.env.HEALTH_CHECK_INTERVAL_SECONDS || "", 10) || DEFAULT_INTERVAL_SECONDS;
  const intervalMs = intervalSeconds * 1000;

  logger.info(
    { intervalSeconds },
    "[opshealth:scheduler] starting health check scheduler"
  );

  // Run initial check immediately on startup (after short delay to let bot stabilize)
  setTimeout(async () => {
    try {
      await runHealthCheckForAllGuilds(client);
      recordSchedulerRun("opsHealth", true);
    } catch (err: any) {
      recordSchedulerRun("opsHealth", false);
      logger.error({ err: err.message }, "[opshealth:scheduler] initial check failed");
    }
  }, 10000); // 10s delay

  // Set up periodic refresh
  const interval = setInterval(async () => {
    try {
      await runHealthCheckForAllGuilds(client);
      recordSchedulerRun("opsHealth", true);
    } catch (err: any) {
      recordSchedulerRun("opsHealth", false);
      logger.error({ err: err.message }, "[opshealth:scheduler] scheduled check failed");
    }
  }, intervalMs);

  // Prevent interval from keeping process alive during shutdown
  interval.unref();

  _activeInterval = interval;
}

/**
 * WHAT: Stop the health check scheduler.
 * WHY: Clean shutdown during bot termination.
 *
 * @example
 * import { stopOpsHealthScheduler } from './scheduler/opsHealthScheduler.js';
 * process.on('SIGTERM', () => {
 *   stopOpsHealthScheduler();
 * });
 */
export function stopOpsHealthScheduler(): void {
  if (_activeInterval) {
    clearInterval(_activeInterval);
    _activeInterval = null;
    logger.info("[opshealth:scheduler] scheduler stopped");
  }
}
