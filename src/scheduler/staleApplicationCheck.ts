/**
 * Pawtropolis Tech — src/scheduler/staleApplicationCheck.ts
 * WHAT: Periodic scheduler for alerting Gatekeepers about unclaimed applications.
 * WHY: Ensure applications don't languish unreviewed for more than 24 hours.
 * FLOWS:
 *  - Every 30 minutes → checkStaleApplications() for all guilds
 *  - Groups stale apps by guild → sends one alert per guild
 *  - Marks apps as alerted to prevent spam
 * DOCS:
 *  - setInterval: https://nodejs.org/api/timers.html#setinterval
 *  - Discord.js TextChannel: https://discord.js.org/#/docs/discord.js/main/class/TextChannel
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Client, TextChannel } from "discord.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { shortCode } from "../lib/ids.js";
import { recordSchedulerRun } from "../lib/schedulerHealth.js";

const STALE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const STALE_THRESHOLD_HOURS = 24;
const MAX_APPS_PER_ALERT = 10;

let _activeInterval: NodeJS.Timeout | null = null;

/**
 * StaleApplication type for query results
 */
type StaleApplication = {
  id: string;
  user_id: string;
  submitted_at: string;
  guild_id: string;
  review_channel_id: string | null;
  gatekeeper_role_id: string | null;
  card_channel_id: string | null;
  card_message_id: string | null;
};

/**
 * WHAT: Query for stale applications across all guilds.
 * WHY: Find applications that have been waiting 24+ hours without being claimed.
 * RETURNS: Array of stale applications with guild config info
 */
function getStaleApplications(): StaleApplication[] {
  const cutoffSeconds = Math.floor(Date.now() / 1000) - (STALE_THRESHOLD_HOURS * 60 * 60);

  // Query for applications that:
  // 1. Status is 'submitted' (pending)
  // 2. Not currently claimed (no row in review_claim)
  // 3. Submitted more than 24 hours ago
  // 4. No alert has been sent yet (stale_alert_sent = 0)
  const stmt = db.prepare(`
    SELECT
      a.id,
      a.user_id,
      a.submitted_at,
      a.guild_id,
      g.review_channel_id,
      g.gatekeeper_role_id,
      rc2.channel_id AS card_channel_id,
      rc2.message_id AS card_message_id
    FROM application a
    JOIN guild_config g ON g.guild_id = a.guild_id
    LEFT JOIN review_claim rc ON rc.app_id = a.id
    LEFT JOIN review_card rc2 ON rc2.app_id = a.id
    WHERE a.status = 'submitted'
      AND rc.app_id IS NULL
      AND a.stale_alert_sent = 0
      AND a.submitted_at < datetime(?, 'unixepoch')
  `);

  return stmt.all(cutoffSeconds) as StaleApplication[];
}

/**
 * WHAT: Mark an application as having had its stale alert sent.
 * WHY: Prevent duplicate alerts for the same application.
 * @param appId - The application ID to mark
 */
function markAlertSent(appId: string): void {
  db.prepare(`
    UPDATE application
    SET stale_alert_sent = 1,
        stale_alert_sent_at = datetime('now')
    WHERE id = ?
  `).run(appId);
}

/**
 * WHAT: Calculate hours since submission.
 * WHY: Display human-readable time in alert message.
 * @param submittedAt - ISO8601 timestamp string
 * @returns Number of hours since submission
 */
function getHoursSinceSubmission(submittedAt: string): number {
  const submittedDate = new Date(submittedAt);
  const now = new Date();
  const diffMs = now.getTime() - submittedDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60));
}

/**
 * WHAT: Generate application code from ID for display.
 * WHY: Users see short codes like #ABC123, not UUIDs.
 * @param appId - Full application ID
 * @returns Short code (DJB2 hash-based, 6 hex chars)
 */
function getAppCode(appId: string): string {
  return shortCode(appId);
}

/**
 * WHAT: Build a Discord message link for an application's review card.
 * WHY: Allow Gatekeepers to click directly to the review card.
 * @param guildId - Guild ID
 * @param channelId - Channel ID where review card is posted
 * @param messageId - Message ID of review card
 * @returns Discord message URL or null if missing info
 */
function getReviewCardLink(guildId: string, channelId: string | null, messageId: string | null): string | null {
  if (!channelId || !messageId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/**
 * WHAT: Build the alert message for a guild's stale applications.
 * WHY: Format matches the spec in the plan document.
 * @param gatekeeperRoleId - Role ID to ping (can be null)
 * @param staleApps - Array of stale applications for this guild
 * @returns Formatted message string
 */
function buildAlertMessage(
  gatekeeperRoleId: string | null,
  staleApps: StaleApplication[]
): string {
  const rolePrefix = gatekeeperRoleId ? `<@&${gatekeeperRoleId}>` : "@Gatekeeper";

  const appLines = staleApps.slice(0, MAX_APPS_PER_ALERT).map((app) => {
    const code = getAppCode(app.id);
    const hours = getHoursSinceSubmission(app.submitted_at);
    const link = getReviewCardLink(app.guild_id, app.card_channel_id, app.card_message_id);
    const linkText = link ? ` • [View Card](${link})` : "";
    return `- #${code} from <@${app.user_id}> - Submitted ${hours} hours ago${linkText}`;
  });

  const moreCount = staleApps.length - MAX_APPS_PER_ALERT;
  if (moreCount > 0) {
    appLines.push(`- ...and ${moreCount} more`);
  }

  return [
    rolePrefix,
    "",
    "**Application Pending 24+ Hours**",
    "",
    "The following application(s) have been waiting for review:",
    "",
    ...appLines,
    "",
    "Please claim and review these applications.",
  ].join("\n");
}

/**
 * WHAT: Send alert to a guild's review channel and mark apps as alerted.
 * WHY: Notify Gatekeepers and prevent duplicate alerts.
 * @param client - Discord.js client instance
 * @param guildId - Guild ID
 * @param reviewChannelId - Channel ID to send alert to
 * @param gatekeeperRoleId - Role ID to ping
 * @param staleApps - Array of stale applications for this guild
 */
async function sendAlertForGuild(
  client: Client,
  guildId: string,
  reviewChannelId: string | null,
  gatekeeperRoleId: string | null,
  staleApps: StaleApplication[]
): Promise<void> {
  if (!reviewChannelId) {
    logger.warn(
      { guildId, appCount: staleApps.length },
      "[stale-alert] No review_channel_id configured, skipping alert"
    );
    // Still mark as alerted to prevent repeated warnings
    for (const app of staleApps) {
      markAlertSent(app.id);
    }
    return;
  }

  try {
    const channel = await client.channels.fetch(reviewChannelId).catch(() => null);
    if (!channel) {
      logger.warn({ reviewChannelId, guildId }, "[stale-alert] Review channel not accessible, skipping guild");
      return;
    }
    if (!channel.isTextBased()) {
      logger.error(
        { guildId, reviewChannelId },
        "[stale-alert] Review channel not text-based"
      );
      return;
    }

    const message = buildAlertMessage(gatekeeperRoleId, staleApps);

    await (channel as TextChannel).send({
      content: message,
      allowedMentions: {
        roles: gatekeeperRoleId ? [gatekeeperRoleId] : [],
        users: [] // Don't actually ping the applicants
      }
    });

    // Mark all applications as alerted
    for (const app of staleApps) {
      markAlertSent(app.id);
    }

    logger.info(
      {
        guildId,
        reviewChannelId,
        appCount: staleApps.length,
        appIds: staleApps.map(a => a.id)
      },
      "[stale-alert] Alert sent successfully"
    );
  } catch (err) {
    logger.error(
      { err, guildId, reviewChannelId },
      "[stale-alert] Failed to send alert"
    );
  }
}

/**
 * WHAT: Check for stale applications and send alerts.
 * WHY: Main entry point for the scheduler, groups by guild.
 * @param client - Discord.js client instance
 * @returns Number of guilds alerted
 */
async function checkStaleApplications(client: Client): Promise<number> {
  const staleApps = getStaleApplications();

  if (staleApps.length === 0) {
    logger.debug("[stale-alert] No stale applications found");
    return 0;
  }

  logger.info(
    { totalStaleApps: staleApps.length },
    "[stale-alert] Found stale applications"
  );

  // Group applications by guild
  const byGuild = new Map<string, StaleApplication[]>();
  for (const app of staleApps) {
    const existing = byGuild.get(app.guild_id) || [];
    existing.push(app);
    byGuild.set(app.guild_id, existing);
  }

  let alertedGuildCount = 0;

  // Send one alert per guild
  for (const [guildId, guildApps] of byGuild) {
    // All apps in a guild have the same channel/role config, so use first
    const { review_channel_id, gatekeeper_role_id } = guildApps[0];

    await sendAlertForGuild(
      client,
      guildId,
      review_channel_id,
      gatekeeper_role_id,
      guildApps
    );

    alertedGuildCount++;
  }

  logger.info(
    { alertedGuildCount, totalStaleApps: staleApps.length },
    "[stale-alert] Stale application check completed"
  );

  return alertedGuildCount;
}

/**
 * WHAT: Start the stale application check scheduler.
 * WHY: Automatically alert Gatekeepers about unclaimed applications.
 *
 * @param client - Discord.js client instance
 *
 * @example
 * // In src/index.ts ClientReady event:
 * import { startStaleApplicationScheduler } from './scheduler/staleApplicationCheck.js';
 * startStaleApplicationScheduler(client);
 *
 * // Graceful shutdown:
 * import { stopStaleApplicationScheduler } from './scheduler/staleApplicationCheck.js';
 * process.on('SIGTERM', () => {
 *   stopStaleApplicationScheduler();
 * });
 */
export function startStaleApplicationScheduler(client: Client): void {
  // Opt-out for tests
  if (process.env.STALE_APP_SCHEDULER_DISABLED === "1") {
    logger.debug("[stale-alert] scheduler disabled via env flag");
    return;
  }

  logger.info(
    { intervalMinutes: STALE_CHECK_INTERVAL_MS / 60000, thresholdHours: STALE_THRESHOLD_HOURS },
    "[stale-alert] scheduler starting"
  );

  // Run initial check after a short delay to let bot stabilize
  setTimeout(async () => {
    try {
      await checkStaleApplications(client);
      recordSchedulerRun("staleApplicationCheck", true);
    } catch (err) {
      recordSchedulerRun("staleApplicationCheck", false);
      logger.error({ err }, "[stale-alert] initial check failed");
    }
  }, 15000); // 15s delay

  // Set up periodic check
  const interval = setInterval(async () => {
    try {
      await checkStaleApplications(client);
      recordSchedulerRun("staleApplicationCheck", true);
    } catch (err) {
      recordSchedulerRun("staleApplicationCheck", false);
      logger.error({ err }, "[stale-alert] scheduled check failed");
    }
  }, STALE_CHECK_INTERVAL_MS);

  // Prevent interval from keeping process alive during shutdown
  interval.unref();

  _activeInterval = interval;
}

/**
 * WHAT: Stop the stale application check scheduler.
 * WHY: Clean shutdown during bot termination.
 *
 * @example
 * import { stopStaleApplicationScheduler } from './scheduler/staleApplicationCheck.js';
 * process.on('SIGTERM', () => {
 *   stopStaleApplicationScheduler();
 * });
 */
export function stopStaleApplicationScheduler(): void {
  if (_activeInterval) {
    clearInterval(_activeInterval);
    _activeInterval = null;
    logger.info("[stale-alert] scheduler stopped");
  }
}
