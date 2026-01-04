/**
 * Pawtropolis Tech -- src/commands/stats/leaderboard.ts
 * WHAT: Handler for /stats leaderboard - moderator rankings.
 * WHY: Provides gamification and transparency for review team performance.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  AttachmentBuilder,
  db,
  nowUtc,
  logger,
  requireMinRole,
  ROLE_IDS,
  getAvgClaimToDecision,
} from "./shared.js";
import { generateLeaderboardImage, type ModStats } from "../../lib/leaderboardImage.js";

/**
 * Handle /stats leaderboard subcommand.
 * Shows ranked list of moderators by decisions with optional CSV export.
 */
export async function handleLeaderboard(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command must be run in a guild.",
      ephemeral: true,
    });
    return;
  }

  // Require Gatekeeper+
  if (!requireMinRole(interaction, ROLE_IDS.GATEKEEPER, {
    command: "stats leaderboard",
    description: "Views moderator leaderboard.",
    requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.GATEKEEPER }],
  })) return;

  await interaction.deferReply();

  const days = interaction.options.getInteger("days") ?? 30;
  const exportCsv = interaction.options.getBoolean("export") ?? false;
  const windowStartS = nowUtc() - days * 86400;

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
      content: `No decisions found in the last ${days} days.`,
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
      name: `stats-leaderboard-${days}d-${Date.now()}.csv`,
    });

    await interaction.editReply({
      content: `**Moderator Leaderboard Export** (last ${days} days)\n${rows.length} moderators`,
      files: [attachment],
    });

    logger.info(
      { guildId: interaction.guildId, days, count: rows.length },
      "[stats:leaderboard] CSV export generated"
    );
    return;
  }

  // Display image-based leaderboard
  const displayRows = rows.slice(0, 15);

  const memberIds = displayRows.map(r => r.actor_id);
  let members: Awaited<ReturnType<typeof interaction.guild!.members.fetch>> | undefined;
  try {
    members = await interaction.guild?.members.fetch({ user: memberIds });
  } catch {
    // If batch fetch fails, continue with empty map
  }

  const modStatsData: ModStats[] = [];

  for (let i = 0; i < displayRows.length; i++) {
    const row = displayRows[i];
    const avgTime = getAvgClaimToDecision(interaction.guildId, row.actor_id, windowStartS);
    const rejects = row.rejections + row.perm_reject + row.kicks;

    let displayName = "Unknown";
    let roleColor: string | undefined;
    const member = members?.get(row.actor_id);
    if (member) {
      displayName = member.displayName || "Unknown";
      const hexColor = member.displayHexColor;
      if (hexColor && hexColor !== "#000000") {
        roleColor = hexColor;
      }
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

  const imageBuffer = await generateLeaderboardImage(modStatsData);
  const attachment = new AttachmentBuilder(imageBuffer, { name: "leaderboard.png" });

  const embed = new EmbedBuilder()
    .setTitle("Moderator Leaderboard")
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
    "[stats:leaderboard] displayed"
  );
}
