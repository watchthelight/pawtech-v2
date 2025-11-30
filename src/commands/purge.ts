/**
 * Pawtropolis Tech — src/commands/purge.ts
 * WHAT: Admin command to bulk delete messages in a channel.
 * WHY: Allows quick cleanup of channels with password protection.
 * FLOWS:
 *  - User provides RESET_PASSWORD + optional count → deletes messages
 *  - No count = delete all messages (up to Discord limits)
 * DOCS:
 *  - TextChannel.bulkDelete: https://discord.js.org/#/docs/discord.js/main/class/TextChannel?scrollTo=bulkDelete
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  type TextChannel,
  ChannelType,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import { secureCompare } from "../lib/secureCompare.js";
import {
  DISCORD_BULK_DELETE_AGE_LIMIT_MS,
  MESSAGE_DELETE_BATCH_DELAY_MS,
  BULK_DELETE_ITERATION_DELAY_MS,
} from "../lib/constants.js";

/**
 * Discord API constraints that shape this entire implementation:
 * - bulkDelete: max 100 messages per call, ONLY works for msgs < 14 days old
 * - Individual delete: works on any message, but rate limited to ~5/sec
 *
 * The 14-day limit is a hard Discord constraint (error 50034) - no workaround
 * exists except individual deletion.
 */
const BULK_DELETE_LIMIT = 100;
const MAX_ITERATIONS = 100; // Safety valve: prevents infinite loops, caps at ~10k messages
const INDIVIDUAL_DELETE_BATCH = 5; // Batch size for old messages - tuned to avoid rate limits

export const data = new SlashCommandBuilder()
  .setName("purge")
  .setDescription("Bulk delete messages in this channel (requires password)")
  .addStringOption((option) =>
    option
      .setName("password")
      .setDescription("Admin password")
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName("count")
      .setDescription("Number of messages to delete (default: all)")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(10000)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

/**
 * execute
 * WHAT: Bulk deletes messages in the current channel after password validation.
 * SECURITY:
 *  - Requires ManageMessages permission
 *  - Validates password with constant-time comparison
 *  - Logs action
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  const password = interaction.options.getString("password", true);
  const count = interaction.options.getInteger("count"); // null = delete all
  const guildId = interaction.guildId;
  const channel = interaction.channel;

  if (!guildId) {
    await interaction.reply({
      content: "This command can only be used in a guild.",
      ephemeral: true,
    });
    return;
  }

  // Validate password
  const correctPassword = process.env.RESET_PASSWORD;

  if (!correctPassword) {
    logger.error("[purge] RESET_PASSWORD not configured in environment");
    await interaction.reply({
      content: "Password not configured. Contact bot administrator.",
      ephemeral: true,
    });
    return;
  }

  if (!secureCompare(password, correctPassword)) {
    logger.warn({ userId: interaction.user.id, guildId }, "[purge] incorrect password attempt");
    await interaction.reply({
      content: "Incorrect password.",
      ephemeral: true,
    });
    return;
  }

  // Only text and announcement channels support bulkDelete.
  // Voice, forum, and stage channels have different message semantics.
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
    await interaction.reply({
      content: "This command can only be used in text channels.",
      ephemeral: true,
    });
    return;
  }

  // Type assertion is safe after the channel type check above
  const textChannel = channel as TextChannel;

  // Validate bot has required permissions before starting
  const botMember = interaction.guild?.members.me;
  if (botMember) {
    const permissions = textChannel.permissionsFor(botMember);
    if (!permissions?.has(["ManageMessages", "ReadMessageHistory"])) {
      await interaction.reply({
        content: "I don't have ManageMessages and ReadMessageHistory permissions in this channel.",
        ephemeral: true,
      });
      return;
    }
  }

  // Defer reply - this will take time
  await interaction.deferReply({ ephemeral: true });

  const targetCount = count ?? Infinity;
  let totalDeleted = 0;
  let iterations = 0;

  logger.info(
    { userId: interaction.user.id, guildId, channelId: channel.id, targetCount: count ?? "all" },
    "[purge] starting bulk delete"
  );

  try {
    const twoWeeksAgo = Date.now() - DISCORD_BULK_DELETE_AGE_LIMIT_MS;
    let oldMessagesDeleted = 0;

    // Main deletion loop - handles both bulk (fast) and individual (slow) deletion.
    // We fetch, partition by age, then delete appropriately.
    while (totalDeleted < targetCount && iterations < MAX_ITERATIONS) {
      iterations++;

      // Fetch exactly what we need, up to Discord's 100-message limit.
      // Note: fetch() returns messages in newest-first order.
      const remaining = targetCount - totalDeleted;
      const fetchLimit = Math.min(remaining, BULK_DELETE_LIMIT);

      const messages = await textChannel.messages.fetch({ limit: fetchLimit });

      if (messages.size === 0) {
        // No more messages
        break;
      }

      // Separate messages by age
      const recentMessages = messages.filter((msg) => msg.createdTimestamp > twoWeeksAgo);
      const oldMessages = messages.filter((msg) => msg.createdTimestamp <= twoWeeksAgo);

      // Bulk delete recent messages - the second param (true) filters out
      // messages that became too old between fetch and delete (race condition protection)
      if (recentMessages.size > 0) {
        const deleted = await textChannel.bulkDelete(recentMessages, true);
        totalDeleted += deleted.size;
      }

      // Old messages (>14 days) must be deleted one-by-one. This is painful but
      // there's no API alternative. We batch with Promise.all for some parallelism,
      // then sleep to respect rate limits.
      if (oldMessages.size > 0 && totalDeleted < targetCount) {
        const oldArray = Array.from(oldMessages.values());
        for (let i = 0; i < oldArray.length && totalDeleted < targetCount; i += INDIVIDUAL_DELETE_BATCH) {
          const batch = oldArray.slice(i, i + INDIVIDUAL_DELETE_BATCH);
          await Promise.all(
            batch.map(async (msg) => {
              try {
                await msg.delete();
                totalDeleted++;
                oldMessagesDeleted++;
              } catch (err) {
                // Common failures: message already deleted, missing permissions
                // on specific message (e.g., system messages). Don't abort the whole op.
                logger.warn({ err, messageId: msg.id }, "[purge] failed to delete old message");
              }
            })
          );
          // MESSAGE_DELETE_BATCH_DELAY_MS delay is conservative but safe. Discord's rate limits are
          // per-route and can vary; this keeps us well under the threshold.
          if (i + INDIVIDUAL_DELETE_BATCH < oldArray.length) {
            await new Promise((resolve) => setTimeout(resolve, MESSAGE_DELETE_BATCH_DELAY_MS));
          }
        }
      }

      // If no messages were deletable this iteration, we're done
      if (recentMessages.size === 0 && oldMessages.size === 0) {
        break;
      }

      // Small delay to avoid rate limits
      if (iterations < MAX_ITERATIONS && totalDeleted < targetCount) {
        await new Promise((resolve) => setTimeout(resolve, BULK_DELETE_ITERATION_DELAY_MS));
      }
    }

    logger.info(
      { userId: interaction.user.id, guildId, channelId: channel.id, totalDeleted, oldMessagesDeleted },
      "[purge] delete complete"
    );

    // Success response
    const embed = new EmbedBuilder()
      .setTitle("Purge Complete")
      .setDescription(`Deleted **${totalDeleted.toLocaleString()}** messages from this channel.`)
      .setColor(0x57f287)
      .setTimestamp();

    if (oldMessagesDeleted > 0) {
      embed.addFields({
        name: "Note",
        value: `${oldMessagesDeleted} messages were older than 14 days and deleted individually (slower).`,
      });
    }

    if (totalDeleted === 0) {
      embed.setDescription("No messages were deleted. The channel may be empty.");
      embed.setColor(0xfee75c);
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err, channelId: channel.id, totalDeleted }, "[purge] error during delete");

    await interaction.editReply({
      content: `Error during purge. Deleted ${totalDeleted} messages before error occurred.`,
    });
  }
}
