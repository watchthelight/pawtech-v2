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

// 60 seconds feels frequent, but Discord rate limits are generous for read ops
// and we'd rather catch a dead WebSocket before users start complaining
const DEFAULT_INTERVAL_SECONDS = 60;

// Module-level state. Yes, singletons are frowned upon. No, I don't have
// a better idea for interval management that doesn't involve dependency injection hell.
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

  /*
   * GOTCHA: This comment says "all guilds" but we only check one.
   * The multi-guild dream died in a sprint planning meeting circa 2023.
   * If you're here to finally implement it, godspeed and update the function name.
   */
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
    // WHY err.message instead of err? Pino serializes Error objects weirdly,
    // and we've had production logs where the actual error was "[object Object]"
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
  // Opt-out for tests. Without this, vitest hangs forever waiting for
  // intervals to clear. Ask me how I know. (I wasted 2 hours debugging it.)
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

  /*
   * WHY the 10s delay? Discord.js needs a moment after ClientReady fires to
   * actually populate caches and establish a stable WS ping. Running health
   * checks at t=0 gives false positives like "oh no, ping is undefined!"
   */
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

  // unref() is the secret sauce. Without it, the process won't exit on SIGTERM
  // because Node thinks "hey, there's still work scheduled!" This is especially
  // fun to debug when PM2 force-kills your bot after 15 seconds of polite waiting.
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
  // This null check matters more than you'd think. During hot reload in dev,
  // this can get called multiple times. The interval clears fine, but logging
  // "scheduler stopped" twice in a row makes you paranoid something's wrong.
  if (_activeInterval) {
    clearInterval(_activeInterval);
    _activeInterval = null;
    logger.info("[opshealth:scheduler] scheduler stopped");
  }
}
