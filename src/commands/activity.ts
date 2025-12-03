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

// The whole reason this command exists is because Discord's built-in insights
// are garbage for anything beyond "how many messages this week." Staff wanted
// to see actual patterns - when are people online, what days are dead, etc.
// So here we are, generating PNGs in a Discord bot like it's 2015.

import {
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { withStep, type CommandContext } from '../lib/cmdWrap.js';
import { fetchActivityData, generateHeatmap } from '../lib/activityHeatmap.js';
import { requireStaff } from '../lib/config.js';
import { classifyError, userFriendlyMessage } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

// Discord enforces min/max on their side, but we still default to 1 if not provided.
// The 8-week cap exists because image generation time grows linearly and Discord
// has a 3-second window before interactions expire (we defer, but still).
// Fun fact: someone once tried 52 weeks. The bot didn't crash, but the image was
// unreadable and the canvas library used 800MB of RAM. Hence the cap.
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

  // Technically this check is redundant since the command is registered as a
  // guild command, not global. But TypeScript doesn't know that, and neither
  // does Discord if someone accidentally deploys this globally. Defense in depth.
  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  // Require staff permissions. This is a staff-only command because:
  // 1. The heatmap reveals server activity patterns (privacy concern)
  // 2. Image generation is CPU-intensive (rate limiting concern)
  // 3. Regular users don't need to know peak hours (they just want to chat)
  if (!requireStaff(interaction)) return;

  // Get weeks parameter (default: 1)
  // The || 1 fallback handles null, which happens when the option isn't provided.
  // We could use ?? but || is fine here since 0 weeks would be meaningless anyway.
  const weeks = interaction.options.getInteger('weeks', false) || 1;

  // Defer immediately - heatmap generation can take 2-10 seconds depending on data volume.
  // Discord kills unacknowledged interactions after 3 seconds. ephemeral: false so
  // the whole team can see the heatmap without someone re-running the command.
  await interaction.deferReply({ ephemeral: false });

  try {
    // Fetch activity data from database
    // withStep() is for Sentry tracing - it creates a span so we can see in the
    // dashboard if the DB query is slow vs the image generation. Spoiler: it's
    // almost always the image generation.
    const data = await withStep(ctx, 'fetch_activity', async () => {
      return fetchActivityData(guildId, weeks);
    });

    // Generate heatmap image
    // This is the expensive part. The canvas library renders a full PNG in memory,
    // which for 8 weeks of data can be 50-100MB before compression. We're returning
    // a Buffer here, not streaming, so memory pressure is real on busy servers.
    const buffer = await withStep(ctx, 'generate_heatmap', async () => {
      return generateHeatmap(data);
    });

    // Send as attachment with embed
    await withStep(ctx, 'reply', async () => {
      const attachment = new AttachmentBuilder(buffer, {
        name: 'activity-heatmap.png',
      });

      const totalMessages = data.trends.totalMessages;
      // "7 days" sounds friendlier than "1 week" for single-week view. Nobody asked
      // for this, I just thought it read better. Fight me.
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
      // wrap unpredictably on mobile vs desktop. Yes, this is cursed. No, there's no
      // better way. Discord's embed layout engine was designed by someone who hates CSS
      // and also developers.
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
      // Only shown for 2+ weeks because comparing week 1 to... nothing... is meaningless.
      // The !== undefined check is because 0% growth is valid (and would be falsy).
      if (data.trends.weekOverWeekGrowth !== undefined) {
        const growth = data.trends.weekOverWeekGrowth;
        // The ternary for growthStr ensures positive numbers get a + prefix.
        // Negative numbers already have the minus sign from toFixed().
        const growthStr = growth > 0 ? `+${growth.toFixed(1)}%` : `${growth.toFixed(1)}%`;
        // The '━' dash for exactly 0 is a rare edge case but it happens on dead servers.
        const emoji = growth > 0 ? '📈' : growth < 0 ? '📉' : '━';
        embed.addFields({ name: 'Week-over-Week', value: `${emoji} ${growthStr}`, inline: true });
      }

      await interaction.editReply({
        embeds: [embed],
        files: [attachment],
      });
    });
  } catch (error) {
    // classifyError categorizes the error (DB error, timeout, unknown, etc.)
    // so we can give users a meaningful message instead of "something went wrong"
    const classified = classifyError(error);
    logger.error({ error: classified, guildId }, '[activity] Failed to generate heatmap');

    // userFriendlyMessage() translates error codes into human-readable text.
    // For example, SQLITE_BUSY becomes "Database is temporarily busy" instead
    // of the raw error that would confuse staff.
    const message = userFriendlyMessage(classified);

    // The .catch() here handles the case where the interaction token expired
    // (15 minutes after deferReply). Rare, but possible if something upstream
    // is very slow or the bot got rate-limited hard.
    await interaction.editReply({
      content: `Error generating activity heatmap: ${message}`,
    }).catch(() => {
      logger.warn({ guildId }, '[activity] Failed to send error message (interaction expired)');
    });
  }
}
