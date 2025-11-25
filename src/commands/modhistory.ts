/**
 * Pawtropolis Tech — src/commands/modhistory.ts
 * WHAT: /modhistory slash command for leadership oversight
 * WHY: Quick moderator activity inspection from Discord
 * FLOWS:
 *  - /modhistory moderator:@User [days:30] [export:false]
 *  - Fetch summary + recent actions
 *  - Return embed with metrics and anomaly badge
 *  - Optional CSV export with secure link
 * SECURITY: Leadership-only command (checked server-side)
 * DOCS:
 *  - Discord.js SlashCommandBuilder: https://discord.js.org/docs/packages/builders
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import { isOwner } from "../utils/owner.js";
import { hasStaffPermissions, getConfig } from "../lib/config.js";
import { db } from "../db/db.js";
import { computePercentiles } from "../lib/percentiles.js";
import { detectModeratorAnomalies } from "../lib/anomaly.js";
import { generateModHistoryCsv } from "../lib/csv.js";
import { logActionPretty } from "../logging/pretty.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const MAX_PERCENTILE_ROWS = 30000;

export const data = new SlashCommandBuilder()
  .setName("modhistory")
  .setDescription("View moderator action history (leadership only)")
  .addUserOption((opt) =>
    opt.setName("moderator").setDescription("Moderator to inspect").setRequired(true)
  )
  .addIntegerOption((opt) =>
    opt
      .setName("days")
      .setDescription("Days of history to fetch (default: 30)")
      .setMinValue(1)
      .setMaxValue(MAX_DAYS)
  )
  .addBooleanOption((opt) =>
    opt.setName("export").setDescription("Export full history as CSV (default: false)")
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // UI hint only
  .setDMPermission(false);

/**
 * requireLeadership (slash command version)
 * WHY: Verify caller has leadership permissions
 */
async function requireLeadership(interaction: ChatInputCommandInteraction): Promise<boolean> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  // Owner override
  if (isOwner(userId)) {
    return true;
  }

  const member = interaction.member;
  if (!member || typeof member.permissions === "string") {
    return false;
  }

  // Guild owner
  if (interaction.guild?.ownerId === userId) {
    return true;
  }

  // Staff permissions
  if (hasStaffPermissions(member as any, guildId)) {
    return true;
  }

  // Leadership role
  const config = getConfig(guildId);
  if (config?.leadership_role_id && (member as any).roles.cache.has(config.leadership_role_id)) {
    return true;
  }

  return false;
}

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  if (!interaction.guildId) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Leadership check
  const isLeadership = await requireLeadership(interaction);
  if (!isLeadership) {
    await interaction.reply({
      content: "❌ This command requires leadership role or admin permissions.",
      ephemeral: true,
    });
    return;
  }

  const moderator = interaction.options.getUser("moderator", true);
  const days = interaction.options.getInteger("days") || DEFAULT_DAYS;
  const exportCsv = interaction.options.getBoolean("export") || false;

  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId;
  const fromTimestamp = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;

  try {
    // Fetch summary data (same logic as API endpoint)
    const totalRow = db
      .prepare(
        `SELECT COUNT(*) as total
         FROM action_log
         WHERE actor_id = ? AND guild_id = ? AND created_at_s >= ?`
      )
      .get(moderator.id, guildId, fromTimestamp) as { total: number } | undefined;

    const totalActions = totalRow?.total || 0;

    const countRows = db
      .prepare(
        `SELECT action, COUNT(*) as cnt
         FROM action_log
         WHERE actor_id = ? AND guild_id = ? AND created_at_s >= ?
         GROUP BY action`
      )
      .all(moderator.id, guildId, fromTimestamp) as Array<{ action: string; cnt: number }>;

    const counts: Record<string, number> = {};
    for (const row of countRows) {
      counts[row.action] = row.cnt;
    }

    // Response times
    const responseRows = db
      .prepare(
        `SELECT json_extract(meta_json, '$.response_ms') as ms
         FROM action_log
         WHERE actor_id = ? AND guild_id = ?
           AND created_at_s >= ?
           AND json_type(json_extract(meta_json, '$.response_ms')) = 'integer'
         LIMIT ?`
      )
      .all(moderator.id, guildId, fromTimestamp, MAX_PERCENTILE_ROWS) as Array<{ ms: number }>;

    const responseTimes = responseRows.map((r) => r.ms).filter((ms) => ms > 0);
    const percentiles = computePercentiles(responseTimes, [50, 95]);
    const p50 = percentiles.get(50);
    const p95 = percentiles.get(95);

    // Reject rate
    const approveCount = counts["approve"] || 0;
    const rejectCount = counts["reject"] || 0;
    const totalDecisions = approveCount + rejectCount;
    const rejectRate = totalDecisions > 0 ? ((rejectCount / totalDecisions) * 100).toFixed(1) : "0.0";

    // Anomaly detection
    const dailyRows = db
      .prepare(
        `SELECT DATE(created_at_s, 'unixepoch') as day, COUNT(*) as cnt
         FROM action_log
         WHERE actor_id = ? AND guild_id = ? AND created_at_s >= ?
         GROUP BY day
         ORDER BY day ASC`
      )
      .all(moderator.id, guildId, fromTimestamp) as Array<{ day: string; cnt: number }>;

    const dailyCounts = dailyRows.map((r) => r.cnt);
    const anomaly = detectModeratorAnomalies(dailyCounts);

    // Build embed
    const embed = new EmbedBuilder()
      .setTitle(`📊 Moderator History: ${moderator.tag}`)
      .setDescription(`Activity summary for the last ${days} days`)
      .setColor(anomaly.isAnomaly ? 0xfaa61a : 0x5865f2)
      .addFields(
        { name: "Total Actions", value: totalActions.toString(), inline: true },
        { name: "Approvals", value: (counts["approve"] || 0).toString(), inline: true },
        { name: "Rejections", value: (counts["reject"] || 0).toString(), inline: true },
        { name: "Reject Rate", value: `${rejectRate}%`, inline: true },
        {
          name: "Response Time (p50)",
          value: p50 ? `${Math.round(p50 / 1000)}s` : "N/A",
          inline: true,
        },
        {
          name: "Response Time (p95)",
          value: p95 ? `${Math.round(p95 / 1000)}s` : "N/A",
          inline: true,
        }
      )
      .setTimestamp()
      .setFooter({ text: `Requested by ${interaction.user.tag}` });

    if (anomaly.isAnomaly) {
      embed.addFields({
        name: "⚠️ Anomaly Detected",
        value: `Z-score: ${anomaly.score.toFixed(2)} (${anomaly.reason})`,
      });
    }

    // Audit log
    await logActionPretty(interaction.guild!, {
      action: "modhistory_view",
      actorId: interaction.user.id,
      meta: {
        moderatorId: moderator.id,
        guildId,
        periodDays: days,
        totalActions,
        exportRequested: exportCsv,
      },
    });

    // Export CSV if requested
    if (exportCsv) {
      const rows = db
        .prepare(
          `SELECT id, action, actor_id, subject_id, created_at_s, reason, meta_json, guild_id
           FROM action_log
           WHERE actor_id = ? AND guild_id = ? AND created_at_s >= ?
           ORDER BY created_at_s DESC`
        )
        .all(moderator.id, guildId, fromTimestamp) as any[];

      const csv = generateModHistoryCsv(rows);

      const exportsDir = join(process.cwd(), "data", "exports");
      try {
        mkdirSync(exportsDir, { recursive: true });
      } catch {
        // Directory may already exist
      }

      const timestamp = Date.now();
      const random = randomBytes(4).toString("hex");
      const filename = `modhistory-${moderator.id}-${timestamp}-${random}.csv`;
      const filepath = join(exportsDir, filename);

      writeFileSync(filepath, csv, "utf-8");

      // Audit export
      await logActionPretty(interaction.guild!, {
        action: "modhistory_export",
        actorId: interaction.user.id,
        meta: {
          moderatorId: moderator.id,
          guildId,
          rowCount: rows.length,
          filename,
        },
      });

      const downloadUrl = `${process.env.PUBLIC_URL || "https://pawtropolis.tech"}/exports/${filename}`;

      embed.addFields({
        name: "📥 CSV Export",
        value: `[Download CSV](${downloadUrl}) (${rows.length} rows)\n*Link expires in 24 hours*`,
      });
    }

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { moderatorId: moderator.id, guildId, days, exportCsv, actorId: interaction.user.id },
      "[modhistory] command executed"
    );
  } catch (err) {
    logger.error({ err, moderatorId: moderator.id, guildId }, "[modhistory] command failed");
    await interaction.editReply({
      content: "❌ Failed to fetch moderator history. Please try again later.",
    });
  }
}
