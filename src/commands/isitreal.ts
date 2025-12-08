/**
 * Pawtropolis Tech — src/commands/isitreal.ts
 * WHAT: Detect AI-generated images in a message using multiple detection APIs.
 * WHY: Helps moderators identify potentially AI-generated content.
 * FLOWS:
 *  - User provides message ID or link
 *  - Extracts images from attachments and embeds
 *  - Calls 4 AI detection APIs in parallel
 *  - Shows ephemeral report with per-service scores and average
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  type ChatInputCommandInteraction,
  type MessageContextMenuCommandInteraction,
  type Message,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { type CommandContext } from "../lib/cmdWrap.js";
import { requireStaff, canRunAllCommands, hasManageGuild, isReviewer, postPermissionDenied } from "../lib/config.js";
import { detectAIForImages, buildAIDetectionEmbed } from "../features/aiDetection/index.js";
import { isGuildMember } from "../lib/typeGuards.js";

/*
 * No subcommands here - just a single message option. The command is designed
 * for quick spot-checks during review, not batch processing.
 *
 * GOTCHA: API rate limits apply. Running this on every submission would burn
 * through quotas fast. Reserved for suspicious cases only.
 */
export const data = new SlashCommandBuilder()
  .setName("isitreal")
  .setDescription("Detect AI-generated images in a message")
  .addStringOption((opt) =>
    opt
      .setName("message")
      .setDescription("Message ID or link containing images to scan")
      .setRequired(true)
  );

export const isitRealContextMenu = new ContextMenuCommandBuilder()
  .setName("Is It Real?")
  .setType(ApplicationCommandType.Message)
  .setDMPermission(false);

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const { guildId, guild, channel } = interaction;

  if (!guildId || !guild || !channel || !channel.isTextBased()) {
    await interaction.reply({
      content: "This command can only be used in a server text channel.",
      ephemeral: true,
    });
    return;
  }

  // Permission check - uses mod_role_ids from guild config
  if (!requireStaff(interaction, {
    command: "isitreal",
    description: "Detects AI-generated images in a message.",
    requirements: [
      { type: "config", field: "mod_role_ids" },
      { type: "config", field: "reviewer_role_id" },
    ],
  })) return;

  // Defer early - API calls will take time
  await interaction.deferReply({ ephemeral: true });

  // Parse message ID/link from option
  // Accepts either raw snowflake ID or full Discord message URL
  // (the latter is what you get when you right-click -> Copy Message Link)
  const messageInput = interaction.options.getString("message", true);
  const messageId = parseMessageId(messageInput);

  if (!messageId) {
    await interaction.editReply({
      content: "Invalid message ID or link. Provide a message ID or a Discord message link.",
    });
    return;
  }

  // Fetch the target message
  let targetMessage: Message;
  try {
    targetMessage = await channel.messages.fetch(messageId);
  } catch {
    await interaction.editReply({
      content: "Could not find the specified message in this channel.",
    });
    return;
  }

  // Extract images from attachments and embeds
  const imageUrls = extractImages(targetMessage);

  if (imageUrls.length === 0) {
    await interaction.editReply({
      content: "No images found in the specified message.",
    });
    return;
  }

  // 10 image limit prevents accidental API bill explosions. Each image hits
  // 4 external services. 10 images = 40 API calls. Someone pastes a 50-image
  // gallery and suddenly we're broke. Ask me how I know.
  if (imageUrls.length > 10) {
    await interaction.editReply({
      content: "Too many images (max 10). Please select a message with fewer images.",
    });
    return;
  }

  // Run detection on all images (only enabled services for this guild)
  const results = await detectAIForImages(imageUrls, guildId);

  // Build and send report embed
  const embed = buildAIDetectionEmbed(results, targetMessage);
  await interaction.editReply({ embeds: [embed] });

  logger.info(
    { guildId, userId: interaction.user.id, imageCount: imageUrls.length },
    "[isitreal] AI detection completed"
  );
}

/**
 * Parse a message ID from direct ID or Discord message link.
 *
 * WHY two formats: Users copy-paste message links from Discord's context menu,
 * but power users might just type the ID directly. Supporting both costs us
 * one regex and saves support tickets.
 */
function parseMessageId(input: string): string | null {
  // Handle direct ID (17-20 digit snowflake)
  if (/^\d{17,20}$/.test(input)) {
    return input;
  }

  // Handle Discord message link
  // Format: https://discord.com/channels/{guild}/{channel}/{message}
  const linkMatch = input.match(/discord\.com\/channels\/\d+\/\d+\/(\d+)/);
  if (linkMatch) {
    return linkMatch[1];
  }

  return null;
}

/**
 * Extract image URLs from a message's attachments and embeds.
 *
 * Two sources because Discord handles images differently:
 * - Attachments: Direct uploads via the paperclip button
 * - Embeds: URLs pasted in chat that Discord auto-previews
 *
 * We grab both because AI art shows up either way.
 */
function extractImages(message: Message): Array<{ url: string; name: string }> {
  const images: Array<{ url: string; name: string }> = [];

  // From attachments
  for (const att of message.attachments.values()) {
    if (att.contentType?.startsWith("image/")) {
      images.push({ url: att.url, name: att.name || "attachment" });
    }
  }

  // From embeds (for linked images)
  for (const embed of message.embeds) {
    if (embed.image?.url) {
      images.push({ url: embed.image.url, name: "embedded image" });
    }
    if (embed.thumbnail?.url) {
      images.push({ url: embed.thumbnail.url, name: "thumbnail" });
    }
  }

  return images;
}

/**
 * Handle the "Is It Real?" context menu command.
 *
 * WHY context menu: Faster workflow than typing /isitreal and pasting message link.
 * Right-click -> Is It Real? -> Done. Shaves seconds off each check, which adds up
 * when you're reviewing dozens of submissions.
 */
export async function handleIsItRealContextMenu(
  interaction: MessageContextMenuCommandInteraction
) {
  const { guildId, guild } = interaction;
  const targetMessage = interaction.targetMessage;

  if (!guildId || !guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Permission check - uses mod_role_ids from guild config
  const member = isGuildMember(interaction.member) ? interaction.member : null;
  const hasPermission =
    canRunAllCommands(member, guildId) ||
    hasManageGuild(member) ||
    isReviewer(guildId, member);

  if (!hasPermission) {
    await postPermissionDenied(interaction, {
      command: "Is It Real?",
      description: "Detects AI-generated images in a message (context menu).",
      requirements: [
        { type: "config", field: "mod_role_ids" },
        { type: "config", field: "reviewer_role_id" },
      ],
    });
    return;
  }

  // Defer early - API calls will take time
  await interaction.deferReply({ ephemeral: true });

  // Extract images from attachments and embeds
  const imageUrls = extractImages(targetMessage);

  if (imageUrls.length === 0) {
    await interaction.editReply({
      content: "No images found in this message.",
    });
    return;
  }

  if (imageUrls.length > 10) {
    await interaction.editReply({
      content: "Too many images (max 10). Please select a message with fewer images.",
    });
    return;
  }

  // Run detection on all images (only enabled services for this guild)
  const results = await detectAIForImages(imageUrls, guildId);

  // Build and send report embed
  const embed = buildAIDetectionEmbed(results, targetMessage);
  await interaction.editReply({ embeds: [embed] });

  logger.info(
    { guildId, userId: interaction.user.id, imageCount: imageUrls.length },
    "[isitreal] AI detection completed via context menu"
  );
}
