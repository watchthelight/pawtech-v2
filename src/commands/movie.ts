// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/commands/movie.ts
 * WHAT: Movie night attendance tracking commands
 * WHY: Track VC participation and assign tier roles
 * FLOWS:
 *  - /movie start <channel> → starts tracking attendance in a voice channel
 *  - /movie end → finalizes attendance, assigns tier roles, shows top attendees
 *  - /movie attendance [@user] → view attendance stats (all attendees or specific user)
 * DOCS:
 *  - SlashCommandBuilder: https://discord.js.org/#/docs/builders/main/class/SlashCommandBuilder
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ChannelType,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { requireStaff } from "../lib/config.js";
import {
  startMovieEvent,
  getActiveMovieEvent,
  isMovieEventActive,
  finalizeMovieAttendance,
  getUserQualifiedMovieCount,
  updateMovieTierRole,
  getRecoveryStatus,
  addManualAttendance,
  creditHistoricalAttendance,
  bumpAttendance,
  getMovieQualificationThreshold,
} from "../features/movieNight.js";
import { logActionPretty } from "../logging/pretty.js";

/*
 * Movie Night Attendance System
 * -----------------------------
 * Tracks voice channel participation during movie night events. The workflow:
 *
 *   1. Staff runs /movie start #voice-channel
 *   2. Bot listens to voiceStateUpdate events (see features/movieNight.ts)
 *   3. Users joining/leaving the VC are logged with timestamps
 *   4. Staff runs /movie end to finalize
 *   5. Users with 30+ minutes get "qualified" status and tier role updates
 *
 * TIER ROLES (ascending):
 *   - Red Carpet Guest: 1+ qualified movies
 *   - Popcorn Club: 5+ qualified movies
 *   - Director's Cut: 10+ qualified movies
 *   - Cinematic Royalty: 20+ qualified movies
 *
 * The bot automatically promotes users to higher tiers but DOES NOT demote.
 * If someone has Director's Cut and skips a few movies, they keep the role.
 *
 * DATA MODEL:
 *   - movie_event: Active event state (one per guild max)
 *   - movie_attendance: Per-user, per-event duration tracking
 *   - movie_session: Raw join/leave timestamps for debugging
 *
 * EDGE CASES:
 *   - User joins, leaves, rejoins: All sessions summed for total duration
 *   - Bot crashes mid-event: Session data preserved, /movie end still works
 *   - User in VC when /movie start runs: Counted from start time, not join time
 */

export const data = new SlashCommandBuilder()
  .setName("movie")
  .setDescription("Movie night attendance tracking commands")
  .addSubcommand((sub) =>
    sub
      .setName("start")
      .setDescription("Start tracking movie night attendance")
      .addChannelOption((opt) =>
        opt
          .setName("channel")
          .setDescription("Voice channel to track")
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("end")
      .setDescription("End movie night and finalize attendance")
  )
  .addSubcommand((sub) =>
    sub
      .setName("attendance")
      .setDescription("View attendance stats for a user or the whole event")
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("User to check (leave empty to see all attendees)")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Manually add minutes to a user's current event attendance")
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("User to add minutes for")
          .setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt
          .setName("minutes")
          .setDescription("Number of minutes to add (1-300)")
          .setMinValue(1)
          .setMaxValue(300)
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("reason")
          .setDescription("Reason for the adjustment")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("credit")
      .setDescription("Credit attendance minutes to any event date")
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("User to credit")
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("date")
          .setDescription("Event date (YYYY-MM-DD)")
          .setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt
          .setName("minutes")
          .setDescription("Number of minutes to credit (1-300)")
          .setMinValue(1)
          .setMaxValue(300)
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("reason")
          .setDescription("Reason for the credit")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("bump")
      .setDescription("Give a user full credit for a movie (compensation)")
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("User to bump")
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("date")
          .setDescription("Event date (YYYY-MM-DD, defaults to today)")
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName("reason")
          .setDescription("Reason for the bump")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("resume")
      .setDescription("Check status of recovered movie session after bot restart")
  );

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const interaction = ctx.interaction;

  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Check staff permissions
  if (!requireStaff(interaction, {
    command: "movie",
    description: "Movie night attendance tracking and tier role management.",
    requirements: [{ type: "config", field: "mod_role_ids" }],
  })) return;

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "start":
      await handleStart(interaction);
      break;
    case "end":
      await handleEnd(interaction);
      break;
    case "attendance":
      await handleAttendance(interaction);
      break;
    case "add":
      await handleAdd(interaction);
      break;
    case "credit":
      await handleCredit(interaction);
      break;
    case "bump":
      await handleBump(interaction);
      break;
    case "resume":
      await handleResume(interaction);
      break;
    default:
      await interaction.reply({
        content: "Unknown subcommand.",
        ephemeral: true,
      });
  }
}

async function handleStart(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const channel = interaction.options.getChannel("channel", true);

  if (isMovieEventActive(guild.id)) {
    await interaction.reply({
      content: "⚠️ A movie night is already in progress. Use `/movie end` to finish it first.",
      ephemeral: true,
    });
    return;
  }

  // Defer since initializing existing members may take a moment
  await interaction.deferReply();

  const eventDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const { retroactiveCount } = await startMovieEvent(guild, channel.id, eventDate);
  const threshold = getMovieQualificationThreshold(guild.id);

  logger.info({
    evt: "movie_start_command",
    guildId: guild.id,
    channelId: channel.id,
    eventDate,
    retroactiveCount,
    invokedBy: interaction.user.id,
  }, `Movie night started in ${channel.name}`);

  const embed = new EmbedBuilder()
    .setTitle("🎬 Movie Night Started!")
    .setDescription(`Now tracking attendance in <#${channel.id}>`)
    .addFields(
      { name: "Date", value: eventDate, inline: true },
      { name: "Minimum Time", value: `${threshold} minutes to qualify`, inline: true }
    )
    .setColor(0x5865F2)
    .setTimestamp();

  if (retroactiveCount > 0) {
    embed.addFields({
      name: "Already in VC",
      value: `${retroactiveCount} user${retroactiveCount > 1 ? "s" : ""} already in the channel have been credited`,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleEnd(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;

  const event = getActiveMovieEvent(guild.id);
  if (!event) {
    await interaction.reply({
      content: "⚠️ No movie night is currently in progress.",
      ephemeral: true,
    });
    return;
  }

  /*
   * Defer immediately - finalizeMovieAttendance can take a while if there are
   * many users (fetches each member, updates roles). Discord gives us 15 minutes
   * after deferring, plenty of time for even large events.
   */
  await interaction.deferReply();

  logger.info({
    evt: "movie_end_command",
    guildId: guild.id,
    eventDate: event.eventDate,
    invokedBy: interaction.user.id,
  }, "Movie night ending");

  // Finalize attendance
  await finalizeMovieAttendance(guild);

  // Get all qualified users from this event
  const qualifiedUsers = db.prepare(`
    SELECT user_id, duration_minutes, longest_session_minutes
    FROM movie_attendance
    WHERE guild_id = ? AND event_date = ? AND qualified = 1
    ORDER BY duration_minutes DESC
  `).all(guild.id, event.eventDate) as Array<{
    user_id: string;
    duration_minutes: number;
    longest_session_minutes: number;
  }>;

  // Update tier roles for all qualified users
  for (const user of qualifiedUsers) {
    await updateMovieTierRole(guild, user.user_id);
  }

  const totalAttendees = db.prepare(`
    SELECT COUNT(*) as count
    FROM movie_attendance
    WHERE guild_id = ? AND event_date = ?
  `).get(guild.id, event.eventDate) as { count: number };

  const embed = new EmbedBuilder()
    .setTitle("🎬 Movie Night Ended!")
    .setDescription(`Attendance has been recorded for ${event.eventDate}`)
    .addFields(
      { name: "Total Participants", value: totalAttendees.count.toString(), inline: true },
      { name: "Qualified (30+ min)", value: qualifiedUsers.length.toString(), inline: true }
    )
    .setColor(0x57F287)
    .setTimestamp();

  if (qualifiedUsers.length > 0) {
    const topAttendees = qualifiedUsers.slice(0, 5).map((u, i) =>
      `${i + 1}. <@${u.user_id}> - ${u.duration_minutes} min`
    ).join("\n");
    embed.addFields({ name: "Top Attendees", value: topAttendees });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleAttendance(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const user = interaction.options.getUser("user");

  await interaction.deferReply({ ephemeral: false });

  // If no user specified, show all attendees from the most recent event
  if (!user) {
    const latestEvent = db.prepare(`
      SELECT DISTINCT event_date FROM movie_attendance
      WHERE guild_id = ?
      ORDER BY event_date DESC
      LIMIT 1
    `).get(guild.id) as { event_date: string } | undefined;

    if (!latestEvent) {
      await interaction.editReply({
        content: "No movie night attendance records yet!",
      });
      return;
    }

    const allAttendees = db.prepare(`
      SELECT user_id, duration_minutes, longest_session_minutes, qualified
      FROM movie_attendance
      WHERE guild_id = ? AND event_date = ?
      ORDER BY duration_minutes DESC
    `).all(guild.id, latestEvent.event_date) as Array<{
      user_id: string;
      duration_minutes: number;
      longest_session_minutes: number;
      qualified: number;
    }>;

    const embed = new EmbedBuilder()
      .setTitle(`🎬 Movie Night Attendance`)
      .setDescription(`All attendees from ${latestEvent.event_date}`)
      .setColor(0x5865F2)
      .setTimestamp();

    const lines = allAttendees.map((a, i) => {
      const status = a.qualified ? "✅" : "❌";
      return `${status} <@${a.user_id}> — ${a.duration_minutes}min total (longest: ${a.longest_session_minutes}min)`;
    });

    if (lines.length > 0) {
      // Split into chunks if too long
      const chunkSize = 10;
      for (let i = 0; i < lines.length; i += chunkSize) {
        const chunk = lines.slice(i, i + chunkSize);
        embed.addFields({
          name: i === 0 ? `Attendees (${allAttendees.length} total)` : "​", // zero-width space for continuation
          value: chunk.join("\n"),
        });
      }
    } else {
      embed.addFields({ name: "Attendees", value: "No attendees recorded" });
    }

    const qualifiedCount = allAttendees.filter(a => a.qualified).length;
    embed.setFooter({ text: `${qualifiedCount} qualified (30+ min) out of ${allAttendees.length} total` });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Show stats for a specific user
  const qualifiedCount = getUserQualifiedMovieCount(guild.id, user.id);

  const recentAttendance = db.prepare(`
    SELECT event_date, duration_minutes, longest_session_minutes, qualified
    FROM movie_attendance
    WHERE guild_id = ? AND user_id = ?
    ORDER BY event_date DESC
    LIMIT 10
  `).all(guild.id, user.id) as Array<{
    event_date: string;
    duration_minutes: number;
    longest_session_minutes: number;
    qualified: number;
  }>;

  const embed = new EmbedBuilder()
    .setTitle(`🎬 Movie Night Attendance`)
    .setDescription(`Stats for ${user}`)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: "Total Qualified Movies", value: qualifiedCount.toString(), inline: true }
    )
    .setColor(0x5865F2)
    .setTimestamp();

  /*
   * Tier calculation logic:
   * - tiers is ordered highest-to-lowest for currentTier lookup (first match wins)
   * - For nextTier, we reverse and find the first tier the user HASN'T reached
   *
   * Example: User has 7 qualified movies
   *   - currentTier: Popcorn Club (threshold 5, first one they meet going down)
   *   - nextTier: Director's Cut (threshold 10, first one above their count)
   */
  const tiers = [
    { name: "Cinematic Royalty", threshold: 20 },
    { name: "Director's Cut", threshold: 10 },
    { name: "Popcorn Club", threshold: 5 },
    { name: "Red Carpet Guest", threshold: 1 },
  ];

  const currentTier = tiers.find(t => qualifiedCount >= t.threshold);
  const nextTier = tiers.slice().reverse().find(t => qualifiedCount < t.threshold);

  if (currentTier) {
    embed.addFields({ name: "Current Tier", value: currentTier.name, inline: true });
  }
  if (nextTier) {
    const needed = nextTier.threshold - qualifiedCount;
    embed.addFields({
      name: "Next Tier",
      value: `${nextTier.name} (${needed} more movie${needed === 1 ? "" : "s"})`,
      inline: true
    });
  }

  if (recentAttendance.length > 0) {
    const history = recentAttendance.map(a => {
      const status = a.qualified ? "✅" : "❌";
      return `${status} ${a.event_date}: ${a.duration_minutes}min (longest: ${a.longest_session_minutes}min)`;
    }).join("\n");
    embed.addFields({ name: "Recent Attendance", value: history });
  } else {
    embed.addFields({ name: "Recent Attendance", value: "No attendance records yet" });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const user = interaction.options.getUser("user", true);
  const minutes = interaction.options.getInteger("minutes", true);
  const reason = interaction.options.getString("reason") ?? undefined;

  const success = addManualAttendance(
    guild.id,
    user.id,
    minutes,
    interaction.user.id,
    reason
  );

  if (!success) {
    await interaction.reply({
      content: "⚠️ No movie night is currently in progress. Use `/movie credit` to credit historical attendance.",
      ephemeral: true,
    });
    return;
  }

  // Log the action
  await logActionPretty(guild, {
    actorId: interaction.user.id,
    subjectId: user.id,
    action: "movie_manual_add",
    reason: reason ?? `Manually added ${minutes} minutes`,
    meta: {
      minutes,
      eventDate: getActiveMovieEvent(guild.id)?.eventDate ?? "unknown",
    },
  }).catch(() => {});

  const embed = new EmbedBuilder()
    .setTitle("🎬 Attendance Updated")
    .setDescription(`Added **${minutes} minutes** to ${user}'s attendance`)
    .setColor(0x57F287)
    .setTimestamp();

  if (reason) {
    embed.addFields({ name: "Reason", value: reason });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleCredit(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const user = interaction.options.getUser("user", true);
  const dateStr = interaction.options.getString("date", true);
  const minutes = interaction.options.getInteger("minutes", true);
  const reason = interaction.options.getString("reason") ?? undefined;

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    await interaction.reply({
      content: "⚠️ Invalid date format. Use YYYY-MM-DD (e.g., 2024-01-15)",
      ephemeral: true,
    });
    return;
  }

  // Check date is not in the future
  const today = new Date().toISOString().split("T")[0];
  if (dateStr > today) {
    await interaction.reply({
      content: "⚠️ Cannot credit attendance for future dates.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  creditHistoricalAttendance(
    guild.id,
    user.id,
    dateStr,
    minutes,
    interaction.user.id,
    reason
  );

  // Check if they now qualify for a tier upgrade
  await updateMovieTierRole(guild, user.id);

  // Log the action
  await logActionPretty(guild, {
    actorId: interaction.user.id,
    subjectId: user.id,
    action: "movie_credit",
    reason: reason ?? `Credited ${minutes} minutes for ${dateStr}`,
    meta: {
      minutes,
      eventDate: dateStr,
    },
  }).catch(() => {});

  const newCount = getUserQualifiedMovieCount(guild.id, user.id);

  const embed = new EmbedBuilder()
    .setTitle("🎬 Attendance Credited")
    .setDescription(`Credited **${minutes} minutes** to ${user} for ${dateStr}`)
    .addFields(
      { name: "Total Qualified Movies", value: newCount.toString(), inline: true }
    )
    .setColor(0x57F287)
    .setTimestamp();

  if (reason) {
    embed.addFields({ name: "Reason", value: reason });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleBump(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const user = interaction.options.getUser("user", true);
  const dateStr = interaction.options.getString("date") ?? new Date().toISOString().split("T")[0];
  const reason = interaction.options.getString("reason") ?? undefined;

  // Validate date format if provided
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    await interaction.reply({
      content: "⚠️ Invalid date format. Use YYYY-MM-DD (e.g., 2024-01-15)",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const result = bumpAttendance(
    guild.id,
    user.id,
    dateStr,
    interaction.user.id,
    reason
  );

  if (result.previouslyQualified) {
    await interaction.editReply({
      content: `⚠️ ${user} already has a qualified attendance record for ${dateStr}.`,
    });
    return;
  }

  // Check if they now qualify for a tier upgrade
  await updateMovieTierRole(guild, user.id);

  // Log the action
  await logActionPretty(guild, {
    actorId: interaction.user.id,
    subjectId: user.id,
    action: "movie_bump",
    reason: reason ?? `Bump compensation for ${dateStr}`,
    meta: {
      eventDate: dateStr,
    },
  }).catch(() => {});

  const newCount = getUserQualifiedMovieCount(guild.id, user.id);

  const embed = new EmbedBuilder()
    .setTitle("⬆️ Attendance Bumped")
    .setDescription(`${user} has been given full credit for ${dateStr}`)
    .addFields(
      { name: "Total Qualified Movies", value: newCount.toString(), inline: true }
    )
    .setColor(0x57F287)
    .setTimestamp();

  if (reason) {
    embed.addFields({ name: "Reason", value: reason });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleResume(interaction: ChatInputCommandInteraction): Promise<void> {
  const status = getRecoveryStatus();

  if (!status.hasActiveEvent) {
    await interaction.reply({
      content: "ℹ️ No movie night session is currently active or recovered.",
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("🎬 Movie Night Session Status")
    .setDescription("Session recovered from database after bot restart")
    .addFields(
      { name: "Channel", value: `<#${status.channelId}>`, inline: true },
      { name: "Event Date", value: status.eventDate ?? "Unknown", inline: true },
      { name: "Active Sessions", value: status.sessionCount.toString(), inline: true },
      { name: "Total Recovered Minutes", value: status.totalRecoveredMinutes.toString(), inline: true }
    )
    .setColor(0x5865F2)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
