/**
 * Pawtropolis Tech — src/commands/update.ts
 * WHAT: /update command with activity, status, banner, and avatar subcommands
 * WHY: Centralized control over bot appearance and presence
 * FLOWS:
 *  - /update activity: Sets activity with type (Playing/Watching/Listening/Competing)
 *  - /update status: Sets custom status (the green text below username)
 *  - /update banner: Updates bot profile banner, gate message, and welcome message
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
import { requireMinRole, ROLE_IDS } from "../lib/config.js";
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
          .setDescription("Status text (leave empty to clear)")
          .setRequired(false)
          .setMaxLength(128)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("banner")
      .setDescription("Update bot profile, gate, and welcome banners")
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

// Maps user-friendly choice values to Discord.js ActivityType enum.
// Note: Custom status uses ActivityType.Custom but is handled separately
// because it requires the 'state' field instead of 'name'.
const ACTIVITY_TYPE_MAP: Record<string, ActivityType> = {
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
};

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  const subcommand = interaction.options.getSubcommand();

  // Different permission levels for different subcommands:
  // - activity/status: Senior Moderator+
  // - banner/avatar: Community Manager+
  ctx.step("permission_check");
  if (subcommand === "activity" || subcommand === "status") {
    if (!requireMinRole(interaction, ROLE_IDS.SENIOR_MOD, {
      command: `update ${subcommand}`,
      description: `Updates bot ${subcommand}.`,
      requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.SENIOR_MOD }],
    })) return;
  } else if (subcommand === "banner" || subcommand === "avatar") {
    if (!requireMinRole(interaction, ROLE_IDS.COMMUNITY_MANAGER, {
      command: `update ${subcommand}`,
      description: `Updates bot ${subcommand}.`,
      requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.COMMUNITY_MANAGER }],
    })) return;
  }

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
    // Discord supports multiple activities simultaneously. We combine
    // the regular activity (Playing/Watching/etc.) with the custom status
    // (the green text). Both show in the user popout.
    const saved = getStatus("global");
    const activities = [];

    activities.push({ name: text, type: activityType });

    // Preserve custom status if set. Discord shows this as a separate
    // line below the main activity.
    if (saved?.customStatus) {
      activities.push({ type: ActivityType.Custom, name: saved.customStatus });
    }

    await user.setPresence({
      activities,
      status: "online",
    });
  });

  await withStep(ctx, "persist_status", async () => {
    // Save to DB so presence survives bot restarts. The statusStore module
    // is loaded on startup and reapplies the saved presence.
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

  // Text is optional - null/empty means clear the status
  const text = await withStep(ctx, "validate_text", async () =>
    interaction.options.getString("text", false)
  );

  const isClearing = !text || text.trim() === "";

  await withStep(ctx, "update_presence", async () => {
    // Get existing status to preserve activity if it exists
    const saved = getStatus("global");
    const activities = [];

    // Preserve regular activity if it exists
    if (saved?.activityType !== null && saved?.activityText) {
      activities.push({ type: saved.activityType, name: saved.activityText });
    }

    // Add custom status only if we're not clearing it
    if (!isClearing) {
      activities.push({ type: ActivityType.Custom, name: text });
    }

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
      customStatus: isClearing ? null : text,
      status: "online",
      updatedAt: Date.now(),
    });
  });

  await withStep(ctx, "final_reply", async () => {
    const message = isClearing
      ? "Custom status cleared (saved for restarts)."
      : `Custom status updated to: "${text}" (saved for restarts).`;
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: message,
    });
  });
}

async function handleBannerUpdate(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  // Image processing (download + sharp conversion) can take 5-10 seconds.
  // Discord's interaction timeout is 3 seconds, so we must defer.
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

  // Process into two formats: PNG for Discord API, WebP for web embeds
  const [pngBuffer, webpBuffer] = await withStep(ctx, "process_images", async () => {
    // PNG: Full quality for Discord's profile banner endpoint.
    // Discord will re-encode anyway, but starting with lossless gives best results.
    const png = await sharp(imageBuffer).png({ quality: 100, compressionLevel: 6 }).toBuffer();

    // WebP: Smaller file for embed thumbnails and website.
    // 1280x720 is a good balance between quality and load time.
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

  // Update bot's profile banner via Discord API.
  // Note: Requires the bot account to have Nitro or be a verified bot.
  // This is different from the server banner (which requires BANNER guild feature).
  await withStep(ctx, "update_bot_banner", async () => {
    if (!interaction.client.user) {
      throw new Error("Bot user not available");
    }

    await interaction.client.user.setBanner(pngBuffer);
    logger.info("Bot profile banner updated");
  });

  // The gate entry message displays the banner. Refresh it so users
  // see the new image immediately without waiting for a cache expiry.
  await withStep(ctx, "refresh_gate_message", async () => {
    if (!interaction.guildId) return;

    try {
      // Dynamic import to avoid circular dependency - gate.js imports from config
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

  // Process image - GIFs pass through unchanged, others get cropped/converted
  const avatarBuffer = await withStep(ctx, "process_image", async () => {
    // GIFs are special: sharp can process them but loses animation.
    // Discord handles animated avatars natively, so pass through as-is.
    if (attachment.contentType === "image/gif") {
      logger.info("Keeping GIF format for animated avatar");
      return imageBuffer;
    }

    // Discord avatars are displayed as circles, so we crop to square from center.
    // 1024x1024 is Discord's max avatar resolution.
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
    // The propagation delay is real - Discord's CDN caches aggressively.
    // Users might see the old avatar for up to 10 minutes in some clients.
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
