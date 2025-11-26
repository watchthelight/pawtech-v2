/**
 * Pawtropolis Tech — src/commands/flag.ts
 *
 * Manual flagging for suspicious users. This complements the automatic flagger
 * (Silent-Since-Join) by letting mods flag users based on gut instinct or
 * behavior patterns the auto-flagger can't detect.
 *
 * Flags are idempotent - reflagging an already-flagged user is a no-op.
 * This prevents duplicate alerts and preserves the original flag reason/timestamp.
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

const FLAG_RATE_LIMIT_MS = 2000;
const flagCooldowns = new Map<string, number>();

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

  const moderatorId = interaction.user.id;
  const now = Date.now();
  const cooldownKey = `${guildId}:${moderatorId}`;
  const lastFlagTime = flagCooldowns.get(cooldownKey);

  if (lastFlagTime && now - lastFlagTime < FLAG_RATE_LIMIT_MS) {
    const remainingMs = FLAG_RATE_LIMIT_MS - (now - lastFlagTime);
    await interaction.reply({
      content: `⏱️ Please wait ${Math.ceil(remainingMs / 1000)}s before flagging another user.`,
      ephemeral: true,
    });
    return;
  }

  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason") || "Manually flagged as a bot";

  // Defer reply to allow time for API calls
  await interaction.deferReply({ ephemeral: true });

  try {
    // Idempotency check: don't create duplicate flags. This is important because:
    // 1. Multiple mods might flag the same sus user
    // 2. Auto-flagger might have already caught them
    // 3. Preserves original timestamp/reason for audit purposes
    if (isAlreadyFlagged(guildId, targetUser.id)) {
      const existing = getExistingFlag(guildId, targetUser.id);
      if (!existing) {
        // Race condition or DB inconsistency. Shouldn't happen in practice.
        await interaction.editReply({
          content: `User <@${targetUser.id}> appears to be flagged, but details could not be retrieved.`,
        });
        return;
      }

      const flaggedDate = new Date(existing.flagged_at * 1000).toISOString().split("T")[0];
      const flaggedBy = existing.flagged_by ? `<@${existing.flagged_by}>` : "Unknown";
      const flagReason = existing.flagged_reason || "No reason provided";

      await interaction.editReply({
        content: `Already flagged on ${flaggedDate} by ${flaggedBy}. Reason: "${flagReason}". No new flag created.`,
      });
      return;
    }

    // Fetch join timestamp for the flag record. This can fail if:
    // - User already left the server (we can still flag them for future reference)
    // - Bot lacks permission to fetch members
    // We continue without it - it's nice-to-have metadata, not required.
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

    flagCooldowns.set(cooldownKey, Date.now());

    // Send confirmation to moderator
    await interaction.editReply({
      content: `✅ Flag recorded for <@${targetUser.id}> (ID ${targetUser.id}). Reason: "${reason}"`,
    });

    // Post alert to the flags channel. This is separate from the ephemeral reply
    // because the alert needs to be visible to all staff, not just the invoker.
    // The channel is configured via FLAGGED_REPORT_CHANNEL_ID env var or /config.
    const flaggedChannelId = env.FLAGGED_REPORT_CHANNEL_ID;
    if (flaggedChannelId) {
      try {
        const channel = await guild.channels.fetch(flaggedChannelId);
        if (channel?.isTextBased()) {
          // Proactive permission check. Without this, the send() would fail with
          // a generic "Missing Permissions" error that's harder to debug.
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

          // The footer "manual_flag=1" distinguishes manual flags from auto-flags
          // in case anyone parses embeds programmatically. The timestamp format
          // <t:...:F> is Discord's dynamic timestamp - it shows in the viewer's timezone.
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
        // Non-fatal: the flag was recorded in the DB, we just couldn't post the alert.
        // Staff will see it next time they query flags. Log and move on.
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
