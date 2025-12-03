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

// GOTCHA: joinedAt and firstMessageAt are Unix timestamps in SECONDS, not milliseconds.
// If you pass Date.now() directly, Discord will think it's the year 56000-something.
// Ask me how I know.
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
  // WHY: Discord's <t:TIMESTAMP:F> renders as localized date/time in the user's timezone.
  // This is one of the few things Discord got really right.
  const joinedAtDiscord = `<t:${joinedAt}:F>`;
  const firstMessageAtDiscord = `<t:${firstMessageAt}:F>`;
  // Note: silentDaysRelative is defined but never used below. Left it in case someone
  // wants to swap out the hardcoded "X days" for a relative timestamp later.
  const silentDaysRelative = `<t:${firstMessageAt}:R>`;

  // Build message link (format: https://discord.com/channels/GUILD_ID/CHANNEL_ID/MESSAGE_ID)
  // GOTCHA: If guildId is null (DM context), this creates a broken link.
  // Shouldn't happen for this use case, but if you copy-paste this elsewhere, heads up.
  const messageLink = `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;

  /*
   * WHY we use a builder chain instead of passing an object to the constructor:
   * The EmbedBuilder API is more forgiving about field ordering and provides
   * slightly better TypeScript inference. Also, the chained version is easier
   * to read when you have 8+ fields. Fight me.
   */
  const embed = new EmbedBuilder()
    .setColor(0xed4245) // Red (warning) - Discord's built-in danger color
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
    // Size 128 is a reasonable middle ground. Larger sizes slow down embed rendering
    // on mobile, smaller sizes make it hard to ID the user. We're not running CSI Miami.
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setFooter({
      // Including the user ID in the footer is redundant (it's in the description too)
      // but mods appreciate being able to copy it from either place. Mods are busy people.
      text: `User ID: ${user.id} • Flagged by Silent-Since-Join Flagger (PR8)`,
    })
    // setTimestamp() with no args uses the current time, not the message time.
    // This is intentional - we want to know when the FLAG was created, not the message.
    .setTimestamp();

  return embed;
}
