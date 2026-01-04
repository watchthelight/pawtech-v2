/**
 * Pawtropolis Tech -- src/commands/stats/user.ts
 * WHAT: Handler for /stats user - individual moderator statistics.
 * WHY: Provides detailed performance metrics for a specific moderator.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  db,
  nowUtc,
  logger,
  requireMinRole,
  ROLE_IDS,
  SAFE_ALLOWED_MENTIONS,
  getAvgClaimToDecision,
  getAvgSubmitToFirstClaim,
  formatDuration,
} from "./shared.js";

/**
 * Handle /stats user subcommand.
 * Shows detailed stats for a specific moderator.
 */
export async function handleUser(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command must be run in a guild.",
      ephemeral: true,
    });
    return;
  }

  // Require Gatekeeper+
  if (!requireMinRole(interaction, ROLE_IDS.GATEKEEPER, {
    command: "stats user",
    description: "Views individual moderator stats.",
    requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.GATEKEEPER }],
  })) return;

  await interaction.deferReply();

  const moderator = interaction.options.getUser("moderator", true);
  const days = interaction.options.getInteger("days") ?? 30;
  const windowStartS = nowUtc() - days * 86400;

  const row = db
    .prepare(
      `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) as approvals,
        SUM(CASE WHEN action = 'reject' THEN 1 ELSE 0 END) as rejections,
        SUM(CASE WHEN action = 'modmail_open' THEN 1 ELSE 0 END) as modmail,
        SUM(CASE WHEN action = 'perm_reject' THEN 1 ELSE 0 END) as perm_reject,
        SUM(CASE WHEN action = 'kick' THEN 1 ELSE 0 END) as kicks
      FROM action_log
      WHERE guild_id = ?
        AND actor_id = ?
        AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
        AND created_at_s >= ?
    `
    )
    .get(interaction.guildId, moderator.id, windowStartS) as
    | {
        total: number;
        approvals: number;
        rejections: number;
        modmail: number;
        perm_reject: number;
        kicks: number;
      }
    | undefined;

  if (!row || row.total === 0) {
    await interaction.editReply({
      content: `${moderator.tag} has no decisions in the last ${days} days.`,
    });
    return;
  }

  const avgClaimToDecision = getAvgClaimToDecision(interaction.guildId, moderator.id, windowStartS);
  const avgSubmitToFirstClaim = getAvgSubmitToFirstClaim(interaction.guildId, windowStartS);
  const rejects = row.rejections + row.perm_reject + row.kicks;

  const embed = new EmbedBuilder()
    .setTitle(`Moderator Stats: ${moderator.tag}`)
    .setDescription(`Performance metrics (last ${days} days)`)
    .setColor(0x5865f2)
    .setThumbnail(moderator.displayAvatarURL())
    .setTimestamp()
    .addFields(
      { name: "Decisions", value: `**${row.total}**`, inline: true },
      { name: "Accepted", value: `${row.approvals}`, inline: true },
      { name: "Rejected", value: `${rejects}`, inline: true },
      { name: "Modmail", value: `${row.modmail}`, inline: true },
      {
        name: "Avg Claim to Decision",
        value: formatDuration(avgClaimToDecision),
        inline: true,
      },
      {
        name: "Server Avg: Submit to First Claim",
        value: formatDuration(avgSubmitToFirstClaim),
        inline: true,
      }
    );

  await interaction.editReply({
    embeds: [embed],
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  });

  logger.info(
    { guildId: interaction.guildId, moderatorId: moderator.id, days },
    "[stats:user] displayed"
  );
}
