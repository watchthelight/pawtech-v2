/**
 * Pawtropolis Tech — src/features/logger.ts
 * WHAT: Logging channel resolution with permission validation and JSON fallback.
 * WHY: Provides robust logging that degrades gracefully when Discord perms missing.
 * FLOWS:
 *  - getLoggingChannel(guild) → resolves channel with validation → null if unavailable
 *  - logActionWithFallback(guild, params) → tries embed → falls back to JSON console
 * DOCS:
 *  - Discord Permissions: https://discord.js.org/#/docs/discord.js/main/class/PermissionsBitField
 *  - Channel: https://discord.js.org/#/docs/discord.js/main/class/Channel
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Guild, TextChannel } from "discord.js";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { getLoggingChannelId } from "../config/loggingStore.js";
import { logger } from "../lib/logger.js";
import { touchSyncMarker } from "../lib/syncMarker.js";

/**
 * WHAT: Resolve and validate logging channel for a guild.
 * WHY: Ensures bot has permissions before attempting to post embeds.
 * HOW:
 *  1. Check guild_config.logging_channel_id (DB)
 *  2. Fall back to process.env.LOGGING_CHANNEL
 *  3. Validate channel exists and bot has SendMessages + EmbedLinks perms
 *  4. Return null if unavailable/invalid
 *
 * @param guild - Discord guild
 * @returns TextChannel if valid, null otherwise
 * @example
 * const channel = await getLoggingChannel(guild);
 * if (channel) {
 *   await channel.send({ embeds: [embed] });
 * } else {
 *   console.log(JSON.stringify({ action, timestamp, ... }));
 * }
 */
export async function getLoggingChannel(guild: Guild): Promise<TextChannel | null> {
  // Resolution order: DB config > env var > null.
  // The fallback chain ensures logging works during initial setup (before DB config)
  // and degrades gracefully to console when Discord is unavailable.
  const channelId = getLoggingChannelId(guild.id);

  if (!channelId) {
    logger.debug({ guildId: guild.id }, "[logger] no logging channel configured (DB or env)");
    return null;
  }

  // Fetch channel from Discord API
  let channel;
  try {
    channel = await guild.channels.fetch(channelId);
  } catch (err) {
    logger.warn(
      { err, guildId: guild.id, channelId },
      "[logger] failed to fetch logging channel - may have been deleted"
    );
    return null;
  }

  // Verify channel is text-based
  if (!channel || !channel.isTextBased() || channel.type !== ChannelType.GuildText) {
    logger.warn(
      { guildId: guild.id, channelId, type: channel?.type },
      "[logger] logging channel is not a guild text channel"
    );
    return null;
  }

  // Permission validation before attempting to post.
  // This prevents silent failures where we think logging is working but embeds
  // are just getting dropped due to missing perms.
  const textChannel = channel as TextChannel;
  const botMember = guild.members.me;
  if (!botMember) {
    logger.warn({ guildId: guild.id, channelId }, "[logger] bot member not found in guild");
    return null;
  }

  const permissions = textChannel.permissionsFor(botMember);
  if (!permissions) {
    logger.warn(
      { guildId: guild.id, channelId },
      "[logger] unable to check permissions for logging channel"
    );
    return null;
  }

  // SendMessages + EmbedLinks are the minimum for our audit embeds.
  // We don't need AttachFiles since we don't attach anything to log messages.
  const requiredPerms = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

  const missingPerms = requiredPerms.filter((perm) => !permissions.has(perm));

  if (missingPerms.length > 0) {
    logger.warn(
      {
        guildId: guild.id,
        channelId,
        missingPerms: missingPerms.map((p) => p.toString()),
      },
      "[logger] bot lacks required permissions in logging channel"
    );
    return null;
  }

  return textChannel;
}

/**
 * WHAT: Log action to console as single-line JSON (fallback when embeds unavailable).
 * WHY: Ensures actions are still recorded even when Discord channel unavailable.
 * HOW: Emits structured JSON with all relevant fields for external log aggregation.
 *
 * @param params - Action parameters
 * @example
 * logActionJSON({
 *   action: 'approve',
 *   appId: 'app-123',
 *   moderatorId: '12345',
 *   reason: 'Looks good',
 *   timestamp: 1234567890,
 * });
 */
/**
 * Console-based fallback logger. Outputs structured JSON for log aggregation.
 *
 * Why console.log instead of logger.info? Pino adds its own envelope (timestamp,
 * pid, hostname, etc.) which can interfere with external parsing. For audit
 * events we want a clean, predictable JSON structure that tools like Datadog
 * or Splunk can parse without custom transformations.
 *
 * This is only called when Discord channel logging fails - it's the last resort.
 */
export function logActionJSON(params: {
  action: string;
  appId?: string;
  appCode?: string;
  threadId?: string;
  moderatorId: string;
  applicantId?: string;
  reason?: string;
  metadata?: Record<string, any>;
  timestamp: number;
}): void {
  console.log(
    JSON.stringify({
      level: "info",
      module: "action_log",
      ...params,
    })
  );

  logger.info(
    {
      action: params.action,
      appId: params.appId,
      moderatorId: params.moderatorId,
    },
    "[logger] action logged as JSON (embed unavailable)"
  );

  // Update sync marker for database freshness tracking
  touchSyncMarker(`action_${params.action}`);
}

/**
 * WHAT: Post audit event embed to guild logging channel.
 * WHY: Provides transparency for sensitive admin operations (e.g., /modstats reset).
 * HOW: Resolves logging channel, posts structured embed with action details.
 *
 * @param guild - Discord guild where event occurred
 * @param params - Audit event parameters
 * @example
 * await postAuditEmbed(guild, {
 *   action: 'modstats_reset',
 *   userId: '123456789',
 *   userTag: 'admin#1234',
 *   result: 'success',
 *   details: 'Cache cleared, 5 guilds affected',
 * });
 */
export async function postAuditEmbed(
  guild: Guild,
  params: {
    action: string;
    userId: string;
    userTag?: string;
    result: "success" | "denied" | "error";
    details?: string;
  }
): Promise<void> {
  const channel = await getLoggingChannel(guild);

  // If no channel available, log to console as JSON
  if (!channel) {
    console.log(
      JSON.stringify({
        level: "info",
        module: "audit_log",
        guildId: guild.id,
        timestamp: Date.now(),
        ...params,
      })
    );
    return;
  }

  // Dynamic import to avoid circular dependency issues at module load time.
  // Colors follow Discord's semantic palette: green=success, red=denied, yellow=error
  const { EmbedBuilder } = await import("discord.js");
  const color = params.result === "success" ? 0x57f287 : params.result === "denied" ? 0xed4245 : 0xfee75c;

  const embed = new EmbedBuilder()
    .setTitle(`🔐 Admin Action: ${params.action}`)
    .setColor(color)
    .addFields(
      { name: "User", value: `<@${params.userId}> (${params.userTag ?? params.userId})`, inline: true },
      { name: "Result", value: params.result.toUpperCase(), inline: true },
      { name: "Time", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
    )
    .setTimestamp();

  if (params.details) {
    embed.addFields({ name: "Details", value: params.details });
  }

  try {
    await channel.send({ embeds: [embed] });
    logger.info(
      { guildId: guild.id, action: params.action, userId: params.userId, result: params.result },
      "[logger] audit embed posted"
    );
  } catch (err) {
    logger.error({ err, guildId: guild.id, action: params.action }, "[logger] failed to post audit embed");
  }
}
