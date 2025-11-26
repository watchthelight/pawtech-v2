/**
 * Pawtropolis Tech — src/commands/activity.ts
 * WHAT: /activity command showing multi-week server activity heatmap with trends
 * WHY: Provides visual insight into server activity patterns over time (1-8 weeks)
 * FLOWS:
 *  - Fetch activity data from action_log table (UTC-based)
 *  - Generate multi-week heatmap image with trends analysis
 *  - Reply with PNG attachment in Discord embed
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { withStep, type CommandContext } from '../lib/cmdWrap.js';
import { fetchActivityData, generateHeatmap } from '../lib/activityHeatmap.js';
import { requireStaff } from '../lib/config.js';

// Discord enforces min/max on their side, but we still default to 1 if not provided.
// The 8-week cap exists because image generation time grows linearly and Discord
// has a 3-second window before interactions expire (we defer, but still).
export const data = new SlashCommandBuilder()
  .setName('activity')
  .setDescription('View server activity heatmap with trends analysis')
  .addIntegerOption((option) =>
    option
      .setName('weeks')
      .setDescription('Number of weeks to show (1-8, default: 1)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(8)
  );

/**
 * execute
 * WHAT: Generates and sends multi-week activity heatmap with trends
 * RETURNS: Promise<void>
 * THROWS: Never; errors caught by wrapCommand upstream
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const { guildId } = interaction;

  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  // Require staff permissions
  if (!requireStaff(interaction)) return;

  // Get weeks parameter (default: 1)
  const weeks = interaction.options.getInteger('weeks', false) || 1;

  // Defer immediately - heatmap generation can take 2-10 seconds depending on data volume.
  // Discord kills unacknowledged interactions after 3 seconds. ephemeral: false so
  // the whole team can see the heatmap without someone re-running the command.
  await interaction.deferReply({ ephemeral: false });

  try {
    // Fetch activity data from database
    const data = await withStep(ctx, 'fetch_activity', async () => {
      return fetchActivityData(guildId, weeks);
    });

    // Generate heatmap image
    const buffer = await withStep(ctx, 'generate_heatmap', async () => {
      return generateHeatmap(data);
    });

    // Send as attachment with embed
    await withStep(ctx, 'reply', async () => {
      const attachment = new AttachmentBuilder(buffer, {
        name: 'activity-heatmap.png',
      });

      const totalMessages = data.trends.totalMessages;
      const weekText = weeks === 1 ? '7 days' : `${weeks} weeks`;

      // The attachment:// protocol is Discord's way of referencing files in the same message.
      // This only works if the file is attached in the same API call - you can't reference
      // attachments from previous messages or other channels.
      const embed = new EmbedBuilder()
        .setTitle('Server Activity Report')
        .setDescription(`Activity heatmap for the past ${weekText} (UTC)`)
        .setImage('attachment://activity-heatmap.png')
        .setColor(0x2ecc71)
        .setTimestamp();

      // Discord renders inline fields in rows of 3. The \u200b (zero-width space) fields
      // act as invisible spacers to force proper column alignment. Without them, fields
      // wrap unpredictably on mobile vs desktop.
      embed.addFields(
        { name: 'Total Messages', value: totalMessages.toLocaleString(), inline: true },
        { name: 'Avg Messages per Hour', value: data.trends.avgMessagesPerHour.toFixed(1), inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: 'Busiest Hours', value: data.trends.busiestHours, inline: true },
        { name: 'Least Active Hours', value: data.trends.leastActiveHours, inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: 'Peak Days', value: data.trends.peakDays.join(', '), inline: true },
        { name: 'Quietest Days', value: data.trends.quietestDays.join(', '), inline: true }
      );

      // Add week-over-week growth if multi-week
      if (data.trends.weekOverWeekGrowth !== undefined) {
        const growth = data.trends.weekOverWeekGrowth;
        const growthStr = growth > 0 ? `+${growth.toFixed(1)}%` : `${growth.toFixed(1)}%`;
        const emoji = growth > 0 ? '📈' : growth < 0 ? '📉' : '━';
        embed.addFields({ name: 'Week-over-Week', value: `${emoji} ${growthStr}`, inline: true });
      }

      await interaction.editReply({
        embeds: [embed],
        files: [attachment],
      });
    });
  } catch (error) {
    await interaction.editReply({
      content: `Error generating activity heatmap: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}
