/**
 * Pawtropolis Tech — src/logging/embeds.ts
 * WHAT: Embed builders for various alert types (flags, etc).
 * WHY: Centralized embed formatting for consistent visual style across alerts.
 * FLOWS:
 *  - buildFlagEmbedSilentFirstMsg({ user, joinedAt, firstMessageAt, silentDays, message })
 *    → returns EmbedBuilder for Silent-Since-Join flag alert
 * DOCS:
 *  - Discord Embeds: https://discord.js.org/#/docs/discord.js/main/class/EmbedBuilder
 *  - PR8 specification: docs/context/10_Roadmap_Open_Issues_and_Tasks.md#pr8-silent-since-join-first-message-flagger
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { EmbedBuilder, type User, type Message } from "discord.js";

export interface FlagEmbedParams {
  user: User;
  joinedAt: number;
  firstMessageAt: number;
  silentDays: number;
  message: Message;
}

/**
 * WHAT: Build flag alert embed for Silent-Since-Join detection.
 * WHY: Provides moderators with rich context for flagged accounts.
 *
 * Embed includes:
 *  - User mention and tag
 *  - Join date (timestamp)
 *  - First message date (timestamp)
 *  - Silent days (calculated delta)
 *  - Message link (jump to first message)
 *
 * @param params - FlagEmbedParams with user, timestamps, and message
 * @returns EmbedBuilder configured for Silent-Since-Join flag alert
 * @example
 * const embed = buildFlagEmbedSilentFirstMsg({
 *   user: message.author,
 *   joinedAt: 1729565000,
 *   firstMessageAt: 1737341400,
 *   silentDays: 90,
 *   message
 * });
 * await flagsChannel.send({ embeds: [embed] });
 */
export function buildFlagEmbedSilentFirstMsg(params: FlagEmbedParams): EmbedBuilder {
  const { user, joinedAt, firstMessageAt, silentDays, message } = params;

  // Format timestamps for Discord (relative + absolute)
  const joinedAtDiscord = `<t:${joinedAt}:F>`;
  const firstMessageAtDiscord = `<t:${firstMessageAt}:F>`;
  const silentDaysRelative = `<t:${firstMessageAt}:R>`;

  // Build message link (format: https://discord.com/channels/GUILD_ID/CHANNEL_ID/MESSAGE_ID)
  const messageLink = `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;

  // Build embed
  const embed = new EmbedBuilder()
    .setColor(0xed4245) // Red (warning)
    .setTitle("⚠️ Silent-Since-Join Account Flagged")
    .setDescription(
      `**User:** ${user} (${user.tag})\n` +
        `**Account ID:** \`${user.id}\`\n\n` +
        `This account was silent for **${silentDays} days** before posting their first message.`
    )
    .addFields(
      {
        name: "📅 Joined Server",
        value: joinedAtDiscord,
        inline: true,
      },
      {
        name: "💬 First Message",
        value: firstMessageAtDiscord,
        inline: true,
      },
      {
        name: "🕒 Silent Duration",
        value: `${silentDays} days`,
        inline: true,
      },
      {
        name: "🔗 First Message Link",
        value: `[Jump to message](${messageLink})`,
        inline: false,
      }
    )
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setFooter({
      text: `User ID: ${user.id} • Flagged by Silent-Since-Join Flagger (PR8)`,
    })
    .setTimestamp();

  return embed;
}
