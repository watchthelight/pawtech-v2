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
  // Priority 1: Guild-specific DB config
  // Priority 2: Environment variable fallback
  // Priority 3: null (console JSON logging)
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

  // Verify bot permissions
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

  // All checks passed
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
  // Single-line JSON for easy parsing by log aggregators (Datadog, Splunk, etc.)
  // Using console.log (not logger.info) to ensure it's captured by process stdout
  // without additional pino formatting that might complicate parsing
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
}
