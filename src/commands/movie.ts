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
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import {
  startMovieEvent,
  getActiveMovieEvent,
  isMovieEventActive,
  finalizeMovieAttendance,
  getUserQualifiedMovieCount,
  updateMovieTierRole,
} from "../features/movieNight.js";

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

  // Check ManageEvents permission
  const member = interaction.member;
  if (!member || typeof member.permissions === "string" || !member.permissions.has("ManageEvents")) {
    await interaction.reply({
      content: "❌ You need the **Manage Events** permission to use this command.",
      ephemeral: true,
    });
    return;
  }

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

  const eventDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  startMovieEvent(guild.id, channel.id, eventDate);

  logger.info({
    evt: "movie_start_command",
    guildId: guild.id,
    channelId: channel.id,
    eventDate,
    invokedBy: interaction.user.id,
  }, `Movie night started in ${channel.name}`);

  const embed = new EmbedBuilder()
    .setTitle("🎬 Movie Night Started!")
    .setDescription(`Now tracking attendance in <#${channel.id}>`)
    .addFields(
      { name: "Date", value: eventDate, inline: true },
      { name: "Minimum Time", value: "30 minutes to qualify", inline: true }
    )
    .setColor(0x5865F2)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
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

  await interaction.deferReply({ ephemeral: true });

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

  // Determine current tier
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
