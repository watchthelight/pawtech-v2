/**
 * Pawtropolis Tech — src/commands/cage.ts
 * WHAT: /cage command to overlay a cage PNG on a user's avatar
 * WHY: Fun meme command for community engagement
 * FLOWS:
 *  - Verify permission (role ID 896070888703803462) → fetch user's server avatar → load cage.png → composite images → send result
 * DOCS:
 *  - CommandInteraction: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction
 *  - Sharp: https://sharp.pixelplumbing.com/api-composite
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  AttachmentBuilder,
} from "discord.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import sharp from "sharp";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const data = new SlashCommandBuilder()
  .setName("cage")
  .setDescription("Put a user in the cage")
  .addUserOption((option) =>
    option.setName("user").setDescription("The user to cage").setRequired(true)
  );

/**
 * Required role ID for executing this command.
 * Only users with this role can run /cage.
 */
const REQUIRED_ROLE_ID = "896070888703803462";

/**
 * Path to the cage overlay image.
 * This should be a 512x512 PNG with transparency where the avatar should show through.
 */
const CAGE_IMAGE_PATH = join(process.cwd(), "assets", "cage.png");

/**
 * execute
 * WHAT: Fetches target user's avatar, composites it with cage.png, and sends the result.
 * WHY: Creates a fun meme image with the user "caged".
 * RETURNS: Promise<void>
 * THROWS: Errors are caught by wrapCommand upstream.
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  // Check if user is in a guild (required for member role checks)
  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if user has the required role
  const member = interaction.member;
  if (!member || !("roles" in member)) {
    await interaction.reply({
      content: "Could not verify your permissions.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!member.roles.cache.has(REQUIRED_ROLE_ID)) {
    await interaction.reply({
      content: "You don't have permission to use this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetUser = interaction.options.getUser("user", true);

  // Defer reply since image processing may take a moment
  await withStep(ctx, "defer_reply", async () => {
    await interaction.deferReply();
  });

  // Verify cage.png exists
  if (!existsSync(CAGE_IMAGE_PATH)) {
    await withStep(ctx, "missing_cage_asset", async () => {
      await interaction.editReply({
        content: `Error: cage.png not found at ${CAGE_IMAGE_PATH}. Please add a 512x512 PNG cage overlay.`,
      });
    });
    logger.error(
      { evt: "cage_asset_missing", path: CAGE_IMAGE_PATH },
      "[cage] cage.png asset not found"
    );
    return;
  }

  const compositeResult = await withStep(ctx, "create_composite", async () => {
    // Get target user's guild-specific avatar if available, otherwise fall back to global avatar
    const guildMember = await interaction.guild!.members.fetch(targetUser.id).catch(() => null);

    let avatarUrl: string;
    if (guildMember?.avatar) {
      // Guild-specific avatar (server avatar)
      avatarUrl = guildMember.displayAvatarURL({ extension: "png", size: 512 });
    } else {
      // Fall back to global Discord avatar
      avatarUrl = targetUser.displayAvatarURL({ extension: "png", size: 512 });
    }

    logger.info({
      evt: "cage_avatar_fetch",
      userId: targetUser.id,
      avatarUrl,
      hasGuildAvatar: !!guildMember?.avatar,
    }, "Fetching avatar for cage command");

    // Fetch the avatar image
    const avatarResponse = await fetch(avatarUrl);
    if (!avatarResponse.ok) {
      throw new Error(`Failed to fetch avatar: ${avatarResponse.statusText}`);
    }
    const avatarBuffer = Buffer.from(await avatarResponse.arrayBuffer());

    // Output size (sticker size - compact)
    const OUTPUT_SIZE = 192;

    // Load cage overlay and resize to cover full output size
    const cageRaw = readFileSync(CAGE_IMAGE_PATH);
    const cageBuffer = await sharp(cageRaw)
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "cover" })
      .png()
      .toBuffer();

    // Resize avatar to square output size
    const resizedAvatar = await sharp(avatarBuffer)
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "cover" })
      .png()
      .toBuffer();

    // Composite: avatar as base, cage covers entire avatar
    const compositeBuffer = await sharp(resizedAvatar)
      .composite([
        {
          input: cageBuffer,
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();

    return compositeBuffer;
  });

  await withStep(ctx, "send_result", async () => {
    const attachment = new AttachmentBuilder(compositeResult, {
      name: `caged_${targetUser.username}.png`,
    });

    await interaction.editReply({
      files: [attachment],
    });

    logger.info({
      evt: "cage_command_success",
      executorId: interaction.user.id,
      targetUserId: targetUser.id,
      guildId: interaction.guild!.id,
    }, "Cage command executed successfully");
  });
}
