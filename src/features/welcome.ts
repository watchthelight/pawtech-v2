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
  // GOTCHA: guild.channels.fetch() can return null even for valid IDs if the bot
  // was recently added or the cache is cold. The isTextBased() check is necessary
  // because Voice channels also have IDs that look identical to text channel IDs.
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
    // WHY check all four? Because Discord's error messages are useless. If you're missing
    // EmbedLinks, the API just says "Missing Permissions" with no indication of which one.
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
  // The ping happens here in content, NOT in the embed description. This is intentional:
  // Discord only sends notifications for mentions in the content field, not embed text.
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
  // Using APIEmbed (plain object) instead of EmbedBuilder because we're constructing
  // a static embed. EmbedBuilder is overkill when you're not chaining methods.
  const embed: APIEmbed = {
    color: 0x00c2ff,  // This cyan matches the brand. Don't change it on a whim.
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
  // GOTCHA: The file is sent with every welcome message. If the server is busy with approvals,
  // this could be a lot of bandwidth. Discord does CDN the attachment, but the upload happens
  // every time. For a high-volume server, consider hosting the banner externally and using a URL.
  const files = [{ attachment: "./assets/banner.webp", name: "banner.webp" }];

  // 8) Send message with allowed mentions limited to the specific user and role
  // allowedMentions is a security measure: even if content contains @everyone or other role mentions,
  // Discord will only actually ping the IDs we explicitly whitelist here.
  const allowedMentions = {
    users: [user.id],
    roles: config.welcome_ping_role_id ? [config.welcome_ping_role_id] : [],
  };

  // Retry logic for transient network errors (e.g., SocketError: other side closed)
  // Discord's API can sometimes close connections unexpectedly; a simple retry usually succeeds.
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 500;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
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
          attempt,
        },
        "[welcome] posted welcome card"
      );

      return message;
    } catch (err) {
      lastError = err;
      const isRetryable = isTransientError(err);

      if (isRetryable && attempt < MAX_RETRIES) {
        logger.warn(
          { err, guildId: guild.id, channelId: channel.id, userId: user.id, attempt },
          "[welcome] transient error, retrying..."
        );
        await sleep(RETRY_DELAY_MS * attempt); // Linear backoff: 500ms, 1000ms, 1500ms
        continue;
      }

      logger.error(
        { err, guildId: guild.id, channelId: channel.id, userId: user.id, attempt },
        "[welcome] failed to send welcome card"
      );
      throw err;
    }
  }

  // Should not reach here, but TypeScript needs this for exhaustiveness
  throw lastError;
}

/**
 * Checks if an error is a transient network error that should be retried.
 * Common transient errors from undici/Discord:
 * - SocketError: other side closed (UND_ERR_SOCKET)
 * - ConnectTimeoutError (UND_ERR_CONNECT_TIMEOUT)
 * - HeadersTimeoutError (UND_ERR_HEADERS_TIMEOUT)
 */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // Check for undici socket errors
  const code = (err as Error & { code?: string }).code;
  if (code?.startsWith("UND_ERR_")) return true;

  // Check for common transient error messages
  const msg = err.message.toLowerCase();
  return (
    msg.includes("other side closed") ||
    msg.includes("socket hang up") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused")
  );
}

/** Simple sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
