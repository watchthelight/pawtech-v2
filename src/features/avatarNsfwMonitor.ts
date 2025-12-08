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

// 80% threshold is intentionally high to minimize false positives.
// Google Vision flags anime characters, furry art, and beach photos pretty aggressively.
// At 80%, we only catch the obvious stuff. Lower this at your own peril.
const NSFW_THRESHOLD = 0.8;

// Role to ping for NSFW avatar alerts
const NSFW_ALERT_ROLE_ID = "987662057069482024";

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
  // GOTCHA: Discord fires guildMemberUpdate for TONS of reasons (role changes, nickname,
  // status, etc). We get called on every single one. Most of the time, avatar hasn't changed.
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
  // WHY 256px? Larger = more API cost and slower. Smaller = Vision API struggles.
  // 256 is the sweet spot for NSFW detection accuracy vs performance.
  const avatarUrl = newMember.avatar
    ? newMember.displayAvatarURL({ extension: "png", size: 256 })
    : newMember.user.avatar
      ? newMember.user.displayAvatarURL({ extension: "png", size: 256 })
      : null;

  if (!avatarUrl) {
    return; // No custom avatar (default Discord avatar)
  }

  // Skip bots - they can have whatever avatar they want.
  // If a bot has an NSFW avatar, that's between the bot and its creator.
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
  // This is the expensive part. Each call costs money. If you're getting spammed
  // with avatar changes, you might want to add rate limiting per user.
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
  // Below 80% we let it slide. False positives are annoying for everyone.
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

    // Ping the designated NSFW alert role
    const rolePing = `<@&${NSFW_ALERT_ROLE_ID}>`;

    const reverseSearchUrl = googleReverseImageUrl(avatarUrl);
    // The embed is intentionally attention-grabbing. Mods need to see this.
    // If the color/emoji feels aggressive, that's by design.
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

    // Fallback: Try to DM guild owner about misconfiguration
    // This is a last-ditch effort. If logging channel is broken AND owner has DMs closed,
    // we silently fail. The NSFW user stays in the server undetected. Not ideal, but
    // there's only so much we can do when admins don't configure things properly.
    try {
      const owner = await newMember.guild.fetchOwner();
      await owner.send({
        content: `Warning: NSFW avatar detected in **${newMember.guild.name}** but failed to send alert to logging channel. Please check channel permissions and configuration.\n\nUser: <@${userId}>`,
      });
      logger.info({ guildId, ownerId: owner.id }, "[avatarNsfwMonitor] Sent fallback DM to owner");
    } catch (fallbackErr) {
      logger.debug({ err: fallbackErr, guildId }, "[avatarNsfwMonitor] Fallback DM to owner also failed");
      // At this point, just log - we've tried our best
    }
  }
}

/**
 * Scan avatar when a new member joins the server
 * WHY: Catch NSFW avatars immediately on join, not just when changed
 */
export async function handleMemberJoin(member: GuildMember): Promise<void> {
  // Skip bots
  if (member.user.bot) {
    return;
  }

  // Get avatar URL
  const avatarUrl = member.user.avatar
    ? member.user.displayAvatarURL({ extension: "png", size: 256 })
    : null;

  if (!avatarUrl) {
    return; // Default Discord avatar, no need to scan
  }

  const guildId = member.guild.id;
  const userId = member.id;

  logger.info(
    { guildId, userId },
    "[avatarNsfwMonitor] Scanning new member avatar..."
  );

  // Scan with Google Vision
  const visionResult = await detectNsfwVision(avatarUrl);

  if (!visionResult) {
    logger.warn({ guildId, userId }, "[avatarNsfwMonitor] Vision API call failed or disabled for join scan");
    return;
  }

  logger.debug(
    { guildId, userId, adultScore: visionResult.adultScore },
    "[avatarNsfwMonitor] Join scan complete"
  );

  // Check if above threshold
  if (visionResult.adultScore < NSFW_THRESHOLD) {
    return; // Clean avatar
  }

  // NSFW detected on join!
  logger.warn(
    { guildId, userId, adultScore: visionResult.adultScore },
    "[avatarNsfwMonitor] NSFW avatar detected on new member!"
  );

  // Save to database
  upsertNsfwFlag({
    guildId,
    userId,
    avatarUrl,
    nsfwScore: visionResult.adultScore,
    reason: "join_scan",
    flaggedBy: "system",
  });

  // Send alert to logging channel
  const loggingChannelId = getLoggingChannelId(guildId);
  if (!loggingChannelId) {
    logger.warn({ guildId }, "[avatarNsfwMonitor] No logging channel configured, can't send join alert");
    return;
  }

  try {
    const channel = await member.guild.channels.fetch(loggingChannelId);
    if (!channel || !channel.isTextBased()) {
      logger.warn({ guildId, loggingChannelId }, "[avatarNsfwMonitor] Logging channel not found or not text-based");
      return;
    }

    const rolePing = `<@&${NSFW_ALERT_ROLE_ID}>`;
    const reverseSearchUrl = googleReverseImageUrl(avatarUrl);

    const alertEmbed = new EmbedBuilder()
      .setTitle("🔞 NSFW Avatar Detected on Join")
      .setDescription(
        `A new member joined with a potentially NSFW avatar.\n\n` +
        `**Action Required:** Review and take appropriate action.`
      )
      .setColor(0xE74C3C) // Red
      .setThumbnail(member.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: "User", value: `${member} (\`${userId}\`)`, inline: true },
        { name: "Score", value: `${Math.round(visionResult.adultScore * 100)}%`, inline: true },
        { name: "Detection", value: "New member join", inline: true },
        { name: "Avatar", value: `[Reverse Image Search](${reverseSearchUrl})` }
      )
      .setTimestamp()
      .setFooter({ text: "Auto-detected on member join" });

    await (channel as TextChannel).send({
      content: rolePing,
      embeds: [alertEmbed],
    });

    logger.info(
      { guildId, userId, adultScore: visionResult.adultScore },
      "[avatarNsfwMonitor] Join alert sent to logging channel"
    );
  } catch (err) {
    logger.error({ err, guildId, userId }, "[avatarNsfwMonitor] Failed to send join alert");
  }
}
