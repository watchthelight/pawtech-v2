/**
 * Pawtropolis Tech — src/commands/backfill.ts
 * WHAT: /backfill command to populate message_activity table with historical data
 * WHY: Allows staff to trigger backfill and get notified when complete
 * FLOWS:
 *  - Staff runs /backfill command
 *  - Bot spawns backfill script as background process
 *  - Bot monitors progress and pings role when complete
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { spawn } from 'child_process';
import { type CommandContext } from '../lib/cmdWrap.js';
import { requireStaff, getConfig } from '../lib/config.js';
import { logger } from '../lib/logger.js';

export const data = new SlashCommandBuilder()
  .setName('backfill')
  .setDescription('Backfill message activity data for heatmap (staff only)')
  .addIntegerOption((option) =>
    option
      .setName('weeks')
      .setDescription('Number of weeks to backfill (1-8, default: 8)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(8)
  )
  .addBooleanOption((option) =>
    option
      .setName('dry-run')
      .setDescription('Test without writing to database (default: false)')
      .setRequired(false)
  );

// Fallback channel ID - used if not configured via /config set backfill_channel
const FALLBACK_NOTIFICATION_CHANNEL_ID = '1429947536793145374';

/**
 * getBackfillNotificationChannelId
 * WHAT: Get the notification channel for backfill completion
 * WHY: Now configurable via /config set backfill_channel
 */
function getBackfillNotificationChannelId(guildId: string): string {
  const cfg = getConfig(guildId);
  return cfg?.backfill_notification_channel_id ?? FALLBACK_NOTIFICATION_CHANNEL_ID;
}

/**
 * execute
 * WHAT: Runs backfill script in background and notifies when complete
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
  if (!requireStaff(interaction, {
    command: "backfill",
    description: "Backfills historical message activity data for the heatmap.",
    requirements: [
      { type: "config", field: "mod_role_ids" },
      { type: "permission", permission: "ManageGuild" },
    ],
  })) return;

  const weeks = interaction.options.getInteger('weeks', false) || 8;
  const dryRun = interaction.options.getBoolean('dry-run', false) || false;

  if (weeks < 1 || weeks > 8) {
    await interaction.reply({
      content: '❌ Invalid weeks value. Must be between 1 and 8.',
      ephemeral: true,
    });
    return;
  }

  const currentDate = new Date();
  const oldestDate = new Date();
  oldestDate.setDate(currentDate.getDate() - (weeks * 7));

  if (oldestDate > currentDate) {
    await interaction.reply({
      content: '❌ Invalid date range: calculated start date is in the future.',
      ephemeral: true,
    });
    return;
  }

  // Acknowledge command
  await interaction.reply({
    content: `🔄 Starting backfill for ${weeks} weeks${dryRun ? ' (DRY RUN)' : ''}...\n\nThis will take 15-20 minutes. You'll be pinged when complete.`,
    ephemeral: false,
  });

  // Build command arguments
  const args = [guildId, weeks.toString()];
  if (dryRun) {
    args.push('--dry-run');
  }

  logger.info({ guildId, weeks, dryRun }, '[backfill] Starting backfill command');

  // Spawn as child process rather than inline because:
  // 1. Backfill takes 15-20 minutes - we can't block the main event loop
  // 2. If the bot restarts mid-backfill, the child continues (mostly harmless, idempotent)
  // 3. Memory isolation - backfill can be memory-hungry and we don't want to OOM the bot
  // stdio: 'pipe' lets us capture stdout/stderr for progress reporting.
  const backfillProcess = spawn('npx', ['tsx', 'scripts/backfill-message-activity.ts', ...args], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });

  let stdout = '';
  let stderr = '';
  let totalMessages = 0;
  let channelsProcessed = 0;
  let insertedMessages = 0;

  // Parsing stdout for progress is fragile - if the script's output format changes,
  // this breaks silently. But it's good enough for a staff-only diagnostic command.
  // The regexes handle comma-formatted numbers (e.g., "1,234") which the script outputs.
  backfillProcess.stdout?.on('data', (data) => {
    const output = data.toString();
    stdout += output;

    const totalMatch = output.match(/Total messages found: ([\d,]+)/);
    if (totalMatch) {
      totalMessages = parseInt(totalMatch[1].replace(/,/g, ''), 10);
    }

    const channelsMatch = output.match(/Channels processed: ([\d,]+)/);
    if (channelsMatch) {
      channelsProcessed = parseInt(channelsMatch[1].replace(/,/g, ''), 10);
    }

    const insertedMatch = output.match(/Messages inserted: ([\d,]+)/);
    if (insertedMatch) {
      insertedMessages = parseInt(insertedMatch[1].replace(/,/g, ''), 10);
    }
  });

  backfillProcess.stderr?.on('data', (data) => {
    stderr += data.toString();
  });

  backfillProcess.on('close', async (code) => {
    const success = code === 0;

    logger.info(
      { guildId, weeks, success, totalMessages, channelsProcessed, insertedMessages },
      '[backfill] Backfill completed'
    );

    try {
      // Get notification channel (now configurable via /config set backfill_channel)
      const notificationChannelId = getBackfillNotificationChannelId(guildId);
      const channel = await interaction.client.channels.fetch(notificationChannelId);
      if (!channel?.isTextBased()) {
        logger.warn({ channelId: notificationChannelId }, '[backfill] Notification channel not found or not text-based');
        return;
      }

      // Build completion embed
      const embed = new EmbedBuilder()
        .setTitle(success ? '✅ Backfill Complete' : '❌ Backfill Failed')
        .setColor(success ? 0x2ecc71 : 0xe74c3c)
        .addFields(
          { name: 'Weeks Processed', value: weeks.toString(), inline: true },
          { name: 'Channels Processed', value: channelsProcessed.toLocaleString(), inline: true },
          { name: 'Total Messages', value: totalMessages.toLocaleString(), inline: true }
        )
        .setTimestamp();

      if (success && !dryRun) {
        embed.addFields({
          name: 'Messages Inserted',
          value: insertedMessages.toLocaleString(),
          inline: true,
        });
        embed.setDescription('Message activity data has been successfully backfilled!\n\nUse `/activity weeks:8` to view the heatmap.');
      } else if (dryRun) {
        embed.setDescription('Dry run completed - no data was written to the database.');
      } else {
        embed.setDescription(`Backfill failed with exit code ${code}.\n\nCheck logs for details.`);
      }

      // The "send" in channel check is a TypeScript narrowing trick. channels.fetch()
      // returns a Channel | null, but not all Channel types have send(). TextChannel,
      // NewsChannel, etc. do, but CategoryChannel doesn't. This check satisfies TS.
      if ("send" in channel) {
        await channel.send({
          embeds: [embed],
        });
      }
    } catch (err) {
      logger.error({ err, guildId }, '[backfill] Failed to send completion notification');
    }
  });

  backfillProcess.on('error', (err) => {
    logger.error({ err, guildId }, '[backfill] Failed to spawn backfill process');
  });
}
