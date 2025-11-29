/**
 * Pawtropolis Tech — src/commands/artistqueue.ts
 * WHAT: /artistqueue command for managing Server Artist rotation queue.
 * WHY: Allow staff to view, sync, and manage the artist rotation system.
 * FLOWS:
 *  - /artistqueue list → View current queue order
 *  - /artistqueue sync → Sync queue with Server Artist role holders
 *  - /artistqueue move <user> <position> → Reorder an artist
 *  - /artistqueue skip <user> [reason] → Skip an artist in rotation
 *  - /artistqueue unskip <user> → Remove skip status
 *  - /artistqueue history [user] → View assignment history
 *  - /artistqueue setup → Initial setup (permissions, sync)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import {
  ARTIST_ROLE_ID,
  AMBASSADOR_ROLE_ID,
  SERVER_ARTIST_CHANNEL_ID,
  getAllArtists,
  getArtist,
  syncWithRoleMembers,
  moveToPosition,
  skipArtist,
  unskipArtist,
  getAssignmentHistory,
  getArtistStats,
} from "../features/artistRotation/index.js";
import { fmtAgeShort } from "../lib/timefmt.js";
import { nowUtc } from "../lib/time.js";

export const data = new SlashCommandBuilder()
  .setName("artistqueue")
  .setDescription("Manage the Server Artist rotation queue")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("View current artist queue order")
  )
  .addSubcommand((sub) =>
    sub
      .setName("sync")
      .setDescription("Sync queue with current Server Artist role holders")
  )
  .addSubcommand((sub) =>
    sub
      .setName("move")
      .setDescription("Move an artist to a specific position in the queue")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Artist to move").setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt
          .setName("position")
          .setDescription("New position (1 = first)")
          .setMinValue(1)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("skip")
      .setDescription("Temporarily skip an artist in rotation")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Artist to skip").setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName("reason").setDescription("Reason for skipping").setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("unskip")
      .setDescription("Remove skip status from an artist")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Artist to unskip").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("history")
      .setDescription("View art reward assignment history")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Filter by specific artist").setRequired(false)
      )
      .addIntegerOption((opt) =>
        opt
          .setName("limit")
          .setDescription("Number of entries to show (default: 10)")
          .setMinValue(1)
          .setMaxValue(50)
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("setup")
      .setDescription("Initial setup - sync queue and configure permissions")
  );

/**
 * Execute /artistqueue command
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const subcommand = interaction.options.getSubcommand();

  ctx.step(`subcommand:${subcommand}`);

  switch (subcommand) {
    case "list":
      await handleList(interaction, ctx);
      break;
    case "sync":
      await handleSync(interaction, ctx);
      break;
    case "move":
      await handleMove(interaction, ctx);
      break;
    case "skip":
      await handleSkip(interaction, ctx);
      break;
    case "unskip":
      await handleUnskip(interaction, ctx);
      break;
    case "history":
      await handleHistory(interaction, ctx);
      break;
    case "setup":
      await handleSetup(interaction, ctx);
      break;
    default:
      await interaction.reply({ content: "Unknown subcommand.", ephemeral: false });
  }
}

/**
 * /artistqueue list - View current queue order
 */
async function handleList(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  await interaction.deferReply({ ephemeral: false });

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply("This command must be run in a server.");
    return;
  }

  const artists = getAllArtists(guildId);

  if (artists.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle("Server Artist Queue")
      .setDescription("No artists in queue. Run `/artistqueue sync` to populate from Server Artist role.")
      .setColor(0x2f0099);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Build queue list
  const lines: string[] = [];
  let totalAssignments = 0;

  for (const artist of artists) {
    const skipIndicator = artist.skipped ? " (skipped)" : "";
    const lastAssigned = artist.last_assigned_at
      ? fmtAgeShort(Math.floor(new Date(artist.last_assigned_at).getTime() / 1000), nowUtc()) + " ago"
      : "Never";

    lines.push(
      `**#${artist.position}** <@${artist.user_id}>${skipIndicator} - ${artist.assignments_count} assignments - Last: ${lastAssigned}`
    );
    totalAssignments += artist.assignments_count;
  }

  const embed = new EmbedBuilder()
    .setTitle("Server Artist Queue")
    .setDescription(lines.join("\n"))
    .setColor(0x2f0099)
    .setFooter({ text: `${artists.length} artists | ${totalAssignments} total assignments` });

  await interaction.editReply({ embeds: [embed] });
}

/**
 * /artistqueue sync - Sync with Server Artist role holders
 */
async function handleSync(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  await interaction.deferReply({ ephemeral: false });

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply("This command must be run in a server.");
    return;
  }

  ctx.step("fetch_role_members");

  // Fetch all members with Server Artist role
  const role = await guild.roles.fetch(ARTIST_ROLE_ID);
  if (!role) {
    await interaction.editReply(`Server Artist role (${ARTIST_ROLE_ID}) not found.`);
    return;
  }

  // Ensure we have all members cached
  await guild.members.fetch();

  const roleHolderIds = role.members.map((m) => m.id);

  ctx.step("sync_queue");
  const result = syncWithRoleMembers(guild.id, roleHolderIds);

  // Build response
  const lines: string[] = [];

  if (result.added.length > 0) {
    lines.push(`**Added to queue (${result.added.length}):**`);
    for (const id of result.added) {
      lines.push(`- <@${id}>`);
    }
  }

  if (result.removed.length > 0) {
    lines.push(`\n**Removed from queue (${result.removed.length}):**`);
    for (const id of result.removed) {
      lines.push(`- <@${id}>`);
    }
  }

  if (result.added.length === 0 && result.removed.length === 0) {
    lines.push("Queue is already in sync with Server Artist role.");
  }

  const embed = new EmbedBuilder()
    .setTitle("Queue Synchronized")
    .setDescription(lines.join("\n"))
    .setColor(0x00cc00)
    .setFooter({ text: `${result.unchanged.length + result.added.length} artists in queue` });

  await interaction.editReply({ embeds: [embed] });

  logger.info(
    { guildId: guild.id, added: result.added.length, removed: result.removed.length },
    "[artistqueue] Sync completed"
  );
}

/**
 * /artistqueue move - Move artist to specific position
 */
async function handleMove(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: false });
    return;
  }

  const user = interaction.options.getUser("user", true);
  const newPosition = interaction.options.getInteger("position", true);

  const artist = getArtist(guildId, user.id);
  if (!artist) {
    await interaction.reply({
      content: `<@${user.id}> is not in the artist queue.`,
      ephemeral: false,
    });
    return;
  }

  const oldPosition = artist.position;
  const success = moveToPosition(guildId, user.id, newPosition);

  if (!success) {
    await interaction.reply({ content: "Failed to move artist.", ephemeral: false });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Queue Updated")
    .setDescription(`<@${user.id}> moved from position **#${oldPosition}** to **#${newPosition}**`)
    .setColor(0x00cc00);

  await interaction.reply({ embeds: [embed], ephemeral: false });
}

/**
 * /artistqueue skip - Skip an artist in rotation
 */
async function handleSkip(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: false });
    return;
  }

  const user = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason") ?? undefined;

  const artist = getArtist(guildId, user.id);
  if (!artist) {
    await interaction.reply({
      content: `<@${user.id}> is not in the artist queue.`,
      ephemeral: false,
    });
    return;
  }

  if (artist.skipped) {
    await interaction.reply({
      content: `<@${user.id}> is already skipped.`,
      ephemeral: false,
    });
    return;
  }

  const success = skipArtist(guildId, user.id, reason);

  if (!success) {
    await interaction.reply({ content: "Failed to skip artist.", ephemeral: false });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Artist Skipped")
    .setDescription(
      `<@${user.id}> will be skipped in rotation.\n${reason ? `**Reason:** ${reason}` : ""}\n\nUse \`/artistqueue unskip\` to restore.`
    )
    .setColor(0xffaa00);

  await interaction.reply({ embeds: [embed], ephemeral: false });
}

/**
 * /artistqueue unskip - Remove skip status
 */
async function handleUnskip(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: false });
    return;
  }

  const user = interaction.options.getUser("user", true);

  const artist = getArtist(guildId, user.id);
  if (!artist) {
    await interaction.reply({
      content: `<@${user.id}> is not in the artist queue.`,
      ephemeral: false,
    });
    return;
  }

  if (!artist.skipped) {
    await interaction.reply({
      content: `<@${user.id}> is not currently skipped.`,
      ephemeral: false,
    });
    return;
  }

  const success = unskipArtist(guildId, user.id);

  if (!success) {
    await interaction.reply({ content: "Failed to unskip artist.", ephemeral: false });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Artist Unskipped")
    .setDescription(`<@${user.id}> is back in rotation at position **#${artist.position}**.`)
    .setColor(0x00cc00);

  await interaction.reply({ embeds: [embed], ephemeral: false });
}

/**
 * /artistqueue history - View assignment history
 */
async function handleHistory(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  await interaction.deferReply({ ephemeral: false });

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply("This command must be run in a server.");
    return;
  }

  const user = interaction.options.getUser("user");
  const limit = interaction.options.getInteger("limit") ?? 10;

  const history = getAssignmentHistory(guildId, user?.id, limit);

  if (history.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle(user ? `${user.username}'s Assignment History` : "Assignment History")
      .setDescription("No assignments found.")
      .setColor(0x2f0099);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Build history list
  const lines: string[] = [];

  for (const entry of history) {
    const assignedAtEpoch = Math.floor(new Date(entry.assigned_at).getTime() / 1000);
    const overrideIndicator = entry.override ? " (override)" : "";

    lines.push(
      `<@${entry.artist_id}> → <@${entry.recipient_id}> (${entry.ticket_type})${overrideIndicator} - ${fmtAgeShort(assignedAtEpoch, nowUtc())} ago`
    );
  }

  // If filtering by user, include stats
  let footer = `Showing ${history.length} entries`;
  if (user) {
    const stats = getArtistStats(guildId, user.id);
    footer = `Total: ${stats.totalAssignments} assignments`;
  }

  const embed = new EmbedBuilder()
    .setTitle(user ? `${user.username}'s Assignment History` : "Recent Assignments")
    .setDescription(lines.join("\n"))
    .setColor(0x2f0099)
    .setFooter({ text: footer });

  await interaction.editReply({ embeds: [embed] });
}

/**
 * /artistqueue setup - Initial setup
 */
async function handleSetup(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  await interaction.deferReply({ ephemeral: false });

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply("This command must be run in a server.");
    return;
  }

  const results: string[] = [];

  // Step 1: Update channel permissions
  ctx.step("update_permissions");
  try {
    const channel = await guild.channels.fetch(SERVER_ARTIST_CHANNEL_ID);
    if (channel && channel.isTextBased() && "permissionOverwrites" in channel) {
      await channel.permissionOverwrites.edit(AMBASSADOR_ROLE_ID, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
      results.push("Channel permissions updated for Community Ambassador");
    } else {
      results.push("Could not find #server-artist channel or update permissions");
    }
  } catch (err) {
    logger.warn({ err, guildId: guild.id }, "[artistqueue] Failed to update channel permissions");
    results.push("Failed to update channel permissions (check bot permissions)");
  }

  // Step 2: Sync queue with role holders
  ctx.step("sync_queue");
  try {
    const role = await guild.roles.fetch(ARTIST_ROLE_ID);
    if (role) {
      await guild.members.fetch();
      const roleHolderIds = role.members.map((m) => m.id);
      const syncResult = syncWithRoleMembers(guild.id, roleHolderIds);
      results.push(
        `Queue synced: ${syncResult.added.length} added, ${syncResult.removed.length} removed, ${syncResult.unchanged.length} unchanged`
      );
    } else {
      results.push("Server Artist role not found");
    }
  } catch (err) {
    logger.warn({ err, guildId: guild.id }, "[artistqueue] Failed to sync queue");
    results.push("Failed to sync queue");
  }

  const embed = new EmbedBuilder()
    .setTitle("Artist Queue Setup Complete")
    .setDescription(results.map((r) => `- ${r}`).join("\n"))
    .setColor(0x00cc00)
    .addFields({
      name: "Available Commands",
      value: [
        "`/artistqueue list` - View rotation order",
        "`/artistqueue sync` - Re-sync with role",
        "`/artistqueue move` - Reorder artists",
        "`/artistqueue skip/unskip` - Manage availability",
        "`/artistqueue history` - View assignments",
        "`/redeemreward` - Assign art reward",
      ].join("\n"),
    });

  await interaction.editReply({ embeds: [embed] });

  logger.info({ guildId: guild.id }, "[artistqueue] Setup completed");
}
