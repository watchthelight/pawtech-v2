/**
 * Pawtropolis Tech — src/commands/flag.ts
 * WHAT: Slash command for manually flagging users as bots
 * WHY: Allows moderators to flag suspicious users with a manual flag reason
 * FLOWS:
 *  - /flag <user> [reason] — Flags a user and logs to flagged channel
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { requireStaff } from "../lib/config.js";
import { env } from "../lib/env.js";
import { getExistingFlag, isAlreadyFlagged, upsertManualFlag } from "../store/flagsStore.js";
import { type CommandContext } from "../lib/cmdWrap.js";

export const data = new SlashCommandBuilder()
  .setName("flag")
  .setDescription("Manually flag a user as a bot")
  .addUserOption((option) =>
    option.setName("user").setDescription("The user to flag").setRequired(true)
  )
  .addStringOption((option) =>
    option.setName("reason").setDescription("Reason for flagging (optional)").setRequired(false)
  );

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const { guildId, guild } = interaction;
  if (!guildId || !guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Require staff permissions
  if (!requireStaff(interaction)) return;

  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason") || "Manually flagged as a bot";

  // Defer reply to allow time for API calls
  await interaction.deferReply({ ephemeral: true });

  try {
    // Check if user is already flagged (manual or auto)
    if (isAlreadyFlagged(guildId, targetUser.id)) {
      const existing = getExistingFlag(guildId, targetUser.id);
      if (!existing) {
        // Should never happen, but handle gracefully
        await interaction.editReply({
          content: `ℹ️ User <@${targetUser.id}> appears to be flagged, but details could not be retrieved.`,
        });
        return;
      }

      const flaggedDate = new Date(existing.flagged_at * 1000).toISOString().split("T")[0];
      const flaggedBy = existing.flagged_by ? `<@${existing.flagged_by}>` : "Unknown";
      const flagReason = existing.flagged_reason || "No reason provided";

      await interaction.editReply({
        content: `ℹ️ Already flagged on ${flaggedDate} by ${flaggedBy}. Reason: "${flagReason}". No new flag created.`,
      });
      return;
    }

    // Get member's join timestamp if available
    let joinedAt: number | null = null;
    try {
      const member = await guild.members.fetch(targetUser.id);
      if (member.joinedTimestamp) {
        joinedAt = Math.floor(member.joinedTimestamp / 1000);
      }
    } catch (err) {
      logger.debug({ err, userId: targetUser.id }, "[flag] Could not fetch member join timestamp");
    }

    // Create manual flag
    const flag = upsertManualFlag({
      guildId,
      userId: targetUser.id,
      reason,
      flaggedBy: interaction.user.id,
      joinedAt,
    });

    logger.info(
      { guildId, userId: targetUser.id, moderatorId: interaction.user.id, reason },
      "[flag] User manually flagged"
    );

    // Send confirmation to moderator
    await interaction.editReply({
      content: `✅ Flag recorded for <@${targetUser.id}> (ID ${targetUser.id}). Reason: "${reason}"`,
    });

    // Post to flagged channel if configured
    const flaggedChannelId = env.FLAGGED_REPORT_CHANNEL_ID;
    if (flaggedChannelId) {
      try {
        const channel = await guild.channels.fetch(flaggedChannelId);
        if (channel?.isTextBased()) {
          // Check if bot has permission to send messages and embeds
          const permissions = channel.permissionsFor(guild.members.me!);
          if (!permissions?.has(["SendMessages", "EmbedLinks"])) {
            logger.warn(
              { channelId: flaggedChannelId, guildId },
              "[flag] Missing permissions to post to flagged channel"
            );
            return;
          }

          const joinedAtDisplay = joinedAt
            ? new Date(joinedAt * 1000).toISOString().split("T")[0]
            : "Unknown";

          const embed = new EmbedBuilder()
            .setColor(Colors.Red)
            .setTitle("User Flagged")
            .setDescription(
              `**User:** <@${targetUser.id}> (${targetUser.id})\n**Flagged by:** <@${interaction.user.id}>\n**Reason:** ${reason}`
            )
            .addFields(
              { name: "User", value: `${targetUser.tag} (${targetUser.id})`, inline: true },
              { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
              { name: "Joined", value: joinedAtDisplay, inline: true },
              { name: "Flagged At", value: `<t:${flag.flagged_at}:F>`, inline: false }
            )
            .setFooter({ text: "manual_flag=1 • Pawtropolis" })
            .setThumbnail(targetUser.displayAvatarURL())
            .setTimestamp(flag.flagged_at * 1000);

          await channel.send({ embeds: [embed] });
        }
      } catch (err) {
        logger.warn(
          { err, channelId: flaggedChannelId },
          "[flag] Failed to send alert to flagged channel (non-fatal)"
        );
      }
    }
  } catch (err) {
    logger.error({ err, guildId, userId: targetUser.id }, "[flag] Failed to flag user");
    await interaction.editReply({
      content: "❌ Failed to flag user. Please check the logs.",
    });
  }
}
