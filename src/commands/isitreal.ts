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
import { type CommandContext, withStep } from "../lib/cmdWrap.js";
import { requireMinRole, ROLE_IDS, JUNIOR_MOD_PLUS, shouldBypass, hasRoleOrAbove, postPermissionDenied } from "../lib/config.js";
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

  // Require Junior Moderator+ role
  const hasPermission = await withStep(ctx, "permission_check", async () => {
    return requireMinRole(interaction, ROLE_IDS.JUNIOR_MOD, {
      command: "isitreal",
      description: "Detects AI-generated images in a message.",
      requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.JUNIOR_MOD }],
    });
  });
  if (!hasPermission) return;

  // Defer early - API calls will take time
  await withStep(ctx, "defer", async () => {
    await interaction.deferReply({ ephemeral: true });
  });

  // Parse message ID/link from option
  const { messageId, targetMessage } = await withStep(ctx, "fetch_message", async () => {
    const messageInput = interaction.options.getString("message", true);
    const parsedId = parseMessageId(messageInput);

    if (!parsedId) {
      await interaction.editReply({
        content: "Invalid message ID or link. Provide a message ID or a Discord message link.",
      });
      return { messageId: null, targetMessage: null };
    }

    // Fetch the target message
    try {
      const msg = await channel.messages.fetch(parsedId);
      return { messageId: parsedId, targetMessage: msg };
    } catch {
      await interaction.editReply({
        content: "Could not find the specified message in this channel.",
      });
      return { messageId: parsedId, targetMessage: null };
    }
  });
  if (!targetMessage) return;

  // Extract and validate images
  const imageUrls = await withStep(ctx, "extract_images", async () => {
    const urls = extractImages(targetMessage);

    if (urls.length === 0) {
      await interaction.editReply({
        content: "No images found in the specified message.",
      });
      return null;
    }

    // 10 image limit prevents accidental API bill explosions
    if (urls.length > 10) {
      await interaction.editReply({
        content: "Too many images (max 10). Please select a message with fewer images.",
      });
      return null;
    }

    return urls;
  });
  if (!imageUrls) return;

  // Run detection on all images
  const results = await withStep(ctx, "detect_ai", async () => {
    return detectAIForImages(imageUrls, guildId);
  });

  // Build and send report embed
  await withStep(ctx, "reply", async () => {
    const embed = buildAIDetectionEmbed(results, targetMessage);
    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { guildId, userId: interaction.user.id, imageCount: imageUrls.length },
      "[isitreal] AI detection completed"
    );
  });
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

  // Permission check - requires Junior Moderator+ role (or bypass)
  const member = isGuildMember(interaction.member) ? interaction.member : null;
  const userId = interaction.user.id;
  const hasPermission = shouldBypass(userId, member) || hasRoleOrAbove(member, ROLE_IDS.JUNIOR_MOD);

  if (!hasPermission) {
    await postPermissionDenied(interaction, {
      command: "Is It Real?",
      description: "Detects AI-generated images in a message (context menu).",
      requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.JUNIOR_MOD }],
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
