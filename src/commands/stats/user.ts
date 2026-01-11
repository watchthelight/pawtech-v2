/**
 * Pawtropolis Tech -- src/commands/stats/user.ts
 * WHAT: Handler for /stats user - individual moderator statistics.
 * WHY: Provides detailed performance metrics for a specific moderator.
 * FLOWS:
 *  - /stats user <moderator> [days] -> Shows moderator's decision stats
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
  withStep,
  withSql,
  ensureDeferred,
  type CommandContext,
} from "./shared.js";

/**
 * Handle /stats user subcommand.
 * Shows detailed stats for a specific moderator.
 */
export async function handleUser(
  ctx: CommandContext<ChatInputCommandInteraction>
): Promise<void> {
  const { interaction } = ctx;

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

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const { moderator, days, windowStartS } = await withStep(ctx, "parse_options", async () => {
    const mod = interaction.options.getUser("moderator", true);
    const d = interaction.options.getInteger("days") ?? 30;
    return {
      moderator: mod,
      days: d,
      windowStartS: nowUtc() - d * 86400,
    };
  });

  const row = await withStep(ctx, "fetch_data", async () => {
    const userStatsQuery = `
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
    `;
    return withSql(ctx, userStatsQuery, () => {
      return db.prepare(userStatsQuery).get(interaction.guildId, moderator.id, windowStartS) as
        | {
            total: number;
            approvals: number;
            rejections: number;
            modmail: number;
            perm_reject: number;
            kicks: number;
          }
        | undefined;
    });
  });

  if (!row || row.total === 0) {
    await withStep(ctx, "reply_empty", async () => {
      await interaction.editReply({
        content: `${moderator.tag} has no decisions in the last ${days} days.`,
      });
    });
    return;
  }

  const embed = await withStep(ctx, "build_embed", async () => {
    const avgClaimToDecision = getAvgClaimToDecision(interaction.guildId!, moderator.id, windowStartS);
    const avgSubmitToFirstClaim = getAvgSubmitToFirstClaim(interaction.guildId!, windowStartS);
    const rejects = row.rejections + row.perm_reject + row.kicks;

    return new EmbedBuilder()
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
  });

  await withStep(ctx, "reply", async () => {
    await interaction.editReply({
      embeds: [embed],
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });

    logger.info(
      { guildId: interaction.guildId, moderatorId: moderator.id, days },
      "[stats:user] displayed"
    );
  });
}
