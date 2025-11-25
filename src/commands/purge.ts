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
import crypto from "node:crypto";

// Discord limits: bulkDelete only works on messages < 14 days old, max 100 at a time
// For older messages, we delete individually (slower but works)
const BULK_DELETE_LIMIT = 100;
const MAX_ITERATIONS = 100; // Safety limit: 100 * 100 = 10000 messages max
const INDIVIDUAL_DELETE_BATCH = 5; // Delete old messages in small batches to avoid rate limits

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
 * WHAT: Constant-time string comparison to prevent timing attacks.
 * WHY: Password validation must not leak information via timing.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  return crypto.timingSafeEqual(bufA, bufB);
}

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

  if (!constantTimeCompare(password, correctPassword)) {
    logger.warn({ userId: interaction.user.id, guildId }, "[purge] incorrect password attempt");
    await interaction.reply({
      content: "Incorrect password.",
      ephemeral: true,
    });
    return;
  }

  // Validate channel type
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
    await interaction.reply({
      content: "This command can only be used in text channels.",
      ephemeral: true,
    });
    return;
  }

  const textChannel = channel as TextChannel;

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
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    let oldMessagesDeleted = 0;

    // Phase 1: Bulk delete messages < 14 days old (fast)
    while (totalDeleted < targetCount && iterations < MAX_ITERATIONS) {
      iterations++;

      // Calculate how many to fetch this iteration
      const remaining = targetCount - totalDeleted;
      const fetchLimit = Math.min(remaining, BULK_DELETE_LIMIT);

      // Fetch messages
      const messages = await textChannel.messages.fetch({ limit: fetchLimit });

      if (messages.size === 0) {
        // No more messages
        break;
      }

      // Separate messages by age
      const recentMessages = messages.filter((msg) => msg.createdTimestamp > twoWeeksAgo);
      const oldMessages = messages.filter((msg) => msg.createdTimestamp <= twoWeeksAgo);

      // Bulk delete recent messages
      if (recentMessages.size > 0) {
        const deleted = await textChannel.bulkDelete(recentMessages, true);
        totalDeleted += deleted.size;
      }

      // Delete old messages individually (slower but works)
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
                logger.warn({ err, messageId: msg.id }, "[purge] failed to delete old message");
              }
            })
          );
          // Delay between batches of old messages
          if (i + INDIVIDUAL_DELETE_BATCH < oldArray.length) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
      }

      // If no messages were deletable this iteration, we're done
      if (recentMessages.size === 0 && oldMessages.size === 0) {
        break;
      }

      // Small delay to avoid rate limits
      if (iterations < MAX_ITERATIONS && totalDeleted < targetCount) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
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
