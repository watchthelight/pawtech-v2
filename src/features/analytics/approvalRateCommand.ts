/**
 * Pawtropolis Tech -- src/features/analytics/approvalRateCommand.ts
 * WHAT: Slash command handler for /approval-rate.
 * WHY: Displays server-wide approval/rejection rate analytics with trend comparison.
 * FLOWS:
 *  - /approval-rate [days] -> ephemeral embed with stats, trend, and top rejection reasons
 * DOCS:
 *  - discord.js Commands: https://discord.js.org/#/docs/discord.js/main/class/ChatInputCommandInteraction
 *  - EmbedBuilder: https://discord.js.org/#/docs/discord.js/main/class/EmbedBuilder
 *
 * NOTE: Staff-only command. Uses ephemeral replies to avoid cluttering channels.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  GuildMember,
} from "discord.js";
import type { CommandContext } from "../../lib/cmdWrap.js";
import { captureException } from "../../lib/sentry.js";
import { logger } from "../../lib/logger.js";
import { nowUtc } from "../../lib/time.js";
import { hasStaffPermissions } from "../../lib/config.js";
import {
  getApprovalRateTrend,
  getTopRejectionReasons,
} from "./approvalRate.js";

/**
 * executeApprovalRateCommand
 * WHAT: Handles /approval-rate slash command.
 * WHY: Provides ephemeral summary of server-wide approval/rejection rates.
 * HOW: Queries analytics data, builds compact embed with trend comparison, replies ephemerally.
 *
 * @param ctx - Command context with interaction
 */
export async function executeApprovalRateCommand(
  ctx: CommandContext<ChatInputCommandInteraction>
): Promise<void> {
  const { interaction } = ctx;
  const start = Date.now();

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Validate guild context
    if (!interaction.guildId) {
      await interaction.editReply({
        content: "This command must be run in a server.",
      });
      return;
    }

    // Permission check
    const member = interaction.member as GuildMember | null;
    if (!member || !hasStaffPermissions(member, interaction.guildId)) {
      await interaction.editReply({
        content: "You don't have permission to use this command.",
      });
      return;
    }

    // Parse options
    const days = interaction.options.getInteger("days") ?? 30;

    // Calculate time window
    const now = nowUtc();
    const from = now - days * 86400; // days * seconds per day
    const to = now;

    // Sentry span for monitoring
    captureException(null, {
      area: "approval-rate.run",
      tags: {
        days,
        from,
        to,
        guildId: interaction.guildId,
      },
    });

    // Query analytics data
    const trend = getApprovalRateTrend({
      guildId: interaction.guildId,
      from,
      to,
    });

    const rejectionReasons = getTopRejectionReasons(
      {
        guildId: interaction.guildId,
        from,
        to,
      },
      5
    );

    const { current, previous, approvalRateDelta, trendDirection } = trend;

    // Build trend indicator
    const trendArrow =
      trendDirection === "up" ? "\u2191" : trendDirection === "down" ? "\u2193" : "\u2194";
    const trendSign = approvalRateDelta >= 0 ? "+" : "";
    const trendColor =
      trendDirection === "up" ? 0x57f287 : trendDirection === "down" ? 0xed4245 : 0x5865f2;

    // Build embed
    const embed = new EmbedBuilder()
      .setTitle(`Approval Rate Analytics (Last ${days} Days)`)
      .setColor(trendColor)
      .setTimestamp();

    // Overall stats field
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

    // Trend comparison field
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

    // Top rejection reasons field
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

    // Footer with data freshness info
    embed.setFooter({
      text: `Data from ${new Date(from * 1000).toLocaleDateString()} to ${new Date(to * 1000).toLocaleDateString()}`,
    });

    const elapsed = Date.now() - start;
    logger.info(
      {
        render: "approval-rate",
        ms: elapsed,
        days,
        guildId: interaction.guildId,
        total: current.total,
        approvalPct: current.approvalPct,
        trend: trendDirection,
      },
      "[approval-rate] render completed"
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const traceId = ctx.traceId;
    logger.error({ err, traceId }, "[approval-rate] command failed");
    captureException(err, { area: "approval-rate.run", traceId });

    await interaction
      .editReply({
        content: `Analytics query failed. Trace ID: \`${traceId}\``,
      })
      .catch(() => undefined);
  }
}
