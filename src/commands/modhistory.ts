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
// Cap for percentile calculation to prevent memory issues with very active servers
// 30k rows is enough for statistically meaningful p50/p95 while staying reasonable
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
 * Leadership permission check for moderator oversight commands.
 *
 * PERMISSION HIERARCHY (any one grants access):
 *   1. Bot owner (OWNER_IDS in env) - global override for debugging
 *   2. Guild owner - always has access to their own server
 *   3. Staff permissions (mod_role_ids or ManageGuild) - server admins
 *   4. Leadership role (leadership_role_id in config) - designated oversight role
 *
 * WHY SO MANY CHECKS?
 * Different servers organize their staff differently. Some have a dedicated
 * "Leadership" role for senior mods, others just use ManageGuild for admins.
 * We support all common patterns.
 *
 * The `member.permissions` string check handles an edge case where Discord
 * returns permissions as a bitfield string instead of a Permissions object
 * (happens in some webhook/API contexts).
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

    /*
     * ANOMALY DETECTION:
     * We compute daily action counts and run them through detectModeratorAnomalies()
     * which uses z-score analysis to flag unusual patterns. High z-scores indicate
     * activity significantly above/below the moderator's normal baseline.
     *
     * Use cases:
     *   - Catching compromised accounts (sudden spike in rejections)
     *   - Identifying burnout (gradual decline in activity)
     *   - Detecting potential abuse (high reject rate on specific days)
     *
     * The threshold for "anomaly" is configurable in lib/anomaly.ts
     */
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

      /*
       * CSV files are written to data/exports/ with a randomized filename
       * to prevent enumeration attacks. The random suffix ensures that even
       * knowing the moderator ID and timestamp isn't enough to guess the URL.
       *
       * CLEANUP: These files should be pruned by a scheduled task (cron or
       * similar) after 24 hours. The "expires in 24 hours" message is a
       * promise to the user that we honor via that cleanup process.
       *
       * SECURITY: The exports directory should NOT be publicly listable.
       * Only direct file access should work. Configure your web server
       * to disable directory listing for /exports/.
       */
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
