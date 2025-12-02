/**
 * Pawtropolis Tech — src/features/avatarNsfwMonitor.ts
 * WHAT: Real-time NSFW avatar detection on guildMemberUpdate events
 * WHY: Detect NSFW avatars as soon as users change them, without waiting for manual audits
 * FLOWS:
 *  - guildMemberUpdate → handleAvatarChange → detectNsfwVision → alert if 80%+
 * DOCS:
 *  - Discord.js guildMemberUpdate: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-guildMemberUpdate
 *  - Google Vision SafeSearch: https://cloud.google.com/vision/docs/detecting-safe-search
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { GuildMember, PartialGuildMember, TextChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { logger } from "../lib/logger.js";
import { detectNsfwVision } from "./googleVision.js";
import { getLoggingChannelId } from "../config/loggingStore.js";
import { upsertNsfwFlag } from "../store/nsfwFlagsStore.js";
import { googleReverseImageUrl } from "../ui/reviewCard.js";
import { getConfig } from "../lib/config.js";

const NSFW_THRESHOLD = 0.8; // 80% = hard evidence

/**
 * Handle avatar changes from guildMemberUpdate event
 * Checks both server-specific avatar and global user avatar changes
 */
export async function handleAvatarChange(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
): Promise<void> {
  // Check if avatar actually changed
  // member.avatar = server-specific avatar (can be null)
  // member.user.avatar = global Discord avatar
  const oldServerAvatar = oldMember.avatar;
  const newServerAvatar = newMember.avatar;
  const oldUserAvatar = oldMember.user?.avatar;
  const newUserAvatar = newMember.user.avatar;

  const serverAvatarChanged = oldServerAvatar !== newServerAvatar;
  const userAvatarChanged = oldUserAvatar !== newUserAvatar;

  if (!serverAvatarChanged && !userAvatarChanged) {
    return; // No avatar change
  }

  // Get the current avatar URL (prefer server avatar if set)
  const avatarUrl = newMember.avatar
    ? newMember.displayAvatarURL({ extension: "png", size: 256 })
    : newMember.user.avatar
      ? newMember.user.displayAvatarURL({ extension: "png", size: 256 })
      : null;

  if (!avatarUrl) {
    return; // No custom avatar (default Discord avatar)
  }

  // Skip bots
  if (newMember.user.bot) {
    return;
  }

  const guildId = newMember.guild.id;
  const userId = newMember.id;

  logger.info(
    { guildId, userId, serverAvatarChanged, userAvatarChanged },
    "[avatarNsfwMonitor] Avatar change detected, scanning..."
  );

  // Scan with Google Vision
  const visionResult = await detectNsfwVision(avatarUrl);

  if (!visionResult) {
    logger.warn({ guildId, userId }, "[avatarNsfwMonitor] Vision API call failed or disabled");
    return;
  }

  logger.debug(
    { guildId, userId, adultScore: visionResult.adultScore },
    "[avatarNsfwMonitor] Scan complete"
  );

  // Check if above threshold
  if (visionResult.adultScore < NSFW_THRESHOLD) {
    return; // Clean avatar
  }

  // NSFW detected! Flag and alert
  logger.warn(
    { guildId, userId, adultScore: visionResult.adultScore },
    "[avatarNsfwMonitor] NSFW avatar detected!"
  );

  // Save to database
  upsertNsfwFlag({
    guildId,
    userId,
    avatarUrl,
    nsfwScore: visionResult.adultScore,
    reason: "auto_scan",
    flaggedBy: "system",
  });

  // Send alert to logging channel
  const loggingChannelId = getLoggingChannelId(guildId);
  if (!loggingChannelId) {
    logger.warn({ guildId }, "[avatarNsfwMonitor] No logging channel configured, can't send alert");
    return;
  }

  try {
    const channel = await newMember.guild.channels.fetch(loggingChannelId);
    if (!channel || !channel.isTextBased()) {
      logger.warn({ guildId, loggingChannelId }, "[avatarNsfwMonitor] Logging channel not found or not text-based");
      return;
    }

    // Get mod role to ping
    const config = getConfig(guildId);
    const modRoleIds = config?.mod_role_ids?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];
    const rolePing = modRoleIds.length > 0 ? `<@&${modRoleIds[0]}>` : "";

    const reverseSearchUrl = googleReverseImageUrl(avatarUrl);
    const alertEmbed = new EmbedBuilder()
      .setTitle("🔞 NSFW Avatar Detected")
      .setDescription(
        `A user changed their avatar to potentially NSFW content.\n\n` +
        `**Action Required:** Review and take appropriate action.`
      )
      .setColor(0xE74C3C) // Red
      .setThumbnail(newMember.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: "User", value: `${newMember} (\`${userId}\`)`, inline: true },
        { name: "Score", value: `${Math.round(visionResult.adultScore * 100)}%`, inline: true },
        { name: "Detection", value: "Real-time avatar change", inline: true },
        { name: "Avatar", value: `[Reverse Image Search](${reverseSearchUrl})` }
      )
      .setTimestamp()
      .setFooter({ text: "Auto-detected by avatar monitor" });

    await (channel as TextChannel).send({
      content: rolePing || undefined,
      embeds: [alertEmbed],
    });

    logger.info(
      { guildId, userId, adultScore: visionResult.adultScore },
      "[avatarNsfwMonitor] Alert sent to logging channel"
    );
  } catch (err) {
    logger.error({ err, guildId, userId }, "[avatarNsfwMonitor] Failed to send alert");
  }
}
