/**
 * Pawtropolis Tech -- src/commands/stats/approvalRate.ts
 * WHAT: Handler for /stats approval-rate - server-wide approval analytics.
 * WHY: Provides staff with approval/rejection rate trends.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  hasStaffPermissions,
  nowUtc,
  logger,
  captureException,
  type CommandContext,
  type GuildMember,
} from "./shared.js";
import {
  getApprovalRateTrend,
  getTopRejectionReasons,
} from "../../features/analytics/approvalRate.js";

/**
 * Handle /stats approval-rate subcommand.
 * Displays server-wide approval/rejection rate analytics with trend comparison.
 */
export async function handleApprovalRate(
  ctx: CommandContext<ChatInputCommandInteraction>
): Promise<void> {
  const { interaction } = ctx;
  const start = Date.now();

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guildId) {
      await interaction.editReply({
        content: "This command must be run in a server.",
      });
      return;
    }

    // Permission check - Staff only
    const member = interaction.member as GuildMember | null;
    if (!member || !hasStaffPermissions(member, interaction.guildId)) {
      await interaction.editReply({
        content: "You don't have permission to use this command.",
      });
      return;
    }

    const days = interaction.options.getInteger("days") ?? 30;

    const now = nowUtc();
    const from = now - days * 86400;
    const to = now;

    captureException(null, {
      area: "stats.approval-rate.run",
      tags: { days, from, to, guildId: interaction.guildId },
    });

    const trend = getApprovalRateTrend({
      guildId: interaction.guildId,
      from,
      to,
    });

    const rejectionReasons = getTopRejectionReasons(
      { guildId: interaction.guildId, from, to },
      5
    );

    const { current, previous, approvalRateDelta, trendDirection } = trend;

    const trendArrow =
      trendDirection === "up" ? "\u2191" : trendDirection === "down" ? "\u2193" : "\u2194";
    const trendSign = approvalRateDelta >= 0 ? "+" : "";
    const trendColor =
      trendDirection === "up" ? 0x57f287 : trendDirection === "down" ? 0xed4245 : 0x5865f2;

    const embed = new EmbedBuilder()
      .setTitle(`Approval Rate Analytics (Last ${days} Days)`)
      .setColor(trendColor)
      .setTimestamp();

    const statsLines = [
      `**Total Decisions:** ${current.total}`,
      "",
      `Approved: ${current.approvals} (${current.approvalPct.toFixed(1)}%)`,
      `Rejected: ${current.rejections} (${current.rejectionPct.toFixed(1)}%)`,
      `Kicked: ${current.kicks} (${current.kickPct.toFixed(1)}%)`,
      `Perm Rejected: ${current.permRejects} (${current.permRejectPct.toFixed(1)}%)`,
    ];

    embed.addFields({
      name: "Overall Stats",
      value: statsLines.join("\n"),
      inline: false,
    });

    const trendLines = [
      `Approval rate: **${current.approvalPct.toFixed(1)}%** ${trendArrow} was ${previous.approvalPct.toFixed(1)}% (${trendSign}${approvalRateDelta.toFixed(1)}%)`,
      "",
      `Previous period: ${previous.total} total decisions`,
    ];

    embed.addFields({
      name: `Trend (vs previous ${days} days)`,
      value: trendLines.join("\n"),
      inline: false,
    });

    if (rejectionReasons.length > 0) {
      const reasonLines = rejectionReasons.map((r, i) => {
        const truncatedReason =
          r.reason.length > 40 ? r.reason.slice(0, 37) + "..." : r.reason;
        return `${i + 1}. ${truncatedReason} (${r.percentage.toFixed(0)}%)`;
      });

      embed.addFields({
        name: "Top Rejection Reasons",
        value: reasonLines.join("\n"),
        inline: false,
      });
    } else {
      embed.addFields({
        name: "Top Rejection Reasons",
        value: "No rejections in this period",
        inline: false,
      });
    }

    embed.setFooter({
      text: `Data from ${new Date(from * 1000).toLocaleDateString()} to ${new Date(to * 1000).toLocaleDateString()}`,
    });

    const elapsed = Date.now() - start;
    logger.info(
      {
        render: "stats:approval-rate",
        ms: elapsed,
        days,
        guildId: interaction.guildId,
        total: current.total,
        approvalPct: current.approvalPct,
        trend: trendDirection,
      },
      "[stats:approval-rate] render completed"
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const traceId = ctx.traceId;
    logger.error({ err, traceId }, "[stats:approval-rate] command failed");
    captureException(err, { area: "stats.approval-rate.run", traceId });

    await interaction
      .editReply({
        content: `Analytics query failed. Trace ID: \`${traceId}\``,
      })
      .catch(() => undefined);
  }
}
