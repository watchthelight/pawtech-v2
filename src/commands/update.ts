/**
 * Pawtropolis Tech — src/commands/update.ts
 * WHAT: /update command with activity, status, banner, and avatar subcommands
 * WHY: Centralized control over bot appearance and presence
 * FLOWS:
 *  - /update activity: Sets activity with type (Playing/Watching/Listening/Competing)
 *  - /update status: Sets custom status (the green text below username)
 *  - /update banner: Updates bot profile banner, gate message, welcome message, and website
 *  - /update avatar: Updates bot profile picture (supports static images and animated GIFs)
 * DOCS:
 *  - Activities: https://discord.js.org/#/docs/discord.js/main/typedef/ActivitiesOptions
 *  - Custom Status: Use ActivityType.Custom with state field
 *  - User.setAvatar: https://discord.js.org/#/docs/discord.js/main/class/ClientUser?scrollTo=setAvatar
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ActivityType,
  MessageFlags,
} from "discord.js";
import { requireStaff } from "../lib/config.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";
import { upsertStatus, getStatus } from "../features/statusStore.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../lib/logger.js";
import sharp from "sharp";

export const data = new SlashCommandBuilder()
  .setName("update")
  .setDescription("Update bot activity, status, banner, or avatar")
  .addSubcommand((sub) =>
    sub
      .setName("activity")
      .setDescription("Update bot activity (Playing, Watching, etc.)")
      .addStringOption((option) =>
        option
          .setName("type")
          .setDescription("Activity type")
          .setRequired(true)
          .addChoices(
            { name: "Playing", value: "playing" },
            { name: "Watching", value: "watching" },
            { name: "Listening to", value: "listening" },
            { name: "Competing in", value: "competing" }
          )
      )
      .addStringOption((option) =>
        option
          .setName("text")
          .setDescription("Activity text")
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(128)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Update bot custom status (green text below name)")
      .addStringOption((option) =>
        option
          .setName("text")
          .setDescription("Status text")
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(128)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("banner")
      .setDescription("Update bot profile, gate, welcome, and website banners")
      .addAttachmentOption((option) =>
        option
          .setName("image")
          .setDescription("Banner image (PNG/JPG/WebP, max 10MB, 16:9 recommended)")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("avatar")
      .setDescription("Update bot profile picture")
      .addAttachmentOption((option) =>
        option
          .setName("image")
          .setDescription("Avatar image (PNG/JPG/WebP/GIF, max 10MB, square recommended)")
          .setRequired(true)
      )
  );

const ACTIVITY_TYPE_MAP: Record<string, ActivityType> = {
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
};

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  ctx.step("permission_check");
  if (!requireStaff(interaction)) return;

  const subcommand = interaction.options.getSubcommand();

  const user = await withStep(ctx, "load_bot_user", async () => interaction.client.user);
  if (!user) {
    await withStep(ctx, "reply_missing_user", async () => {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "Bot user missing.",
      });
    });
    return;
  }

  if (subcommand === "activity") {
    await handleActivityUpdate(ctx, user);
  } else if (subcommand === "status") {
    await handleStatusUpdate(ctx, user);
  } else if (subcommand === "banner") {
    await handleBannerUpdate(ctx);
  } else if (subcommand === "avatar") {
    await handleAvatarUpdate(ctx);
  }
}

async function handleActivityUpdate(
  ctx: CommandContext<ChatInputCommandInteraction>,
  user: NonNullable<ChatInputCommandInteraction["client"]["user"]>
) {
  const { interaction } = ctx;

  const activityTypeStr = await withStep(ctx, "validate_type", async () =>
    interaction.options.getString("type", true)
  );
  const text = await withStep(ctx, "validate_text", async () =>
    interaction.options.getString("text", true)
  );

  const activityType = ACTIVITY_TYPE_MAP[activityTypeStr];

  await withStep(ctx, "update_presence", async () => {
    // Get existing status to preserve custom status if it exists
    const saved = getStatus("global");
    const activities = [];

    // Add the regular activity
    activities.push({ name: text, type: activityType });

    // Preserve custom status if it exists (Custom type uses 'name' field)
    if (saved?.customStatus) {
      activities.push({ type: ActivityType.Custom, name: saved.customStatus });
    }

    await user.setPresence({
      activities,
      status: "online",
    });
  });

  await withStep(ctx, "persist_status", async () => {
    // Get existing saved status to preserve custom status
    const saved = getStatus("global");

    upsertStatus({
      scopeKey: "global",
      activityType,
      activityText: text,
      customStatus: saved?.customStatus ?? null,
      status: "online",
      updatedAt: Date.now(),
    });
  });

  await withStep(ctx, "final_reply", async () => {
    // Capitalize the activity type for display
    const displayType = activityTypeStr.charAt(0).toUpperCase() + activityTypeStr.slice(1);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `Activity updated to: **${displayType}** "${text}" (saved for restarts).`,
    });
  });
}

async function handleStatusUpdate(
  ctx: CommandContext<ChatInputCommandInteraction>,
  user: NonNullable<ChatInputCommandInteraction["client"]["user"]>
) {
  const { interaction } = ctx;

  const text = await withStep(ctx, "validate_text", async () =>
    interaction.options.getString("text", true)
  );

  await withStep(ctx, "update_presence", async () => {
    // Get existing status to preserve activity if it exists
    const saved = getStatus("global");
    const activities = [];

    // Preserve regular activity if it exists
    if (saved?.activityType !== null && saved?.activityText) {
      activities.push({ type: saved.activityType, name: saved.activityText });
    }

    // Add custom status (Custom type uses 'name' field for the status text)
    activities.push({ type: ActivityType.Custom, name: text });

    await user.setPresence({
      activities,
      status: "online",
    });
  });

  await withStep(ctx, "persist_status", async () => {
    // Get existing saved status to preserve activity
    const saved = getStatus("global");

    upsertStatus({
      scopeKey: "global",
      activityType: saved?.activityType ?? null,
      activityText: saved?.activityText ?? null,
      customStatus: text,
      status: "online",
      updatedAt: Date.now(),
    });
  });

  await withStep(ctx, "final_reply", async () => {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `Custom status updated to: "${text}" (saved for restarts).`,
    });
  });
}

async function handleBannerUpdate(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  // Defer reply since image processing takes time
  await withStep(ctx, "defer_reply", async () => {
    await interaction.deferReply();
  });

  // Get attachment
  const attachment = await withStep(ctx, "validate_attachment", async () => {
    const att = interaction.options.getAttachment("image", true);

    // Validate file type
    if (!att.contentType?.startsWith("image/")) {
      throw new Error("Attachment must be an image");
    }

    // Validate file size (10MB limit)
    if (att.size > 10 * 1024 * 1024) {
      throw new Error("Image must be less than 10MB");
    }

    return att;
  });

  // Download image
  const imageBuffer = await withStep(ctx, "download_image", async () => {
    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  });

  // Process images (PNG and WebP)
  const [pngBuffer, webpBuffer] = await withStep(ctx, "process_images", async () => {
    // Convert to PNG (high quality for guild banner)
    const png = await sharp(imageBuffer).png({ quality: 100, compressionLevel: 6 }).toBuffer();

    // Convert to WebP (optimized for embeds)
    const webp = await sharp(imageBuffer)
      .resize({ width: 1280, height: 720, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();

    return [png, webp];
  });

  // Save files to assets folder
  await withStep(ctx, "save_files", async () => {
    const assetsPath = join(process.cwd(), "assets");
    writeFileSync(join(assetsPath, "banner.png"), pngBuffer);
    writeFileSync(join(assetsPath, "banner.webp"), webpBuffer);
    logger.info({ pngSize: pngBuffer.length, webpSize: webpBuffer.length }, "Banner files saved");
  });

  // Update bot profile banner directly
  await withStep(ctx, "update_bot_banner", async () => {
    if (!interaction.client.user) {
      throw new Error("Bot user not available");
    }

    await interaction.client.user.setBanner(pngBuffer);
    logger.info("Bot profile banner updated");
  });

  // Refresh gate entry message with new banner
  await withStep(ctx, "refresh_gate_message", async () => {
    if (!interaction.guildId) return;

    try {
      const { ensureGateEntry } = await import("../features/gate.js");
      const result = await ensureGateEntry(ctx, interaction.guildId);

      if (result.messageId) {
        logger.info(
          { guildId: interaction.guildId, messageId: result.messageId, created: result.created, edited: result.edited },
          "Gate entry message refreshed with new banner"
        );
      }
    } catch (err) {
      logger.warn(
        { err, guildId: interaction.guildId },
        "Failed to refresh gate message (non-fatal)"
      );
    }
  });

  await withStep(ctx, "final_reply", async () => {
    await interaction.editReply({
      content: [
        "✅ Banner updated successfully!",
        "",
        "**Updated:**",
        "• Bot profile banner (visible immediately)",
        "• Gate verification message (refreshed)",
        "• Welcome message banner (next member join)",
        "• Website background (via API)",
        "• `assets/banner.png` (saved)",
        "• `assets/banner.webp` (saved)",
        "",
        "**Note:** Discord server banner is managed separately via Server Settings.",
      ].join("\n"),
    });
  });
}

async function handleAvatarUpdate(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  // Defer reply since image processing takes time
  await withStep(ctx, "defer_reply", async () => {
    await interaction.deferReply();
  });

  // Get attachment
  const attachment = await withStep(ctx, "validate_attachment", async () => {
    const att = interaction.options.getAttachment("image", true);

    // Validate file type (allow GIF for animated avatars)
    if (!att.contentType?.startsWith("image/")) {
      throw new Error("Attachment must be an image");
    }

    // Validate file size (10MB limit)
    if (att.size > 10 * 1024 * 1024) {
      throw new Error("Image must be less than 10MB");
    }

    return att;
  });

  // Download image
  const imageBuffer = await withStep(ctx, "download_image", async () => {
    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  });

  // Process image - keep GIFs as-is, convert others to PNG
  const avatarBuffer = await withStep(ctx, "process_image", async () => {
    // If it's a GIF, keep it as-is for animation
    if (attachment.contentType === "image/gif") {
      logger.info("Keeping GIF format for animated avatar");
      return imageBuffer;
    }

    // Convert to PNG for static images
    const png = await sharp(imageBuffer)
      .resize({ width: 1024, height: 1024, fit: "cover", position: "center" })
      .png({ quality: 100, compressionLevel: 6 })
      .toBuffer();

    logger.info({ originalSize: imageBuffer.length, pngSize: png.length }, "Avatar processed to PNG");
    return png;
  });

  // Update bot avatar
  await withStep(ctx, "update_bot_avatar", async () => {
    if (!interaction.client.user) {
      throw new Error("Bot user not available");
    }

    await interaction.client.user.setAvatar(avatarBuffer);
    logger.info({ size: avatarBuffer.length, isGif: attachment.contentType === "image/gif" }, "Bot avatar updated");
  });

  await withStep(ctx, "final_reply", async () => {
    const isAnimated = attachment.contentType === "image/gif";
    await interaction.editReply({
      content: [
        "✅ Avatar updated successfully!",
        "",
        "**Updated:**",
        `• Bot profile picture (${isAnimated ? "animated GIF" : "static image"})`,
        "• Visible immediately across all servers",
        "",
        "**Note:** Avatar changes may take a few minutes to propagate across Discord.",
      ].join("\n"),
    });
  });
}
