/**
 * Pawtropolis Tech -- src/commands/modstats/leaderboard.ts
 * WHAT: Leaderboard and export handlers for moderator statistics.
 * WHY: Provides gamification and transparency for review team performance.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  AttachmentBuilder,
} from "discord.js";
import { db } from "../../db/db.js";
import { nowUtc } from "../../lib/time.js";
import { logger } from "../../lib/logger.js";
import { generateLeaderboardImage, type ModStats } from "../../lib/leaderboardImage.js";
import { getAvgClaimToDecision, formatDuration } from "./helpers.js";

/**
 * WHAT: Handle /modstats leaderboard subcommand.
 * WHY: Gamification + transparency for review team performance.
 */
export async function handleLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "❌ This command must be run in a guild.",
      ephemeral: true,
    });
    return;
  }

  // Defer reply immediately - this command does heavy async work (DB queries, member fetches, image generation)
  // Discord times out interactions after 3 seconds without a response
  await interaction.deferReply();

  const days = interaction.options.getInteger("days") ?? 30;
  const exportCsv = interaction.options.getBoolean("export") ?? false;
  const windowStartS = nowUtc() - days * 86400;

  /*
   * Leaderboard query aggregates by actor_id within the time window.
   * The ORDER BY prioritizes total decisions, then approvals as tiebreaker.
   *
   * LIMIT 100 is a safety cap - we only display top 15 in the image, but
   * fetch more in case CSV export is requested. In practice, most servers
   * have fewer than 100 active moderators.
   *
   * NOTE: This query can be slow on very large action_log tables. Consider
   * adding an index on (guild_id, created_at_s, action) if you see issues.
   */
  const rows = db
    .prepare(
      `
      SELECT
        actor_id,
        COUNT(*) as total,
        SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) as approvals,
        SUM(CASE WHEN action = 'reject' THEN 1 ELSE 0 END) as rejections,
        SUM(CASE WHEN action = 'modmail_open' THEN 1 ELSE 0 END) as modmail,
        SUM(CASE WHEN action = 'perm_reject' THEN 1 ELSE 0 END) as perm_reject,
        SUM(CASE WHEN action = 'kick' THEN 1 ELSE 0 END) as kicks
      FROM action_log
      WHERE guild_id = ?
        AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
        AND created_at_s >= ?
      GROUP BY actor_id
      ORDER BY total DESC, approvals DESC
      LIMIT 100
    `
    )
    .all(interaction.guildId, windowStartS) as Array<{
    actor_id: string;
    total: number;
    approvals: number;
    rejections: number;
    modmail: number;
    perm_reject: number;
    kicks: number;
  }>;

  if (rows.length === 0) {
    await interaction.editReply({
      content: `📊 No decisions found in the last ${days} days.`,
    });
    return;
  }

  // Handle CSV export
  if (exportCsv) {
    const csvLines = [
      "Moderator ID,Total Decisions,Approvals,Rejections,Modmail,Perm Reject,Kicks,Avg Response Time (seconds)",
    ];

    for (const row of rows) {
      const avgTime = getAvgClaimToDecision(interaction.guildId, row.actor_id, windowStartS);
      csvLines.push(
        `${row.actor_id},${row.total},${row.approvals},${row.rejections},${row.modmail},${row.perm_reject},${row.kicks},${avgTime ?? ""}`
      );
    }

    const csvContent = csvLines.join("\n");
    const attachment = new AttachmentBuilder(Buffer.from(csvContent, "utf-8"), {
      name: `modstats-leaderboard-${days}d-${Date.now()}.csv`,
    });

    await interaction.editReply({
      content: `📊 **Moderator Leaderboard Export** (last ${days} days)\n${rows.length} moderators`,
      files: [attachment],
    });

    logger.info(
      { guildId: interaction.guildId, days, count: rows.length },
      "[modstats] CSV export generated"
    );
    return;
  }

  // Display image-based leaderboard (limit to top 15 for readability)
  const displayRows = rows.slice(0, 15);

  // Build ModStats array for image generation
  const modStatsData: ModStats[] = [];

  for (let i = 0; i < displayRows.length; i++) {
    const row = displayRows[i];
    const avgTime = getAvgClaimToDecision(interaction.guildId, row.actor_id, windowStartS);
    const rejects = row.rejections + row.perm_reject + row.kicks;

    // Fetch display name and role color
    let displayName = "Unknown";
    let roleColor: string | undefined;
    try {
      const member = await interaction.guild?.members.fetch(row.actor_id);
      displayName = member?.displayName || "Unknown";
      // Get display color (highest colored role)
      const hexColor = member?.displayHexColor;
      if (hexColor && hexColor !== "#000000") {
        roleColor = hexColor;
      }
    } catch {
      // User may have left the server
    }

    modStatsData.push({
      rank: i + 1,
      displayName,
      total: row.total,
      approvals: row.approvals,
      rejections: rejects,
      modmail: row.modmail,
      avgTimeSeconds: avgTime ?? 0,
      roleColor,
    });
  }

  // Generate full-width leaderboard image
  const imageBuffer = await generateLeaderboardImage(modStatsData);
  const attachment = new AttachmentBuilder(imageBuffer, { name: "leaderboard.png" });

  const embed = new EmbedBuilder()
    .setTitle("📊 Moderator Leaderboard")
    .setDescription(`Top moderators by decisions (last ${days} days)`)
    .setImage("attachment://leaderboard.png")
    .setColor(0x5865f2)
    .setTimestamp();

  if (rows.length > 15) {
    embed.setFooter({
      text: `Showing top 15 of ${rows.length} moderators. Use export=true for full list.`,
    });
  }

  await interaction.editReply({
    embeds: [embed],
    files: [attachment],
  });

  logger.info(
    { guildId: interaction.guildId, days, count: rows.length },
    "[modstats] leaderboard displayed"
  );
}

/**
 * WHAT: Handle /modstats export subcommand.
 * WHY: Provides full CSV export for external analysis.
 */
export async function handleExport(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "❌ This command must be run in a guild.",
      ephemeral: true,
    });
    return;
  }

  // Defer reply - DB queries can take time
  await interaction.deferReply({ ephemeral: true });

  const days = interaction.options.getInteger("days") ?? 30;
  const windowStartS = nowUtc() - days * 86400;

  // Get ALL moderator stats (no limit)
  const rows = db
    .prepare(
      `
      SELECT
        actor_id,
        COUNT(*) as total,
        SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) as approvals,
        SUM(CASE WHEN action = 'reject' THEN 1 ELSE 0 END) as rejections,
        SUM(CASE WHEN action = 'modmail_open' THEN 1 ELSE 0 END) as modmail,
        SUM(CASE WHEN action = 'perm_reject' THEN 1 ELSE 0 END) as perm_reject,
        SUM(CASE WHEN action = 'kick' THEN 1 ELSE 0 END) as kicks
      FROM action_log
      WHERE guild_id = ?
        AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
        AND created_at_s >= ?
      GROUP BY actor_id
      ORDER BY total DESC, approvals DESC
    `
    )
    .all(interaction.guildId, windowStartS) as Array<{
    actor_id: string;
    total: number;
    approvals: number;
    rejections: number;
    modmail: number;
    perm_reject: number;
    kicks: number;
  }>;

  if (rows.length === 0) {
    await interaction.editReply({
      content: `📊 No decisions found in the last ${days} days.`,
    });
    return;
  }

  // Generate CSV
  const csvLines = [
    "Moderator ID,Total Decisions,Approvals,Rejections,Modmail,Perm Reject,Kicks,Avg Response Time (seconds),Avg Response Time (formatted)",
  ];

  for (const row of rows) {
    const avgTime = getAvgClaimToDecision(interaction.guildId, row.actor_id, windowStartS);
    csvLines.push(
      `${row.actor_id},${row.total},${row.approvals},${row.rejections},${row.modmail},${row.perm_reject},${row.kicks},${avgTime ?? ""},${formatDuration(avgTime)}`
    );
  }

  const csvContent = csvLines.join("\n");
  const attachment = new AttachmentBuilder(Buffer.from(csvContent, "utf-8"), {
    name: `modstats-full-export-${days}d-${Date.now()}.csv`,
  });

  await interaction.editReply({
    content: `📊 **Full Moderator Stats Export** (last ${days} days)\n✅ ${rows.length} moderators included`,
    files: [attachment],
  });

  logger.info(
    { guildId: interaction.guildId, days, count: rows.length },
    "[modstats] full CSV export generated"
  );
}
