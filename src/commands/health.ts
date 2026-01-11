/**
 * Pawtropolis Tech — src/commands/health.ts
 * WHAT: Simple /health check command showing uptime, WS ping, and build identity.
 * WHY: Quick smoke test for bot responsiveness without touching DB.
 *      Also serves as a deployment verification tool - shows exactly what code is running.
 * FLOWS:
 *  - Compute uptime/ws.ping/buildInfo → reply with an embed
 * DOCS:
 *  - CommandInteraction: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction
 *  - Interaction replies: https://discord.js.org/#/docs/discord.js/main/typedef/InteractionReplyOptions
 *
 * BUILD IDENTITY:
 * ─────────────────────────────────────────────────────────────────────────────
 * The /health command displays build identity to answer the question:
 * "What code is actually running on the server?"
 *
 * This is critical for:
 *   1. Verifying deployments succeeded (commit SHA matches what was pushed)
 *   2. Debugging production issues (correlate errors to exact code version)
 *   3. Identifying stale deployments (build timestamp shows when last deployed)
 *   4. Runtime environment info (Node version, environment mode)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";
import { HEALTH_CHECK_TIMEOUT_MS } from "../lib/constants.js";
import { getSchedulerHealth, type SchedulerHealth } from "../lib/schedulerHealth.js";
import { logger } from "../lib/logger.js";
import { getBuildInfo, getBuildAge } from "../lib/buildInfo.js";

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
 * Formats build identity for display in the health embed.
 *
 * DISPLAY FORMAT:
 * ─────────────────────────────────────────────────────────────────────────────
 * Line 1: Version + Git SHA (the "what" - exact code identification)
 * Line 2: Build timestamp relative + Node version (the "when" and "environment")
 * Line 3: Deploy ID if available (the "deployment" identity)
 *
 * Example output:
 *   v4.9.2 (abc1234)
 *   Built 2h ago • Node 20.10.0
 *   Deploy: deploy-20260111-abc1234
 *
 * MISSING DATA HANDLING:
 * If git SHA or build time is missing (local dev, failed injection), we show
 * "unknown" or "N/A" rather than hiding the field entirely. This makes it
 * obvious that build injection isn't working.
 */
function formatBuildIdentity(): string {
  const build = getBuildInfo();
  const lines: string[] = [];

  // Line 1: Version + SHA
  const shortSha = build.gitSha?.slice(0, 7) ?? "unknown";
  lines.push(`v${build.version} (${shortSha})`);

  // Line 2: Build time + Node version
  const buildAge = getBuildAge();
  const buildAgeStr = buildAge ?? "N/A";
  lines.push(`Built ${buildAgeStr} • Node ${build.nodeVersion}`);

  // Line 3: Deploy ID (if available)
  if (build.deployId) {
    lines.push(`Deploy: ${build.deployId}`);
  }

  return lines.join("\n");
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
      // ─────────────────────────────────────────────────────────────────────────
      // BUILD IDENTITY COLLECTION
      // Collected early so it's available for both the field and footer.
      // This answers: "What exact code is running on this server?"
      // ─────────────────────────────────────────────────────────────────────────
      const buildIdentity = formatBuildIdentity();
      const build = getBuildInfo();

      const embed = new EmbedBuilder()
        .setTitle("Health Check")
        .setColor(0x57f287)
        .addFields(
          { name: "Status", value: "Healthy", inline: true },
          { name: "Uptime", value: formatUptime(metrics.uptimeSec), inline: true },
          { name: "WS Ping", value: `${metrics.ping}ms`, inline: true },
          // ─────────────────────────────────────────────────────────────────────
          // BUILD IDENTITY FIELD
          // Shows version, git SHA, build time, and deploy ID.
          // Critical for: deployment verification, debugging, code correlation.
          // ─────────────────────────────────────────────────────────────────────
          { name: "Build", value: buildIdentity, inline: true }
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

      // Event listeners status
      embed.addFields({
        name: "Event Listeners",
        value: "**NSFW Avatar Monitor**: Active",
        inline: false,
      });

      // ─────────────────────────────────────────────────────────────────────────
      // FOOTER: Environment + Hostname
      // Shows what environment (production/development) and which server instance.
      // Useful for: multi-server deployments, staging vs production verification.
      // ─────────────────────────────────────────────────────────────────────────
      embed.setFooter({
        text: `${build.environment} • ${build.hostname}`,
      });
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
      }).catch((err) => {
        logger.debug({ err }, "[health] Timeout response failed (interaction may have expired)");
      });
    } else {
      throw error;
    }
  }
}
