/**
 * Pawtropolis Tech — src/commands/event/movie.ts
 * WHAT: Movie night subcommand handlers for /event movie
 * WHY: Provides unified /event movie interface using existing movieNight logic
 * NOTE: This mirrors the logic from src/commands/movie.ts but under /event movie
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { logActionPretty } from "../../logging/pretty.js";
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
} from "../../features/movieNight.js";

/**
 * Route movie subcommands to their handlers
 */
export async function handleMovieSubcommand(
  interaction: ChatInputCommandInteraction,
  subcommand: string
): Promise<void> {
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
        content: "Unknown movie subcommand.",
        ephemeral: true,
      });
  }
}

async function handleStart(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const channel = interaction.options.getChannel("channel", true);

  if (isMovieEventActive(guild.id)) {
    await interaction.reply({
      content: "A movie night is already in progress. Use `/event movie end` to finish it first.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const eventDate = new Date().toISOString().split("T")[0];
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
    .setTitle("Movie Night Started!")
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
      content: "No movie night is currently in progress.",
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

  await finalizeMovieAttendance(guild);

  const qualifiedUsers = db.prepare(`
    SELECT user_id, duration_minutes, longest_session_minutes
    FROM movie_attendance
    WHERE guild_id = ? AND event_date = ? AND qualified = 1 AND event_type = 'movie'
    ORDER BY duration_minutes DESC
  `).all(guild.id, event.eventDate) as Array<{
    user_id: string;
    duration_minutes: number;
    longest_session_minutes: number;
  }>;

  for (const user of qualifiedUsers) {
    await updateMovieTierRole(guild, user.user_id);
  }

  const totalAttendees = db.prepare(`
    SELECT COUNT(*) as count
    FROM movie_attendance
    WHERE guild_id = ? AND event_date = ? AND event_type = 'movie'
  `).get(guild.id, event.eventDate) as { count: number };

  const threshold = getMovieQualificationThreshold(guild.id);

  const embed = new EmbedBuilder()
    .setTitle("Movie Night Ended!")
    .setDescription(`Attendance has been recorded for ${event.eventDate}`)
    .addFields(
      { name: "Total Participants", value: totalAttendees.count.toString(), inline: true },
      { name: `Qualified (${threshold}+ min)`, value: qualifiedUsers.length.toString(), inline: true }
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

  if (!user) {
    const latestEvent = db.prepare(`
      SELECT DISTINCT event_date FROM movie_attendance
      WHERE guild_id = ? AND event_type = 'movie'
      ORDER BY event_date DESC
      LIMIT 1
    `).get(guild.id) as { event_date: string } | undefined;

    if (!latestEvent) {
      await interaction.editReply({ content: "No movie night attendance records yet!" });
      return;
    }

    const allAttendees = db.prepare(`
      SELECT user_id, duration_minutes, longest_session_minutes, qualified
      FROM movie_attendance
      WHERE guild_id = ? AND event_date = ? AND event_type = 'movie'
      ORDER BY duration_minutes DESC
    `).all(guild.id, latestEvent.event_date) as Array<{
      user_id: string;
      duration_minutes: number;
      longest_session_minutes: number;
      qualified: number;
    }>;

    const embed = new EmbedBuilder()
      .setTitle("Movie Night Attendance")
      .setDescription(`All attendees from ${latestEvent.event_date}`)
      .setColor(0x5865F2)
      .setTimestamp();

    const lines = allAttendees.map((a) => {
      const status = a.qualified ? "Qualified" : "Not qualified";
      return `${status} <@${a.user_id}> — ${a.duration_minutes}min total (longest: ${a.longest_session_minutes}min)`;
    });

    if (lines.length > 0) {
      const chunkSize = 10;
      for (let i = 0; i < lines.length; i += chunkSize) {
        const chunk = lines.slice(i, i + chunkSize);
        embed.addFields({
          name: i === 0 ? `Attendees (${allAttendees.length} total)` : "​",
          value: chunk.join("\n"),
        });
      }
    } else {
      embed.addFields({ name: "Attendees", value: "No attendees recorded" });
    }

    const qualifiedCount = allAttendees.filter(a => a.qualified).length;
    const threshold = getMovieQualificationThreshold(guild.id);
    embed.setFooter({ text: `${qualifiedCount} qualified (${threshold}+ min) out of ${allAttendees.length} total` });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const qualifiedCount = getUserQualifiedMovieCount(guild.id, user.id);

  const recentAttendance = db.prepare(`
    SELECT event_date, duration_minutes, longest_session_minutes, qualified
    FROM movie_attendance
    WHERE guild_id = ? AND user_id = ? AND event_type = 'movie'
    ORDER BY event_date DESC
    LIMIT 10
  `).all(guild.id, user.id) as Array<{
    event_date: string;
    duration_minutes: number;
    longest_session_minutes: number;
    qualified: number;
  }>;

  const embed = new EmbedBuilder()
    .setTitle("Movie Night Attendance")
    .setDescription(`Stats for ${user}`)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: "Total Qualified Movies", value: qualifiedCount.toString(), inline: true }
    )
    .setColor(0x5865F2)
    .setTimestamp();

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
      const status = a.qualified ? "Qualified" : "Not qualified";
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
      content: "No movie night is currently in progress. Use `/event movie credit` to credit historical attendance.",
      ephemeral: true,
    });
    return;
  }

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
    .setTitle("Attendance Updated")
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

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    await interaction.reply({
      content: "Invalid date format. Use YYYY-MM-DD (e.g., 2024-01-15)",
      ephemeral: true,
    });
    return;
  }

  const today = new Date().toISOString().split("T")[0];
  if (dateStr > today) {
    await interaction.reply({
      content: "Cannot credit attendance for future dates.",
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

  await updateMovieTierRole(guild, user.id);

  await logActionPretty(guild, {
    actorId: interaction.user.id,
    subjectId: user.id,
    action: "movie_credit",
    reason: reason ?? `Credited ${minutes} minutes for ${dateStr}`,
    meta: { minutes, eventDate: dateStr },
  }).catch(() => {});

  const newCount = getUserQualifiedMovieCount(guild.id, user.id);

  const embed = new EmbedBuilder()
    .setTitle("Attendance Credited")
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

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    await interaction.reply({
      content: "Invalid date format. Use YYYY-MM-DD (e.g., 2024-01-15)",
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
      content: `${user} already has a qualified attendance record for ${dateStr}.`,
    });
    return;
  }

  await updateMovieTierRole(guild, user.id);

  await logActionPretty(guild, {
    actorId: interaction.user.id,
    subjectId: user.id,
    action: "movie_bump",
    reason: reason ?? `Bump compensation for ${dateStr}`,
    meta: { eventDate: dateStr },
  }).catch(() => {});

  const newCount = getUserQualifiedMovieCount(guild.id, user.id);

  const embed = new EmbedBuilder()
    .setTitle("Attendance Bumped")
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
      content: "No movie night session is currently active or recovered.",
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Movie Night Session Status")
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
