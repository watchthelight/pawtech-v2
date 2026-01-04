/**
 * Pawtropolis Tech -- src/commands/stats/activity.ts
 * WHAT: Handler for /stats activity - server activity heatmap.
 * WHY: Provides visual insight into server activity patterns over time.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  AttachmentBuilder,
  EmbedBuilder,
  withStep,
  requireMinRole,
  ROLE_IDS,
  classifyError,
  userFriendlyMessage,
  logger,
  type CommandContext,
} from "./shared.js";
import { fetchActivityData, generateHeatmap } from "../../lib/activityHeatmap.js";

/**
 * Handle /stats activity subcommand.
 * Generates multi-week activity heatmap with trends analysis.
 */
export async function handleActivity(
  ctx: CommandContext<ChatInputCommandInteraction>
): Promise<void> {
  const { interaction } = ctx;
  const { guildId } = interaction;

  if (!guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Require Senior Moderator+
  if (!requireMinRole(interaction, ROLE_IDS.SENIOR_MOD, {
    command: "stats activity",
    description: "Views server activity heatmap with trends analysis.",
    requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.SENIOR_MOD }],
  })) return;

  const weeks = interaction.options.getInteger("weeks", false) || 1;

  await interaction.deferReply({ ephemeral: false });

  try {
    const data = await withStep(ctx, "fetch_activity", async () => {
      return fetchActivityData(guildId, weeks);
    });

    const buffer = await withStep(ctx, "generate_heatmap", async () => {
      return generateHeatmap(data);
    });

    await withStep(ctx, "reply", async () => {
      const attachment = new AttachmentBuilder(buffer, {
        name: "activity-heatmap.png",
      });

      const totalMessages = data.trends.totalMessages;
      const weekText = weeks === 1 ? "7 days" : `${weeks} weeks`;

      const embed = new EmbedBuilder()
        .setTitle("Server Activity Report")
        .setDescription(`Activity heatmap for the past ${weekText} (UTC)`)
        .setImage("attachment://activity-heatmap.png")
        .setColor(0x2ecc71)
        .setTimestamp();

      embed.addFields(
        { name: "Total Messages", value: totalMessages.toLocaleString(), inline: true },
        { name: "Avg Messages per Hour", value: data.trends.avgMessagesPerHour.toFixed(1), inline: true },
        { name: "\u200b", value: "\u200b", inline: true },
        { name: "Busiest Hours", value: data.trends.busiestHours, inline: true },
        { name: "Least Active Hours", value: data.trends.leastActiveHours, inline: true },
        { name: "\u200b", value: "\u200b", inline: true },
        { name: "Peak Days", value: data.trends.peakDays.join(", "), inline: true },
        { name: "Quietest Days", value: data.trends.quietestDays.join(", "), inline: true }
      );

      if (data.trends.weekOverWeekGrowth !== undefined) {
        const growth = data.trends.weekOverWeekGrowth;
        const growthStr = growth > 0 ? `+${growth.toFixed(1)}%` : `${growth.toFixed(1)}%`;
        const emoji = growth > 0 ? "\u{1F4C8}" : growth < 0 ? "\u{1F4C9}" : "\u2501";
        embed.addFields({ name: "Week-over-Week", value: `${emoji} ${growthStr}`, inline: true });
      }

      await interaction.editReply({
        embeds: [embed],
        files: [attachment],
      });
    });
  } catch (error) {
    const classified = classifyError(error);
    logger.error({ error: classified, guildId }, "[stats:activity] Failed to generate heatmap");

    const message = userFriendlyMessage(classified);

    await interaction.editReply({
      content: `Error generating activity heatmap: ${message}`,
    }).catch(() => {
      logger.warn({ guildId }, "[stats:activity] Failed to send error message (interaction expired)");
    });
  }
}
