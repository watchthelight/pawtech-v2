/**
 * Pawtropolis Tech — src/commands/event/game.ts
 * WHAT: Game night subcommand handlers
 * WHY: Handle /event game start/end/attendance/add/credit/bump/resume
 * FLOWS:
 *  - /event game start → start tracking VC attendance
 *  - /event game end → finalize with percentage-based qualification
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { logActionPretty } from "../../logging/pretty.js";
import { getGameConfig, getGameQualificationPercentage } from "../../store/gameConfigStore.js";
import {
  startGameEvent,
  getActiveGameEvent,
  isGameEventActive,
  finalizeGameAttendance,
  getUserQualifiedGameCount,
  getGameRecoveryStatus,
  addManualGameAttendance,
  creditHistoricalGameAttendance,
  bumpGameAttendance,
  getAllGameSessions,
  getCurrentGameSession,
  updateGameTierRole,
} from "../../features/events/gameNight.js";
import { formatQualificationResult } from "../../features/events/gameQualification.js";

/**
 * Route game subcommands to their handlers
 */
export async function handleGameSubcommand(
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
        content: "Unknown game subcommand.",
        ephemeral: true,
      });
  }
}

async function handleStart(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const channel = interaction.options.getChannel("channel", true);

  if (isGameEventActive(guild.id)) {
    await interaction.reply({
      content: "A game night is already in progress. Use `/event game end` to finish it first.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const eventDate = new Date().toISOString().split("T")[0];
  const { retroactiveCount } = await startGameEvent(guild, channel.id, eventDate);
  const config = getGameConfig(guild.id);

  logger.info({
    evt: "game_start_command",
    guildId: guild.id,
    channelId: channel.id,
    eventDate,
    retroactiveCount,
    thresholdPercent: config.qualificationPercentage,
    invokedBy: interaction.user.id,
  }, `Game night started in ${channel.name}`);

  const embed = new EmbedBuilder()
    .setTitle("Game Night Started!")
    .setDescription(`Now tracking attendance in <#${channel.id}>`)
    .addFields(
      { name: "Date", value: eventDate, inline: true },
      { name: "Qualification", value: `>${config.qualificationPercentage}% of event duration`, inline: true }
    )
    .setColor(0x9B59B6)
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

  const event = getActiveGameEvent(guild.id);
  if (!event) {
    await interaction.reply({
      content: "No game night is currently in progress.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  logger.info({
    evt: "game_end_command",
    guildId: guild.id,
    eventDate: event.eventDate,
    invokedBy: interaction.user.id,
  }, "Game night ending");

  const results = await finalizeGameAttendance(guild);
  const qualifiedCount = results.filter(r => r.qualification.qualified).length;

  // Calculate event duration
  const eventDuration = results.length > 0
    ? results[0].qualification.eventDurationMinutes
    : 0;

  // Update tier roles for qualified users
  const qualifiedUsers = results.filter(r => r.qualification.qualified);
  for (const { userId } of qualifiedUsers) {
    await updateGameTierRole(guild, userId);
  }

  const embed = new EmbedBuilder()
    .setTitle("Game Night Ended!")
    .setDescription(`Attendance has been recorded for ${event.eventDate}`)
    .addFields(
      { name: "Total Participants", value: results.length.toString(), inline: true },
      { name: "Qualified", value: qualifiedCount.toString(), inline: true },
      { name: "Event Duration", value: `${eventDuration} minutes`, inline: true }
    )
    .setColor(0x2ECC71)
    .setTimestamp();

  if (results.length > 0) {
    // Sort by attendance percentage descending
    const sorted = [...results].sort(
      (a, b) => b.qualification.attendancePercentage - a.qualification.attendancePercentage
    );

    const topAttendees = sorted.slice(0, 5).map((r, i) => {
      const status = r.qualification.qualified ? "Qualified" : "Not qualified";
      return `${i + 1}. <@${r.userId}> - ${r.qualification.attendancePercentage}% (${r.session.totalMinutes} min) - ${status}`;
    }).join("\n");

    embed.addFields({ name: "Top Attendees", value: topAttendees || "None" });
  }

  const config = getGameConfig(guild.id);
  embed.setFooter({
    text: `Threshold: ${config.qualificationPercentage}% of event duration`
  });

  await interaction.editReply({ embeds: [embed] });
}

async function handleAttendance(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const user = interaction.options.getUser("user");

  await interaction.deferReply({ ephemeral: false });

  // Check if there's an active event - show live stats
  const activeEvent = getActiveGameEvent(guild.id);

  if (!user) {
    // Show all attendees
    if (activeEvent) {
      // Show live session data
      const sessions = getAllGameSessions(guild.id);
      const config = getGameConfig(guild.id);

      const embed = new EmbedBuilder()
        .setTitle("Game Night Attendance (Live)")
        .setDescription(`Active event in <#${activeEvent.channelId}>`)
        .setColor(0x9B59B6)
        .setTimestamp();

      const lines: string[] = [];
      const now = Date.now();
      const currentDuration = Math.floor((now - activeEvent.startedAt) / 60000);

      for (const [userId, session] of sessions) {
        let totalMinutes = session.totalMinutes;
        if (session.currentSessionStart) {
          totalMinutes += Math.floor((now - session.currentSessionStart) / 60000);
        }
        const pct = currentDuration > 0 ? Math.round((totalMinutes / currentDuration) * 100) : 0;
        const inVC = session.currentSessionStart ? " (in VC)" : "";
        lines.push(`<@${userId}> — ${totalMinutes}min (${pct}%)${inVC}`);
      }

      if (lines.length > 0) {
        embed.addFields({
          name: `Participants (${sessions.size})`,
          value: lines.slice(0, 15).join("\n") || "None yet",
        });
        if (lines.length > 15) {
          embed.addFields({ name: "​", value: `...and ${lines.length - 15} more` });
        }
      } else {
        embed.addFields({ name: "Participants", value: "No participants yet" });
      }

      embed.setFooter({
        text: `Event running for ${currentDuration} min | Threshold: ${config.qualificationPercentage}%`
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Show historical data from most recent event
    const latestEvent = db.prepare(`
      SELECT DISTINCT event_date FROM movie_attendance
      WHERE guild_id = ? AND event_type = 'game'
      ORDER BY event_date DESC
      LIMIT 1
    `).get(guild.id) as { event_date: string } | undefined;

    if (!latestEvent) {
      await interaction.editReply({ content: "No game night attendance records yet!" });
      return;
    }

    const allAttendees = db.prepare(`
      SELECT user_id, duration_minutes, longest_session_minutes, qualified,
             event_start_time, event_end_time
      FROM movie_attendance
      WHERE guild_id = ? AND event_date = ? AND event_type = 'game'
      ORDER BY duration_minutes DESC
    `).all(guild.id, latestEvent.event_date) as Array<{
      user_id: string;
      duration_minutes: number;
      longest_session_minutes: number;
      qualified: number;
      event_start_time: number | null;
      event_end_time: number | null;
    }>;

    // Calculate event duration from first record
    const eventDuration = allAttendees[0]?.event_start_time && allAttendees[0]?.event_end_time
      ? Math.floor((allAttendees[0].event_end_time - allAttendees[0].event_start_time) / 60000)
      : null;

    const embed = new EmbedBuilder()
      .setTitle("Game Night Attendance")
      .setDescription(`Results from ${latestEvent.event_date}`)
      .setColor(0x9B59B6)
      .setTimestamp();

    const lines = allAttendees.map(a => {
      const status = a.qualified ? "Qualified" : "Not qualified";
      const pct = eventDuration ? Math.round((a.duration_minutes / eventDuration) * 100) : 0;
      return `${a.qualified ? "Qualified" : "Not qualified"} <@${a.user_id}> — ${a.duration_minutes}min (${pct}%)`;
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
    embed.setFooter({
      text: `${qualifiedCount} qualified | Event duration: ${eventDuration ?? "?"}min`
    });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Show stats for specific user
  const qualifiedCount = getUserQualifiedGameCount(guild.id, user.id);

  const recentAttendance = db.prepare(`
    SELECT event_date, duration_minutes, longest_session_minutes, qualified,
           event_start_time, event_end_time
    FROM movie_attendance
    WHERE guild_id = ? AND user_id = ? AND event_type = 'game'
    ORDER BY event_date DESC
    LIMIT 10
  `).all(guild.id, user.id) as Array<{
    event_date: string;
    duration_minutes: number;
    longest_session_minutes: number;
    qualified: number;
    event_start_time: number | null;
    event_end_time: number | null;
  }>;

  const embed = new EmbedBuilder()
    .setTitle("Game Night Attendance")
    .setDescription(`Stats for ${user}`)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: "Total Qualified Game Nights", value: qualifiedCount.toString(), inline: true }
    )
    .setColor(0x9B59B6)
    .setTimestamp();

  // Check if user is in active event
  if (activeEvent) {
    const session = getCurrentGameSession(guild.id, user.id);
    if (session) {
      const now = Date.now();
      let totalMinutes = session.totalMinutes;
      if (session.currentSessionStart) {
        totalMinutes += Math.floor((now - session.currentSessionStart) / 60000);
      }
      const eventDuration = Math.floor((now - activeEvent.startedAt) / 60000);
      const pct = eventDuration > 0 ? Math.round((totalMinutes / eventDuration) * 100) : 0;

      embed.addFields({
        name: "Current Event (Live)",
        value: `${totalMinutes} min (${pct}% of ${eventDuration} min)${session.currentSessionStart ? " - In VC" : ""}`,
        inline: true,
      });
    }
  }

  if (recentAttendance.length > 0) {
    const history = recentAttendance.map(a => {
      const status = a.qualified ? "Qualified" : "Not qualified";
      const eventDuration = a.event_start_time && a.event_end_time
        ? Math.floor((a.event_end_time - a.event_start_time) / 60000)
        : null;
      const pct = eventDuration ? Math.round((a.duration_minutes / eventDuration) * 100) : 0;
      return `${status} ${a.event_date}: ${a.duration_minutes}min (${pct}%)`;
    }).join("\n");
    embed.addFields({ name: "Recent Game Nights", value: history });
  } else {
    embed.addFields({ name: "Recent Game Nights", value: "No attendance records yet" });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const user = interaction.options.getUser("user", true);
  const minutes = interaction.options.getInteger("minutes", true);
  const reason = interaction.options.getString("reason") ?? undefined;

  const success = addManualGameAttendance(
    guild.id,
    user.id,
    minutes,
    interaction.user.id,
    reason
  );

  if (!success) {
    await interaction.reply({
      content: "No game night is currently in progress. Use `/event game credit` to credit historical attendance.",
      ephemeral: true,
    });
    return;
  }

  await logActionPretty(guild, {
    actorId: interaction.user.id,
    subjectId: user.id,
    action: "game_manual_add",
    reason: reason ?? `Manually added ${minutes} minutes`,
    meta: {
      minutes,
      eventDate: getActiveGameEvent(guild.id)?.eventDate ?? "unknown",
    },
  }).catch(() => {});

  const embed = new EmbedBuilder()
    .setTitle("Game Attendance Updated")
    .setDescription(`Added **${minutes} minutes** to ${user}'s attendance`)
    .setColor(0x2ECC71)
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

  creditHistoricalGameAttendance(
    guild.id,
    user.id,
    dateStr,
    minutes,
    interaction.user.id,
    reason
  );

  await logActionPretty(guild, {
    actorId: interaction.user.id,
    subjectId: user.id,
    action: "game_credit",
    reason: reason ?? `Credited ${minutes} minutes for ${dateStr}`,
    meta: { minutes, eventDate: dateStr },
  }).catch(() => {});

  const newCount = getUserQualifiedGameCount(guild.id, user.id);

  const embed = new EmbedBuilder()
    .setTitle("Game Attendance Credited")
    .setDescription(`Credited **${minutes} minutes** to ${user} for ${dateStr}`)
    .addFields(
      { name: "Total Qualified Game Nights", value: newCount.toString(), inline: true }
    )
    .setColor(0x2ECC71)
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

  const result = bumpGameAttendance(
    guild.id,
    user.id,
    dateStr,
    interaction.user.id,
    reason
  );

  if (result.previouslyQualified) {
    await interaction.editReply({
      content: `${user} already has a qualified game attendance record for ${dateStr}.`,
    });
    return;
  }

  // Update tier role since bump creates a qualified record
  await updateGameTierRole(guild, user.id);

  await logActionPretty(guild, {
    actorId: interaction.user.id,
    subjectId: user.id,
    action: "game_bump",
    reason: reason ?? `Bump compensation for ${dateStr}`,
    meta: { eventDate: dateStr },
  }).catch(() => {});

  const newCount = getUserQualifiedGameCount(guild.id, user.id);

  const embed = new EmbedBuilder()
    .setTitle("Game Attendance Bumped")
    .setDescription(`${user} has been given full credit for ${dateStr}`)
    .addFields(
      { name: "Total Qualified Game Nights", value: newCount.toString(), inline: true }
    )
    .setColor(0x2ECC71)
    .setTimestamp();

  if (reason) {
    embed.addFields({ name: "Reason", value: reason });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleResume(interaction: ChatInputCommandInteraction): Promise<void> {
  const status = getGameRecoveryStatus();

  if (!status.hasActiveEvent) {
    await interaction.reply({
      content: "No game night session is currently active or recovered.",
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Game Night Session Status")
    .setDescription("Session recovered from database after bot restart")
    .addFields(
      { name: "Channel", value: `<#${status.channelId}>`, inline: true },
      { name: "Event Date", value: status.eventDate ?? "Unknown", inline: true },
      { name: "Active Sessions", value: status.sessionCount.toString(), inline: true },
      { name: "Total Recovered Minutes", value: status.totalRecoveredMinutes.toString(), inline: true }
    )
    .setColor(0x9B59B6)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
