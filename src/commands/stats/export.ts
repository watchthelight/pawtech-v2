/**
 * Pawtropolis Tech -- src/commands/stats/export.ts
 * WHAT: Handler for /stats export - full CSV export of moderator metrics.
 * WHY: Provides data export for external analysis.
 * FLOWS:
 *  - /stats export [days] -> Exports all moderator stats as CSV file
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  AttachmentBuilder,
  MessageFlags,
  db,
  nowUtc,
  logger,
  requireMinRole,
  ROLE_IDS,
  getAvgClaimToDecision,
  formatDuration,
  withStep,
  withSql,
  ensureDeferred,
  type CommandContext,
} from "./shared.js";

/**
 * Handle /stats export subcommand.
 * Exports all moderator metrics as CSV.
 */
export async function handleExport(
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

  // Require Senior Administrator+
  if (!requireMinRole(interaction, ROLE_IDS.SENIOR_ADMIN, {
    command: "stats export",
    description: "Exports moderator metrics as CSV.",
    requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.SENIOR_ADMIN }],
  })) return;

  await withStep(ctx, "defer", async () => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  });

  const { days, windowStartS } = await withStep(ctx, "parse_options", async () => {
    const d = interaction.options.getInteger("days") ?? 30;
    return {
      days: d,
      windowStartS: nowUtc() - d * 86400,
    };
  });

  // Get ALL moderator stats (no limit)
  const rows = await withStep(ctx, "fetch_data", async () => {
    const exportQuery = `
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
    `;
    return withSql(ctx, exportQuery, () => {
      return db.prepare(exportQuery).all(interaction.guildId, windowStartS) as Array<{
        actor_id: string;
        total: number;
        approvals: number;
        rejections: number;
        modmail: number;
        perm_reject: number;
        kicks: number;
      }>;
    });
  });

  if (rows.length === 0) {
    await withStep(ctx, "reply_empty", async () => {
      await interaction.editReply({
        content: `No decisions found in the last ${days} days.`,
      });
    });
    return;
  }

  // Generate CSV
  const attachment = await withStep(ctx, "generate_csv", async () => {
    const csvLines = [
      "Moderator ID,Total Decisions,Approvals,Rejections,Modmail,Perm Reject,Kicks,Avg Response Time (seconds),Avg Response Time (formatted)",
    ];

    for (const row of rows) {
      const avgTime = getAvgClaimToDecision(interaction.guildId!, row.actor_id, windowStartS);
      csvLines.push(
        `${row.actor_id},${row.total},${row.approvals},${row.rejections},${row.modmail},${row.perm_reject},${row.kicks},${avgTime ?? ""},${formatDuration(avgTime)}`
      );
    }

    const csvContent = csvLines.join("\n");
    return new AttachmentBuilder(Buffer.from(csvContent, "utf-8"), {
      name: `stats-full-export-${days}d-${Date.now()}.csv`,
    });
  });

  await withStep(ctx, "reply", async () => {
    await interaction.editReply({
      content: `**Full Moderator Stats Export** (last ${days} days)\n${rows.length} moderators included`,
      files: [attachment],
    });

    logger.info(
      { guildId: interaction.guildId, days, count: rows.length },
      "[stats:export] full CSV export generated"
    );
  });
}
