// SPDX-License-Identifier: LicenseRef-ANW-1.0
// Welcome card module: handles the rich embed posted when a new member is approved.
// Separated from review.ts to keep welcome logic self-contained and testable.
import {
  APIEmbed,
  ChannelType,
  Guild,
  GuildMember,
  GuildTextBasedChannel,
  Message,
  PermissionFlagsBits,
} from "discord.js";
import { logger } from "../lib/logger.js";
import type { GuildConfig } from "../lib/config.js";

/**
 * postWelcomeCard
 * WHAT: Posts a standardized welcome card with banner attachment to the configured general channel.
 * WHY: Provides a consistent, rich welcome experience with server info, member count, and channel links.
 * PARAMS:
 *  - guild: Discord Guild instance
 *  - user: GuildMember being welcomed
 *  - config: GuildConfig with channel/role IDs
 *  - memberCount: Current server member count
 * RETURNS: The posted Message, or throws on failure.
 * THROWS: Error if channel is missing/invalid or bot lacks permissions.
 */
export async function postWelcomeCard(opts: {
  guild: Guild;
  user: GuildMember;
  config: GuildConfig;
  memberCount: number;
}): Promise<Message> {
  const { guild, user, config, memberCount } = opts;

  // 1) Validate channel configuration
  const channelId = config.general_channel_id;
  if (!channelId) {
    throw new Error("general channel not configured");
  }

  // 2) Fetch and validate channel
  let channel: GuildTextBasedChannel;
  try {
    const fetched = await guild.channels.fetch(channelId);
    if (!fetched || !fetched.isTextBased()) {
      throw new Error("general channel is not a valid text channel");
    }
    channel = fetched as GuildTextBasedChannel;
  } catch (err) {
    logger.warn({ err, guildId: guild.id, channelId }, "[welcome] failed to fetch general channel");
    throw new Error("failed to fetch general channel");
  }

  // 3) Check bot permissions in target channel
  // Pre-check all required permissions and provide a clear error message.
  // Without this, Discord API returns a generic 50013 error that's hard to debug.
  const me = guild.members.me;
  if (me) {
    const perms = channel.permissionsFor(me);
    const missingPerms: string[] = [];

    // EmbedLinks required for rich embed, AttachFiles for the banner.webp attachment
    if (!perms?.has(PermissionFlagsBits.ViewChannel)) missingPerms.push("ViewChannel");
    if (!perms?.has(PermissionFlagsBits.SendMessages)) missingPerms.push("SendMessages");
    if (!perms?.has(PermissionFlagsBits.EmbedLinks)) missingPerms.push("EmbedLinks");
    if (!perms?.has(PermissionFlagsBits.AttachFiles)) missingPerms.push("AttachFiles");

    if (missingPerms.length > 0) {
      logger.warn(
        { guildId: guild.id, channelId, missingPerms },
        "[welcome] missing permissions in general channel"
      );
      throw new Error(`missing permissions: ${missingPerms.join(", ")}`);
    }
  }

  // 4) Build message content (pings for user + optional extra role)
  const contentParts = [`<@${user.id}>`];
  if (config.welcome_ping_role_id) {
    contentParts.push(`<@&${config.welcome_ping_role_id}>`);
  }
  const content = contentParts.join(" ");

  // 5) Build description with optional Info/Rules channel links
  const descriptionLines: string[] = [
    `👋 Welcome <@${user.id}>!`,
    `This server now has **${memberCount.toLocaleString()} Users!**`,
  ];

  // Add channel links section if at least one is configured
  const infoChannelMention = config.info_channel_id ? `<#${config.info_channel_id}>` : null;
  const rulesChannelMention = config.rules_channel_id ? `<#${config.rules_channel_id}>` : null;

  if (infoChannelMention || rulesChannelMention) {
    descriptionLines.push("", "🔗 Be sure to check out:");
    if (infoChannelMention) descriptionLines.push(`• ${infoChannelMention}`);
    if (rulesChannelMention) descriptionLines.push(`• ${rulesChannelMention}`);
  }

  descriptionLines.push("", "✅ Enjoy your stay!", "", "_Bot by watchthelight._");

  // 6) Build embed matching screenshot requirements
  const embed: APIEmbed = {
    color: 0x00c2ff,
    author: {
      name: guild.name,
      icon_url: guild.iconURL({ size: 128 }) ?? undefined,
    },
    title: "Welcome to Pawtropolis 🐾",
    description: descriptionLines.join("\n"),
    thumbnail: { url: user.displayAvatarURL({ size: 128 }) },
    image: { url: "attachment://banner.webp" },
    footer: { text: "Pawtropolis Moderation Team" },
  };

  // 7) Attach banner file
  // Path is relative to working directory (project root). If the bot runs from a different cwd,
  // this will fail. Consider using __dirname or an absolute path for robustness.
  const files = [{ attachment: "./assets/banner.webp", name: "banner.webp" }];

  // 8) Send message with allowed mentions limited to the specific user and role
  // allowedMentions is a security measure: even if content contains @everyone or other role mentions,
  // Discord will only actually ping the IDs we explicitly whitelist here.
  try {
    const allowedMentions = {
      users: [user.id],
      roles: config.welcome_ping_role_id ? [config.welcome_ping_role_id] : [],
    };

    const message = await channel.send({
      content,
      embeds: [embed],
      files,
      allowedMentions,
    });

    logger.info(
      {
        guildId: guild.id,
        channelId: channel.id,
        messageId: message.id,
        userId: user.id,
      },
      "[welcome] posted welcome card"
    );

    return message;
  } catch (err) {
    logger.error(
      { err, guildId: guild.id, channelId: channel.id, userId: user.id },
      "[welcome] failed to send welcome card"
    );
    throw err;
  }
}
