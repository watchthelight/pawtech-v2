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
import { requireMinRole, ROLE_IDS, JUNIOR_MOD_PLUS } from "../lib/config.js";
import { env } from "../lib/env.js";
import { getExistingFlag, isAlreadyFlagged, upsertManualFlag } from "../store/flagsStore.js";
import { type CommandContext, withStep, withSql } from "../lib/cmdWrap.js";

/**
 * Rate limiter for flag command (per moderator per guild).
 *
 * - Active cooldown: 15 seconds (prevents spam flagging)
 * - Entry TTL: 1 hour (memory cleanup)
 * - Cleanup interval: 5 minutes
 *
 * Memory: Max ~50-500 entries x 120 bytes = ~6-60 KB
 */
const FLAG_RATE_LIMIT_MS = 15 * 1000; // 15 seconds - prevents spam flagging
const FLAG_COOLDOWN_TTL_MS = 60 * 60 * 1000; // 1 hour - entries expire after this
const flagCooldowns = new Map<string, number>();

// Track interval for cleanup on shutdown
let flagCooldownInterval: NodeJS.Timeout | null = null;

// Cleanup expired entries every 5 minutes
flagCooldownInterval = setInterval(() => {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, timestamp] of flagCooldowns) {
    if (now - timestamp > FLAG_COOLDOWN_TTL_MS) {
      flagCooldowns.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug(
      { cleaned, remaining: flagCooldowns.size },
      "[flag] cooldown cleanup"
    );
  }
}, 5 * 60 * 1000);
flagCooldownInterval.unref();

/**
 * Cleanup function for graceful shutdown.
 * Clears the interval and the cooldown map to prevent memory leaks
 * and allow the process to exit cleanly.
 */
export function cleanupFlagCooldowns(): void {
  if (flagCooldownInterval) {
    clearInterval(flagCooldownInterval);
    flagCooldownInterval = null;
  }
  flagCooldowns.clear();
}

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

  // Require Junior Moderator+ role
  const hasPermission = await withStep(ctx, "permission_check", async () => {
    return requireMinRole(interaction, ROLE_IDS.JUNIOR_MOD, {
      command: "flag",
      description: "Manually flags a user as suspicious for staff review.",
      requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.JUNIOR_MOD }],
    });
  });
  if (!hasPermission) return;

  const moderatorId = interaction.user.id;
  const cooldownKey = `${guildId}:${moderatorId}`;
  const passedRateLimit = await withStep(ctx, "rate_limit", async () => {
    const now = Date.now();
    const lastFlagTime = flagCooldowns.get(cooldownKey);

    if (lastFlagTime && now - lastFlagTime < FLAG_RATE_LIMIT_MS) {
      const remainingMs = FLAG_RATE_LIMIT_MS - (now - lastFlagTime);
      await interaction.reply({
        content: `⏱️ Please wait ${Math.ceil(remainingMs / 1000)}s before flagging another user.`,
        ephemeral: true,
      });
      return false;
    }
    return true;
  });
  if (!passedRateLimit) return;

  const { targetUser, reason } = await withStep(ctx, "parse_options", async () => {
    return {
      targetUser: interaction.options.getUser("user", true),
      reason: interaction.options.getString("reason") || "Manually flagged as a bot",
    };
  });

  // Defer reply to allow time for API calls
  await withStep(ctx, "defer", async () => {
    await interaction.deferReply({ ephemeral: true });
  });

  try {
    // Idempotency check: don't create duplicate flags
    const isDuplicate = await withStep(ctx, "check_duplicate", async () => {
      const alreadyFlagged = withSql(ctx, "SELECT * FROM flagged_users WHERE ...", () =>
        isAlreadyFlagged(guildId, targetUser.id)
      );

      if (alreadyFlagged) {
        const existing = withSql(ctx, "SELECT * FROM flagged_users WHERE ...", () =>
          getExistingFlag(guildId, targetUser.id)
        );

        if (!existing) {
          // Race condition or DB inconsistency. Shouldn't happen in practice.
          await interaction.editReply({
            content: `User <@${targetUser.id}> appears to be flagged, but details could not be retrieved.`,
          });
          return true;
        }

        const flaggedDate = new Date(existing.flagged_at * 1000).toISOString().split("T")[0];
        const flaggedBy = existing.flagged_by ? `<@${existing.flagged_by}>` : "Unknown";
        const flagReason = existing.flagged_reason || "No reason provided";

        await interaction.editReply({
          content: `Already flagged on ${flaggedDate} by ${flaggedBy}. Reason: "${flagReason}". No new flag created.`,
        });
        return true;
      }
      return false;
    });
    if (isDuplicate) return;

    // Fetch join timestamp for the flag record
    const joinedAt = await withStep(ctx, "fetch_member", async () => {
      try {
        const member = await guild.members.fetch(targetUser.id);
        if (member.joinedTimestamp) {
          return Math.floor(member.joinedTimestamp / 1000);
        }
      } catch (err) {
        logger.debug({ err, userId: targetUser.id }, "[flag] Could not fetch member join timestamp");
      }
      return null;
    });

    // Create manual flag
    const flag = await withStep(ctx, "create_flag", async () => {
      const f = withSql(ctx, "INSERT INTO flagged_users ...", () =>
        upsertManualFlag({
          guildId,
          userId: targetUser.id,
          reason,
          flaggedBy: interaction.user.id,
          joinedAt,
        })
      );

      logger.info(
        { guildId, userId: targetUser.id, moderatorId: interaction.user.id, reason },
        "[flag] User manually flagged"
      );

      flagCooldowns.set(cooldownKey, Date.now());
      return f;
    });

    // Send confirmation to moderator
    await withStep(ctx, "reply", async () => {
      await interaction.editReply({
        content: `✅ Flag recorded for <@${targetUser.id}> (ID ${targetUser.id}). Reason: "${reason}"`,
      });
    });

    // Post alert to the flags channel
    await withStep(ctx, "post_alert", async () => {
      const flaggedChannelId = env.FLAGGED_REPORT_CHANNEL_ID;
      if (!flaggedChannelId) return;

      try {
        const channel = await guild.channels.fetch(flaggedChannelId);
        if (channel?.isTextBased()) {
          // Proactive permission check
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
        // Non-fatal: the flag was recorded in the DB, we just couldn't post the alert.
        logger.warn(
          { err, channelId: flaggedChannelId },
          "[flag] Failed to send alert to flagged channel (non-fatal)"
        );
      }
    });
  } catch (err) {
    logger.error({ err, guildId, userId: targetUser.id }, "[flag] Failed to flag user");
    await interaction.editReply({
      content: "❌ Failed to flag user. Please check the logs.",
    });
  }
}
