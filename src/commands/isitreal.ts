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
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { type CommandContext } from "../lib/cmdWrap.js";
import { requireStaff } from "../lib/config.js";
import { detectAIForImages, buildAIDetectionEmbed } from "../features/aiDetection/index.js";

export const data = new SlashCommandBuilder()
  .setName("isitreal")
  .setDescription("Detect AI-generated images in a message")
  .addStringOption((opt) =>
    opt
      .setName("message")
      .setDescription("Message ID or link containing images to scan")
      .setRequired(true)
  );

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
  if (!requireStaff(interaction)) return;

  // Defer early - API calls will take time
  await interaction.deferReply({ ephemeral: true });

  // Parse message ID/link from option
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

  if (imageUrls.length > 10) {
    await interaction.editReply({
      content: "Too many images (max 10). Please select a message with fewer images.",
    });
    return;
  }

  // Run detection on all images
  const results = await detectAIForImages(imageUrls);

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
