/**
 * Pawtropolis Tech — src/commands/send.ts
 * WHAT: Anonymous /send command for staff to post messages as the bot.
 * WHY: Allows moderation team to communicate anonymously without revealing identity.
 * FLOWS:
 *  - /send message:"text" → bot posts in same channel, replies "Sent ✅" ephemerally
 *  - Supports embeds, replies, attachments, and configurable mention blocking
 *  - Logs to audit channel if configured (LOGGING_CHANNEL or LOGGING_CHANNEL_ID)
 * DOCS:
 *  - SlashCommandBuilder: https://discord.js.org/#/docs/builders/main/class/SlashCommandBuilder
 *  - ChatInputCommandInteraction: https://discord.js.org/#/docs/discord.js/main/class/ChatInputCommandInteraction
 *  - Embeds: https://discord.js.org/#/docs/discord.js/main/class/EmbedBuilder
 *  - AllowedMentions: https://discord.com/developers/docs/resources/channel#allowed-mentions-object
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  TextChannel,
  ChannelType,
  MessageCreateOptions,
  Message,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { isOwner } from "../utils/owner.js";
import { SAFE_ALLOWED_MENTIONS } from "../lib/constants.js";

// Discord API hard limits. Exceeding these causes 400 Bad Request.
// The embed limit is particularly useful for longer announcements.
const MAX_PLAIN_MESSAGE_LENGTH = 2000;
const MAX_EMBED_DESCRIPTION_LENGTH = 4096;
const AUDIT_LOG_PREVIEW_LENGTH = 512; // Truncate for readability in audit logs

/**
 * Command data builder
 * Default permission: ManageMessages (allows staff to use /send)
 */
export const data = new SlashCommandBuilder()
  .setName("send")
  .setDescription("Post an anonymous message as the bot in this channel.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addStringOption((option) =>
    option.setName("message").setDescription("Content to send").setRequired(true)
  )
  .addBooleanOption((option) =>
    option.setName("embed").setDescription("Send as an embed (default: false)").setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("reply_to")
      .setDescription("Message ID to reply to in this channel")
      .setRequired(false)
  )
  .addAttachmentOption((option) =>
    option.setName("attachment").setDescription("Include a file or image").setRequired(false)
  )
  .addBooleanOption((option) =>
    option.setName("silent").setDescription("Block all mentions (default: true)").setRequired(false)
  );

/**
 * WHAT: Check if invoker has required role (if SEND_ALLOWED_ROLE_IDS is set).
 * WHY: Additional access control beyond ManageMessages permission.
 *
 * @param interaction - Command interaction
 * @returns true if allowed, false if denied
 */
function checkRoleAccess(interaction: ChatInputCommandInteraction): boolean {
  // Owner bypass - useful for debugging without needing server roles
  if (isOwner(interaction.user.id)) {
    return true;
  }

  const allowedRoleIds = process.env.SEND_ALLOWED_ROLE_IDS;

  // If SEND_ALLOWED_ROLE_IDS isn't set, we rely solely on ManageMessages permission.
  // This is the default behavior for most servers.
  if (!allowedRoleIds) {
    return true;
  }

  // Parse comma-separated role IDs (e.g., "123,456,789")
  const roleIds = allowedRoleIds.split(",").map((id) => id.trim());

  // Type narrowing: interaction.member can be APIInteractionGuildMember (no roles cache)
  // or GuildMember (has roles.cache). We need the latter.
  if (interaction.member && "roles" in interaction.member) {
    const memberRoles = interaction.member.roles as { cache: Map<string, any> };
    const hasRole = roleIds.some((roleId) => memberRoles.cache.has(roleId));
    return hasRole;
  }

  // Can't verify roles (shouldn't happen in guild context) - fail closed
  return false;
}

/**
 * WHAT: Neutralize mass ping mentions (@everyone, @here).
 * WHY: Prevents abuse even when silent:false allows user/role mentions.
 * HOW: Inserts zero-width space (U+200B) to break Discord's mention parsing.
 *
 * @param content - Message content
 * @returns Sanitized content
 */
function neutralizeMassPings(content: string): string {
  // Zero-width space (U+200B) breaks Discord's mention parser while remaining invisible.
  // This runs even when silent:false because @everyone/@here are too dangerous to allow
  // through an anonymous command - could be used for social engineering.
  return content.replace(/@everyone/g, "@\u200beveryone").replace(/@here/g, "@\u200bhere");
}

/**
 * WHAT: Send audit log embed to configured logging channel.
 * WHY: Track anonymous message usage for moderation accountability.
 *
 * @param interaction - Command interaction
 * @param messageContent - Content that was posted
 * @param useEmbed - Whether message was sent as embed
 * @param silent - Whether mentions were blocked
 */
async function sendAuditLog(
  interaction: ChatInputCommandInteraction,
  messageContent: string,
  useEmbed: boolean,
  silent: boolean
): Promise<void> {
  // Check for logging channel in env (support both variable names)
  const loggingChannelId = process.env.LOGGING_CHANNEL || process.env.LOGGING_CHANNEL_ID;

  if (!loggingChannelId) {
    return; // No logging configured, skip silently
  }

  try {
    const loggingChannel = await interaction.client.channels.fetch(loggingChannelId);

    if (!loggingChannel || loggingChannel.type !== ChannelType.GuildText) {
      console.warn(`[send] Logging channel ${loggingChannelId} is not a text channel`);
      return;
    }

    // Truncate message preview for audit log
    let preview = messageContent;
    if (preview.length > AUDIT_LOG_PREVIEW_LENGTH) {
      preview = preview.substring(0, AUDIT_LOG_PREVIEW_LENGTH) + " …";
    }

    // Audit log reveals the invoker - this is the accountability mechanism.
    // Without this, /send would be ripe for abuse.
    const auditEmbed = new EmbedBuilder()
      .setTitle("🔇 Anonymous /send used")
      .setDescription(preview)
      .addFields(
        {
          name: "Channel",
          value: `<#${interaction.channelId}>`,
          inline: true,
        },
        {
          name: "Invoker",
          value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`,
          inline: true,
        },
        { name: "Embed Mode", value: useEmbed ? "✅ Yes" : "❌ No", inline: true },
        { name: "Silent", value: silent ? "✅ Yes" : "❌ No", inline: true }
      )
      .setTimestamp()
      .setColor(0x5865f2);

    await (loggingChannel as TextChannel).send({
      embeds: [auditEmbed],
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
  } catch (err) {
    // Log error but don't fail the command - audit logging is best-effort
    console.warn(`[send] Failed to send audit log: ${err}`);
  }
}

/**
 * WHAT: Execute /send command - post anonymous message as bot.
 * WHY: Allows staff to communicate without revealing their identity.
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;

  // Guild-only command (ensured by defaultMemberPermissions but good to validate)
  if (!interaction.guild || !interaction.channel) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Additional role-based access control (if configured)
  if (!checkRoleAccess(interaction)) {
    await interaction.reply({
      content:
        "❌ You do not have the required role to use this command. Contact an administrator if you believe this is an error.",
      ephemeral: true,
    });
    return;
  }

  // Parse command options
  const rawMessage = interaction.options.getString("message", true);
  const useEmbed = interaction.options.getBoolean("embed") ?? false;
  const replyToId = interaction.options.getString("reply_to");
  const attachment = interaction.options.getAttachment("attachment");
  const silent = interaction.options.getBoolean("silent") ?? true; // Default: block all mentions

  // Neutralize mass pings (@everyone, @here) regardless of silent flag
  const sanitizedMessage = neutralizeMassPings(rawMessage);

  // Validate message length against Discord limits
  const maxLength = useEmbed ? MAX_EMBED_DESCRIPTION_LENGTH : MAX_PLAIN_MESSAGE_LENGTH;

  if (sanitizedMessage.length > maxLength) {
    const hint = useEmbed
      ? "Embed descriptions have a 4096 character limit. Please shorten your message."
      : "Messages have a 2000 character limit. Try using `embed:true` (4096 char limit) or shorten your message.";

    await interaction.reply({
      content: `❌ Message too long (${sanitizedMessage.length}/${maxLength} characters).\n\n${hint}`,
      ephemeral: true,
    });
    return;
  }

  // Build message payload with mention controls.
  // Note: allowedMentions is processed server-side, so even if someone
  // bypasses the client, Discord won't actually ping.
  const messagePayload: MessageCreateOptions = {
    allowedMentions: silent
      ? { parse: [], repliedUser: false } // Block all mentions including reply ping
      : { parse: ["users", "roles"], repliedUser: false }, // Allow @user and @role but never @everyone/@here
  };

  // Add content (plain or embed)
  if (useEmbed) {
    const embed = new EmbedBuilder().setDescription(sanitizedMessage).setColor(0x5865f2); // Discord blurple
    messagePayload.embeds = [embed];
  } else {
    messagePayload.content = sanitizedMessage;
  }

  // Add attachment if provided
  if (attachment) {
    messagePayload.files = [attachment];
  }

  // Defer reply immediately - message fetch and send can be slow
  await interaction.deferReply({ ephemeral: true });

  // Reply threading: if reply_to is specified, we try to make this message
  // a reply to that message. This preserves context in conversations.
  let replyToMessage: Message | null = null;
  if (replyToId) {
    try {
      replyToMessage = await (interaction.channel as TextChannel).messages.fetch(replyToId);
      messagePayload.reply = {
        messageReference: replyToMessage.id,
        failIfNotExists: false, // If message was deleted between command and send, just post normally
      };
    } catch (err) {
      // Message doesn't exist or bot can't see it. Silent fallback - don't bother
      // the user with an error for a convenience feature.
      console.warn(`[send] Failed to fetch reply_to message ${replyToId}: ${err}`);
    }
  }

  // Send the anonymous message
  try {
    await (interaction.channel as TextChannel).send(messagePayload);

    // Acknowledge to invoker ephemerally (never reveals identity in public)
    await interaction.editReply({
      content: "Sent ✅",
    });

    // Best-effort audit logging (non-blocking)
    sendAuditLog(interaction, sanitizedMessage, useEmbed, silent).catch(() => {});
  } catch (err) {
    // Handle send failures (permissions, channel issues, etc.)
    console.error(`[send] Failed to send message: ${err}`);
    await interaction.editReply({
      content: "❌ Failed to send message. Check bot permissions in this channel.",
    });
  }
}
