/**
 * Pawtropolis Tech -- src/features/modmail/commands.ts
 * WHAT: Slash commands and context menu commands for modmail management.
 * WHY: Provides staff interface for closing and reopening modmail threads.
 * FLOWS:
 *  - /modmail close - closes a modmail thread
 *  - /modmail reopen - reopens a closed modmail thread
 *  - "Modmail: Open" context menu - opens modmail from a message
 * DOCS:
 *  - SlashCommandBuilder: https://discord.js.org/#/docs/discord.js/main/class/SlashCommandBuilder
 *  - ContextMenuCommandBuilder: https://discord.js.org/#/docs/discord.js/main/class/ContextMenuCommandBuilder
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import { replyOrEdit, ensureDeferred, type CommandContext } from "../../lib/cmdWrap.js";
import { hasManageGuild, isReviewer, canRunAllCommands } from "../../lib/config.js";
import { closeModmailThread, reopenModmailThread } from "./threads.js";

// ===== Slash Commands =====

export const modmailCommand = new SlashCommandBuilder()
  .setName("modmail")
  .setDescription("Modmail management")
  .addSubcommand((sc) =>
    sc
      .setName("close")
      .setDescription("Close a modmail thread")
      .addStringOption((o) =>
        o.setName("thread").setDescription("Thread ID (optional, uses current)").setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("reopen")
      .setDescription("Reopen a closed modmail thread")
      .addUserOption((o) =>
        o.setName("user").setDescription("User to reopen modmail for").setRequired(false)
      )
      .addStringOption((o) =>
        o.setName("thread").setDescription("Thread ID to reopen (optional)").setRequired(false)
      )
  )
  .setDMPermission(false);

export async function executeModmailCommand(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  if (!interaction.guildId || !interaction.guild) {
    await replyOrEdit(interaction, { content: "Guild only." });
    return;
  }

  // Check permissions: owner + mod roles first, then fall back to hasManageGuild/isReviewer
  // DOCS:
  //  - canRunAllCommands: checks OWNER_IDS and mod_role_ids from guild config
  //  - hasManageGuild: checks ManageGuild permission
  //  - isReviewer: checks reviewer_role_id or review channel visibility
  const member = interaction.member as GuildMember | null;
  const hasPermission =
    canRunAllCommands(member, interaction.guildId) ||
    hasManageGuild(member) ||
    isReviewer(interaction.guildId, member);
  if (!hasPermission) {
    await replyOrEdit(interaction, {
      content: "You do not have permission for this.",
    });
    return;
  }

  await ensureDeferred(interaction);

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "close") {
    const threadId = interaction.options.getString("thread") ?? undefined;
    const result = await closeModmailThread({ interaction, threadId });
    await replyOrEdit(interaction, { content: result.message ?? "Unknown error." });
  } else if (subcommand === "reopen") {
    const user = interaction.options.getUser("user");
    const threadId = interaction.options.getString("thread") ?? undefined;
    const result = await reopenModmailThread({
      interaction,
      userId: user?.id,
      threadId,
    });
    await replyOrEdit(interaction, { content: result.message ?? "Unknown error." });
  }
}

// ===== Context Menu Command =====

export const modmailContextMenu = new ContextMenuCommandBuilder()
  .setName("Modmail: Open")
  .setType(ApplicationCommandType.Message)
  .setDMPermission(false);
