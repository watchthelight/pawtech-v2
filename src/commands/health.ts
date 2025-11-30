/**
 * Pawtropolis Tech — src/commands/health.ts
 * WHAT: Simple /health check command showing uptime and WS ping.
 * WHY: Quick smoke test for bot responsiveness without touching DB.
 * FLOWS:
 *  - Compute uptime/ws.ping → reply with an embed
 * DOCS:
 *  - CommandInteraction: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction
 *  - Interaction replies: https://discord.js.org/#/docs/discord.js/main/typedef/InteractionReplyOptions
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";
import { HEALTH_CHECK_TIMEOUT_MS } from "../lib/constants.js";
import { getSchedulerHealth, type SchedulerHealth } from "../lib/schedulerHealth.js";

/*
 * Health Check Command
 * --------------------
 * The simplest possible command - no database, no external calls, just process
 * uptime and WebSocket latency. Useful for:
 *
 *   1. Verifying the bot is responsive (not stuck in an event loop block)
 *   2. Checking WS connection quality to Discord's gateway
 *   3. Quick "is it up?" check without needing server access
 *
 * LATENCY NOTE: client.ws.ping is the heartbeat ACK latency to Discord's gateway,
 * not HTTP API latency. A healthy connection should be under 200ms. If you see
 * values consistently above 500ms, check your hosting region relative to Discord's
 * gateway servers.
 *
 * NO PERMISSIONS REQUIRED: Anyone can run /health. It exposes nothing sensitive.
 */

export const data = new SlashCommandBuilder()
  .setName("health")
  .setDescription("Bot health (uptime and latency).");

/**
 * Formats uptime for human consumption. The "|| parts.length === 0" check
 * ensures we always show at least "0s" for freshly-started bots rather than
 * returning an empty string.
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}

/**
 * Formats a timestamp as relative time (e.g., "2m ago", "1h ago").
 * Returns "never" if timestamp is null.
 */
function formatRelativeTime(timestamp: number | null): string {
  if (timestamp === null) return "never";

  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

/**
 * Formats scheduler health for display in the embed.
 * Shows status indicator, last run time, and failure info if any.
 */
function formatSchedulerStatus(health: SchedulerHealth): string {
  const statusIcon = health.consecutiveFailures === 0 ? "OK" : `WARN (${health.consecutiveFailures} failures)`;
  const lastRun = formatRelativeTime(health.lastRunAt);
  return `${statusIcon} - Last: ${lastRun}`;
}

/**
 * execute
 * WHAT: Replies with a small embed indicating status, uptime, and ping.
 * RETURNS: Promise<void>
 * THROWS: Never; errors would be caught by wrapCommand upstream.
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  const healthCheckPromise = (async () => {
    const metrics = await withStep(ctx, "collect_metrics", async () => ({
      uptimeSec: Math.floor(process.uptime()),
      ping: Math.round(interaction.client.ws.ping),
    }));

    // Collect scheduler health data
    const schedulerHealthMap = getSchedulerHealth();

    await withStep(ctx, "reply", async () => {
      const embed = new EmbedBuilder()
        .setTitle("Health Check")
        .setColor(0x57f287)
        .addFields(
          { name: "Status", value: "Healthy", inline: true },
          { name: "Uptime", value: formatUptime(metrics.uptimeSec), inline: true },
          { name: "WS Ping", value: `${metrics.ping}ms`, inline: true }
        );

      // Add scheduler status fields if any schedulers are tracked
      if (schedulerHealthMap.size > 0) {
        const schedulerLines = Array.from(schedulerHealthMap.entries()).map(
          ([name, health]) => `**${name}**: ${formatSchedulerStatus(health)}`
        );
        embed.addFields({
          name: "Schedulers",
          value: schedulerLines.join("\n"),
          inline: false,
        });
      }

      embed.setTimestamp();

      // Public by default (team status check), ephemeral only on timeout
      // Single message path; no need to defer. Keep within 3s SLA.
      await interaction.reply({ embeds: [embed] });
    });
  })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Health check timeout')), HEALTH_CHECK_TIMEOUT_MS);
  });

  try {
    await Promise.race([healthCheckPromise, timeoutPromise]);
  } catch (error) {
    if (error instanceof Error && error.message === 'Health check timeout') {
      await interaction.reply({
        content: '⚠️ Health check timed out after 5 seconds.',
        ephemeral: true,
      }).catch(() => {});
    } else {
      throw error;
    }
  }
}
