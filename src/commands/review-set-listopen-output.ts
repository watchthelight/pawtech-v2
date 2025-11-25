/**
 * Pawtropolis Tech — src/commands/review-set-listopen-output.ts
 * WHAT: /review-set-listopen-output command — toggles /listopen output visibility (public vs ephemeral).
 * WHY: Allows guilds to customize moderator workflow privacy.
 * FLOWS:
 *  - /review-set-listopen-output mode:public → makes /listopen outputs visible to everyone
 *  - /review-set-listopen-output mode:ephemeral → makes /listopen outputs ephemeral (only to invoker)
 * DOCS:
 *  - Discord slash commands: https://discord.js.org/#/docs/discord.js/main/class/ChatInputCommandInteraction
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { ChatInputCommandInteraction, SlashCommandBuilder, PermissionFlagsBits, type GuildMember } from "discord.js";
import { upsertConfig, getConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { logActionPretty } from "../logging/pretty.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { hasManageGuild } from "../lib/config.js";
import { isOwner } from "../utils/owner.js";

export const data = new SlashCommandBuilder()
  .setName("review-set-listopen-output")
  .setDescription("Set whether /listopen outputs are public or ephemeral (admin-only)")
  .addStringOption((option) =>
    option
      .setName("mode")
      .setDescription("Output mode for /listopen command")
      .setRequired(true)
      .addChoices({ name: "public", value: "public" }, { name: "ephemeral", value: "ephemeral" })
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // Admin-only via Discord permissions
  .setDMPermission(false); // Guild-only command

/**
 * WHAT: Main command executor for /review-set-listopen-output.
 * WHY: Admin command to toggle /listopen visibility settings.
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;

  // Guild-only check
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guildId;
  const member = (interaction.member && "permissions" in interaction.member ? interaction.member : null) as GuildMember | null;

  // Runtime permission check: ManageGuild permission OR owner override
  const hasManageGuildPerm = hasManageGuild(member);
  const isOwnerUser = isOwner(interaction.user.id);

  if (!hasManageGuildPerm && !isOwnerUser) {
    await interaction.reply({
      content: "❌ You don't have permission to use this command. This command requires Manage Server permission.",
      ephemeral: true,
    });

    logger.warn(
      { userId: interaction.user.id, guildId, hasManageGuild: hasManageGuildPerm, isOwner: isOwnerUser },
      "[review-set-listopen-output] unauthorized access attempt"
    );
    return;
  }

  const mode = interaction.options.getString("mode", true);
  const newValue = mode === "public" ? 1 : 0;

  // Get old value for logging
  const oldConfig = getConfig(guildId);
  const oldValue = oldConfig?.listopen_public_output ?? 1; // Default is public

  try {
    // Update config
    upsertConfig(guildId, { listopen_public_output: newValue });

    logger.info(
      { guildId, userId: interaction.user.id, oldValue, newValue, mode },
      "[review-set-listopen-output] updated listopen output mode"
    );

    // Log to action_log and audit channel
    await logActionPretty(interaction.guild, {
      actorId: interaction.user.id,
      action: "set_listopen_output",
      meta: {
        mode,
        oldMode: oldValue === 1 ? "public" : "ephemeral",
        newMode: mode,
      },
    });

    await interaction.reply({
      content: `✅ Set **/listopen** output mode to **${mode}**.\n\n${
        mode === "public"
          ? "Moderators' claimed application lists will now be **visible to everyone** in the channel."
          : "Moderators' claimed application lists will now be **ephemeral** (only visible to the command invoker)."
      }`,
      ephemeral: true,
    });
  } catch (err) {
    logger.error({ err, guildId, userId: interaction.user.id, mode }, "[review-set-listopen-output] failed");

    await interaction.reply({
      content: "❌ Failed to update /listopen output mode. Check bot logs.",
      ephemeral: true,
    });
  }
}
