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

export const data = new SlashCommandBuilder()
  .setName("health")
  .setDescription("Bot health (uptime and latency).");

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
 * execute
 * WHAT: Replies with a small embed indicating status, uptime, and ping.
 * RETURNS: Promise<void>
 * THROWS: Never; errors would be caught by wrapCommand upstream.
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const metrics = await withStep(ctx, "collect_metrics", async () => ({
    uptimeSec: Math.floor(process.uptime()),
    ping: Math.round(interaction.client.ws.ping),
  }));

  await withStep(ctx, "reply", async () => {
    const embed = new EmbedBuilder()
      .setTitle("Health Check")
      .setColor(0x57f287)
      .addFields(
        { name: "Status", value: "Healthy", inline: true },
        { name: "Uptime", value: formatUptime(metrics.uptimeSec), inline: true },
        { name: "WS Ping", value: `${metrics.ping}ms`, inline: true }
      )
      .setTimestamp();

    // Single message path; no need to defer. Keep within 3s SLA.
    await interaction.reply({ embeds: [embed] });
  });
}
