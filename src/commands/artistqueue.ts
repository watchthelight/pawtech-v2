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
 *
 * This is basically a round-robin scheduler with a database. The complexity
 * comes from people leaving the role, people going on vacation, and the
 * inevitable "but I should be next!" complaints that any fair queue system
 * generates. The skip/unskip dance is real and frequent.
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
import { checkCooldown, formatCooldown, COOLDOWNS } from "../lib/rateLimiter.js";
import {
  getArtistConfig,
  getAllArtists,
  getArtist,
  syncWithRoleMembers,
  moveToPosition,
  skipArtist,
  unskipArtist,
  getAssignmentHistory,
  getArtistStats,
  getIgnoredArtistUsers,
} from "../features/artistRotation/index.js";
import { fmtAgeShort } from "../lib/timefmt.js";
import { nowUtc } from "../lib/time.js";

// Seven subcommands for one queue. Discord's slash command UX really
// encourages this kind of feature creep. At least subcommands are
// discoverable, unlike the old prefix-based "read the manual" approach.
export const data = new SlashCommandBuilder()
  .setName("artistqueue")
  .setDescription("Manage the Server Artist rotation queue")
  // ManageRoles is a reasonable gate here. Anyone who can mess with roles
  // probably should be able to manage the artist queue.
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
 *
 * Classic dispatch pattern. The switch statement is fine here - TypeScript's
 * exhaustiveness checking doesn't work great with getSubcommand() anyway
 * since it returns string, not a union type. We'd need a lookup table with
 * explicit typing to get that benefit.
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
      // This should be unreachable if the SlashCommandBuilder is in sync
      // with the switch cases. Famous last words.
      await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  }
}

/**
 * /artistqueue list - View current queue order
 *
 * Defers as non-ephemeral so everyone can see the queue. This is intentional -
 * transparency about queue position reduces "why am I not getting picked" drama.
 */
async function handleList(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  // Public reply. Let everyone see the queue order to reduce conspiracy theories.
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

  // Build queue list. We're building one long string here which can get
  // dicey with Discord's 4096 char embed description limit. With, say,
  // 50 artists at ~80 chars each, we'd be at 4000 chars. Close call.
  // Something to watch if the server ever gets really popular.
  const lines: string[] = [];
  let totalAssignments = 0;

  for (const artist of artists) {
    const skipIndicator = artist.skipped ? " (skipped)" : "";
    // The epoch dance: SQLite stores ISO strings, we convert to epoch for
    // the formatting helper. This is the kind of thing that makes you miss
    // having a proper ORM with date handling. Or not - ORMs have their own sins.
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
 *
 * This is the "reconciliation" step. People get the role, people lose the role,
 * the queue needs to reflect reality. We fetch everyone and diff against what's
 * in the DB. New role holders go to the end of the queue (fair), removed ones
 * get purged.
 */
async function handleSync(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: true });
    return;
  }

  // Rate limit: 5 minutes per guild (expensive member fetch operation)
  const cooldownResult = checkCooldown("artistqueue:sync", guild.id, COOLDOWNS.ARTISTQUEUE_SYNC_MS);
  if (!cooldownResult.allowed) {
    await interaction.reply({
      content: `Queue sync is on cooldown. Try again in ${formatCooldown(cooldownResult.remainingMs!)}.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: false });

  ctx.step("fetch_role_members");

  // Fetch all members with Server Artist role (using guild-specific config)
  const artistConfig = getArtistConfig(guild.id);
  const role = await guild.roles.fetch(artistConfig.artistRoleId);
  if (!role) {
    await interaction.editReply(`Server Artist role (${artistConfig.artistRoleId}) not found.`);
    return;
  }

  // GOTCHA: role.members is cached and may be stale. We need to fetch the full
  // member list and filter manually. Yes, this means fetching ALL members.
  // For large servers this is expensive. Discord rate limits are not our friend.
  const members = await guild.members.fetch();
  const ignoredUsers = getIgnoredArtistUsers(guild.id);
  const roleHolderIds = members
    .filter((m) => m.roles.cache.has(artistConfig.artistRoleId) && !ignoredUsers.has(m.id))
    .map((m) => m.id);

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
 *
 * The "make it fair" escape hatch. When someone's been waiting forever due to
 * bad timing or they got unfairly bumped, staff can manually reorder. This is
 * the "I know better than the algorithm" button. Use sparingly or the whole
 * queue concept falls apart.
 */
async function handleMove(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: true });
    return;
  }

  const user = interaction.options.getUser("user", true);
  const newPosition = interaction.options.getInteger("position", true);

  const artist = getArtist(guildId, user.id);
  if (!artist) {
    await interaction.reply({
      content: `<@${user.id}> is not in the artist queue.`,
      ephemeral: true,
    });
    return;
  }

  const oldPosition = artist.position;
  // moveToPosition handles the cascade of position updates for everyone between
  // old and new positions. It's doing a lot more work than this call suggests.
  const success = moveToPosition(guildId, user.id, newPosition);

  if (!success) {
    // Unhelpfully vague error message. The store function doesn't tell us why
    // it failed (position out of range? DB error?). Could be improved.
    await interaction.reply({ content: "Failed to move artist.", ephemeral: true });
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
 *
 * For when an artist is away, busy, or just needs a break. They stay in the
 * queue but get passed over during assignment. Their position is preserved
 * so they don't lose their place - they'll resume where they left off.
 */
async function handleSkip(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: true });
    return;
  }

  const user = interaction.options.getUser("user", true);
  // The ?? undefined dance: getString returns string | null, but skipArtist
  // wants string | undefined. TypeScript pedantry at its finest.
  const reason = interaction.options.getString("reason") ?? undefined;

  const artist = getArtist(guildId, user.id);
  if (!artist) {
    await interaction.reply({
      content: `<@${user.id}> is not in the artist queue.`,
      ephemeral: true,
    });
    return;
  }

  if (artist.skipped) {
    await interaction.reply({
      content: `<@${user.id}> is already skipped.`,
      ephemeral: true,
    });
    return;
  }

  const success = skipArtist(guildId, user.id, reason);

  if (!success) {
    await interaction.reply({ content: "Failed to skip artist.", ephemeral: true });
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
 *
 * The "I'm back" button. Artist resumes their place in rotation. Note that
 * their position is unchanged - they were just invisible, not removed.
 */
async function handleUnskip(
  interaction: ChatInputCommandInteraction,
  ctx: CommandContext
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "This command must be run in a server.", ephemeral: true });
    return;
  }

  const user = interaction.options.getUser("user", true);

  const artist = getArtist(guildId, user.id);
  if (!artist) {
    await interaction.reply({
      content: `<@${user.id}> is not in the artist queue.`,
      ephemeral: true,
    });
    return;
  }

  if (!artist.skipped) {
    await interaction.reply({
      content: `<@${user.id}> is not currently skipped.`,
      ephemeral: true,
    });
    return;
  }

  const success = unskipArtist(guildId, user.id);

  if (!success) {
    await interaction.reply({ content: "Failed to unskip artist.", ephemeral: true });
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
 *
 * The audit trail. Who got assigned to whom, and when. Useful for settling
 * disputes about fairness ("I haven't been picked in months!") and tracking
 * overall system health. The override indicator shows manual assignments
 * that bypassed the normal queue order.
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
  // 10 is a reasonable default. 50 max prevents embed size explosions.
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

  // Build history list. Each line is: artist → recipient (type) - time ago
  // The arrow direction matters: artist draws FOR the recipient.
  const lines: string[] = [];

  for (const entry of history) {
    const assignedAtEpoch = Math.floor(new Date(entry.assigned_at).getTime() / 1000);
    // Overrides are when staff manually picked an artist out of order.
    // Could be favoritism, could be making up for a missed turn. Either way,
    // it's worth flagging for transparency.
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
 *
 * The "run this first" command. Does two things:
 * 1. Sets up channel permissions so ambassadors can post in #server-artist
 * 2. Syncs the queue with whoever currently has the role
 *
 * This is idempotent - safe to run multiple times if something seems off.
 * Each step is independent and will report its own success/failure.
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

  // Accumulate results from each setup step. We don't fail-fast because
  // partial success is still useful information.
  const results: string[] = [];

  // Get guild-specific artist rotation config
  const artistConfig = getArtistConfig(guild.id);

  // Step 1: Update channel permissions
  // The bot needs ManageChannels + ManageRoles permissions on the target channel.
  // If this fails, it's usually a bot permission issue, not a code issue.
  ctx.step("update_permissions");
  try {
    const channel = await guild.channels.fetch(artistConfig.serverArtistChannelId);
    // The "permissionOverwrites" in channel check is for TypeScript narrowing.
    // Text channels have it, but we need to guard against voice channels etc.
    if (channel && channel.isTextBased() && "permissionOverwrites" in channel) {
      await channel.permissionOverwrites.edit(artistConfig.ambassadorRoleId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
      results.push("Channel permissions updated for Community Ambassador");
    } else {
      results.push("Could not find #server-artist channel or update permissions");
    }
  } catch (err) {
    // Most common failure: bot doesn't have ManageRoles permission on the channel.
    logger.warn({ err, guildId: guild.id }, "[artistqueue] Failed to update channel permissions");
    results.push("Failed to update channel permissions (check bot permissions)");
  }

  // Step 2: Sync queue with role holders
  // This duplicates the logic from handleSync. Would be nice to extract, but
  // setup has slightly different error handling (accumulate vs return early).
  ctx.step("sync_queue");
  try {
    const role = await guild.roles.fetch(artistConfig.artistRoleId);
    if (role) {
      // Same full-member-fetch as in handleSync. Yes, we hit the API hard here.
      const members = await guild.members.fetch();
      const ignoredUsers = getIgnoredArtistUsers(guild.id);
      const roleHolderIds = members
        .filter((m) => m.roles.cache.has(artistConfig.artistRoleId) && !ignoredUsers.has(m.id))
        .map((m) => m.id);
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

  // Always green even if some steps failed. Title says "Complete" not "Success".
  // The individual step results tell the real story.
  const embed = new EmbedBuilder()
    .setTitle("Artist Queue Setup Complete")
    .setDescription(results.map((r) => `- ${r}`).join("\n"))
    .setColor(0x00cc00)
    .addFields({
      name: "Available Commands",
      // Mini help text. Mentioning /redeemreward here since that's the
      // command that actually uses the queue we just set up.
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
