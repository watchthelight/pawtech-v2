/**
 * Pawtropolis Tech — src/commands/modstats.ts
 * WHAT: /modstats command for moderator analytics and leaderboards.
 * WHY: Provides transparency, gamification, and performance metrics for review team.
 * FLOWS:
 *  - /modstats leaderboard [days] → ranked list of moderators by decisions
 *  - /modstats user @moderator [days] → individual stats + server averages
 * DOCS:
 *  - Discord slash commands: https://discord.js.org/#/docs/discord.js/main/class/ChatInputCommandInteraction
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  User,
  AttachmentBuilder,
} from "discord.js";
import { db } from "../db/db.js";
import { nowUtc } from "../lib/time.js";
import { logger } from "../lib/logger.js";
import type { CommandContext } from "../lib/cmdWrap.js";

export const data = new SlashCommandBuilder()
  .setName("modstats")
  .setDescription("View moderator analytics and leaderboards")
  .addSubcommand((sub) =>
    sub
      .setName("leaderboard")
      .setDescription("Show leaderboard of moderators by decisions")
      .addIntegerOption((opt) =>
        opt
          .setName("days")
          .setDescription("Number of days to analyze (default: 30)")
          .setMinValue(1)
          .setMaxValue(365)
          .setRequired(false)
      )
      .addBooleanOption((opt) =>
        opt.setName("export").setDescription("Export leaderboard as CSV file").setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("user")
      .setDescription("Show detailed stats for a specific moderator")
      .addUserOption((opt) =>
        opt.setName("moderator").setDescription("Moderator to analyze").setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt
          .setName("days")
          .setDescription("Number of days to analyze (default: 30)")
          .setMinValue(1)
          .setMaxValue(365)
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("export")
      .setDescription("Export all moderator metrics as CSV")
      .addIntegerOption((opt) =>
        opt
          .setName("days")
          .setDescription("Number of days to analyze (default: 30)")
          .setMinValue(1)
          .setMaxValue(365)
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("reset")
      .setDescription("Clear and rebuild moderator statistics (password required)")
      .addStringOption((opt) =>
        opt.setName("password").setDescription("Admin reset password").setRequired(true)
      )
  );

/**
 * Decision actions (approve, reject, need_info, perm_reject, kick)
 */
const DECISION_ACTIONS = ["approve", "reject", "need_info", "perm_reject", "kick"];

/**
 * WHAT: Format duration in seconds as human-readable string.
 * WHY: Consistent time formatting for avg claim→decision displays.
 * FORMAT: "Xm" if < 1h, else "Hh Mm"
 *
 * @param seconds - Duration in seconds (null/undefined/negative → "—")
 * @returns Formatted duration string
 * @example
 * formatDuration(840) // "14m"
 * formatDuration(4320) // "1h 12m"
 * formatDuration(null) // "—"
 */
function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) {
    return "—";
  }

  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (hours === 0) {
    return `${mins}m`;
  }

  return `${hours}h ${mins}m`;
}

/**
 * WHAT: Calculate average claim→decision time for a moderator.
 * WHY: Key performance metric for review speed and moderator efficiency.
 * HOW: Joins claim actions with decision actions on same app_id + actor_id,
 *      then computes AVG(decision.created_at_s - claim.created_at_s).
 *
 * @param guildId - Guild ID
 * @param actorId - Moderator user ID
 * @param windowStartS - Start of time window (unix seconds)
 * @returns Average seconds from claim to decision, or null if no data
 */
function getAvgClaimToDecision(
  guildId: string,
  actorId: string,
  windowStartS: number
): number | null {
  // For each decision by this moderator in the window:
  // 1. Find the most recent claim by same moderator for that app_id before the decision
  // 2. Compute delta (decision.created_at_s - claim.created_at_s)
  // 3. Average all deltas

  const decisions = db
    .prepare(
      `
      SELECT app_id, created_at_s
      FROM action_log
      WHERE guild_id = ?
        AND actor_id = ?
        AND action IN ('approve', 'reject', 'need_info', 'perm_reject', 'kick')
        AND created_at_s >= ?
        AND app_id IS NOT NULL
      ORDER BY created_at_s ASC
    `
    )
    .all(guildId, actorId, windowStartS) as Array<{
    app_id: string;
    created_at_s: number;
  }>;

  if (decisions.length === 0) {
    return null;
  }

  const deltas: number[] = [];

  for (const decision of decisions) {
    // Find most recent claim by same moderator for this app before decision
    const claim = db
      .prepare(
        `
        SELECT created_at_s
        FROM action_log
        WHERE guild_id = ?
          AND app_id = ?
          AND actor_id = ?
          AND action = 'claim'
          AND created_at_s < ?
        ORDER BY created_at_s DESC
        LIMIT 1
      `
      )
      .get(guildId, decision.app_id, actorId, decision.created_at_s) as
      | { created_at_s: number }
      | undefined;

    if (claim) {
      const delta = decision.created_at_s - claim.created_at_s;
      // Only count positive deltas (sanity check: decision should come after claim)
      if (delta > 0) {
        deltas.push(delta);
      }
    }
    // Note: If no claim found, this decision is skipped (e.g., unclaimed app decisions)
  }

  if (deltas.length === 0) {
    return null;
  }

  // Return average time in seconds (floor to avoid fractional seconds)
  return Math.floor(deltas.reduce((sum, d) => sum + d, 0) / deltas.length);
}

/**
 * WHAT: Calculate server average submit→first claim time.
 * WHY: Context metric for understanding review queue responsiveness.
 * HOW: For each app_submitted action, find earliest claim (by ANY moderator),
 *      then compute AVG(first_claim.created_at_s - submit.created_at_s).
 *
 * @param guildId - Guild ID
 * @param windowStartS - Start of time window (unix seconds)
 * @returns Average seconds from submit to first claim, or null if no data
 */
function getAvgSubmitToFirstClaim(guildId: string, windowStartS: number): number | null {
  // For each app_submitted in window:
  // 1. Find earliest claim for that app_id
  // 2. Compute delta (claim.created_at_s - submit.created_at_s)
  // 3. Average all deltas

  const submissions = db
    .prepare(
      `
      SELECT app_id, created_at_s
      FROM action_log
      WHERE guild_id = ?
        AND action = 'app_submitted'
        AND created_at_s >= ?
        AND app_id IS NOT NULL
      ORDER BY created_at_s ASC
    `
    )
    .all(guildId, windowStartS) as Array<{
    app_id: string;
    created_at_s: number;
  }>;

  if (submissions.length === 0) {
    return null;
  }

  const deltas: number[] = [];

  for (const submission of submissions) {
    // Find earliest claim for this app
    const claim = db
      .prepare(
        `
        SELECT created_at_s
        FROM action_log
        WHERE guild_id = ?
          AND app_id = ?
          AND action = 'claim'
          AND created_at_s >= ?
        ORDER BY created_at_s ASC
        LIMIT 1
      `
      )
      .get(guildId, submission.app_id, submission.created_at_s) as
      | { created_at_s: number }
      | undefined;

    if (claim) {
      const delta = claim.created_at_s - submission.created_at_s;
      if (delta > 0) {
        deltas.push(delta);
      }
    }
  }

  if (deltas.length === 0) {
    return null;
  }

  return Math.floor(deltas.reduce((sum, d) => sum + d, 0) / deltas.length);
}

/**
 * WHAT: Handle /modstats leaderboard subcommand.
 * WHY: Gamification + transparency for review team performance.
 */
async function handleLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "❌ This command must be run in a guild.",
      ephemeral: true,
    });
    return;
  }

  const days = interaction.options.getInteger("days") ?? 30;
  const exportCsv = interaction.options.getBoolean("export") ?? false;
  const windowStartS = nowUtc() - days * 86400;

  // Get decision counts per moderator
  const rows = db
    .prepare(
      `
      SELECT
        actor_id,
        COUNT(*) as total,
        SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) as approvals,
        SUM(CASE WHEN action = 'reject' THEN 1 ELSE 0 END) as rejections,
        SUM(CASE WHEN action = 'need_info' THEN 1 ELSE 0 END) as need_info,
        SUM(CASE WHEN action = 'perm_reject' THEN 1 ELSE 0 END) as perm_reject,
        SUM(CASE WHEN action = 'kick' THEN 1 ELSE 0 END) as kicks
      FROM action_log
      WHERE guild_id = ?
        AND action IN ('approve', 'reject', 'need_info', 'perm_reject', 'kick')
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
    need_info: number;
    perm_reject: number;
    kicks: number;
  }>;

  if (rows.length === 0) {
    await interaction.reply({
      content: `📊 No decisions found in the last ${days} days.`,
      ephemeral: true,
    });
    return;
  }

  // Handle CSV export
  if (exportCsv) {
    const csvLines = [
      "Moderator ID,Total Decisions,Approvals,Rejections,Need Info,Perm Reject,Kicks,Avg Response Time (seconds)",
    ];

    for (const row of rows) {
      const avgTime = getAvgClaimToDecision(interaction.guildId, row.actor_id, windowStartS);
      csvLines.push(
        `${row.actor_id},${row.total},${row.approvals},${row.rejections},${row.need_info},${row.perm_reject},${row.kicks},${avgTime ?? ""}`
      );
    }

    const csvContent = csvLines.join("\n");
    const attachment = new AttachmentBuilder(Buffer.from(csvContent, "utf-8"), {
      name: `modstats-leaderboard-${days}d-${Date.now()}.csv`,
    });

    await interaction.reply({
      content: `📊 **Moderator Leaderboard Export** (last ${days} days)\n${rows.length} moderators`,
      files: [attachment],
      ephemeral: true,
    });

    logger.info(
      { guildId: interaction.guildId, days, count: rows.length },
      "[modstats] CSV export generated"
    );
    return;
  }

  // Display embed (limit to top 15 for readability)
  const embed = new EmbedBuilder()
    .setTitle("📊 Moderator Leaderboard")
    .setDescription(`Top moderators by decisions (last ${days} days)`)
    .setColor(0x5865f2)
    .setTimestamp();

  const lines: string[] = [];
  const displayRows = rows.slice(0, 15);

  for (let i = 0; i < displayRows.length; i++) {
    const row = displayRows[i];
    const rank = i + 1;
    const avgTime = getAvgClaimToDecision(interaction.guildId, row.actor_id, windowStartS);

    const rejects = row.rejections + row.perm_reject + row.kicks;

    lines.push(
      `**${rank}.** <@${row.actor_id}> — **${row.total}** decisions ` +
        `(✅ ${row.approvals} / ❌ ${rejects} / ❔ ${row.need_info}) • ⏱️ avg ${formatDuration(avgTime)}`
    );
  }

  embed.setDescription(lines.join("\n"));

  if (rows.length > 15) {
    embed.setFooter({
      text: `Showing top 15 of ${rows.length} moderators. Use export=true for full list.`,
    });
  }

  await interaction.reply({
    embeds: [embed],
    ephemeral: false,
    allowedMentions: { parse: [] }, // Suppress mentions
  });

  logger.info(
    { guildId: interaction.guildId, days, count: rows.length },
    "[modstats] leaderboard displayed"
  );
}

/**
 * WHAT: Handle /modstats user subcommand.
 * WHY: Individual performance review + context (server avg).
 */
async function handleUser(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "❌ This command must be run in a guild.",
      ephemeral: true,
    });
    return;
  }

  const moderator = interaction.options.getUser("moderator", true);
  const days = interaction.options.getInteger("days") ?? 30;
  const windowStartS = nowUtc() - days * 86400;

  // Get decision counts for this moderator
  const row = db
    .prepare(
      `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) as approvals,
        SUM(CASE WHEN action = 'reject' THEN 1 ELSE 0 END) as rejections,
        SUM(CASE WHEN action = 'need_info' THEN 1 ELSE 0 END) as need_info,
        SUM(CASE WHEN action = 'perm_reject' THEN 1 ELSE 0 END) as perm_reject,
        SUM(CASE WHEN action = 'kick' THEN 1 ELSE 0 END) as kicks
      FROM action_log
      WHERE guild_id = ?
        AND actor_id = ?
        AND action IN ('approve', 'reject', 'need_info', 'perm_reject', 'kick')
        AND created_at_s >= ?
    `
    )
    .get(interaction.guildId, moderator.id, windowStartS) as
    | {
        total: number;
        approvals: number;
        rejections: number;
        need_info: number;
        perm_reject: number;
        kicks: number;
      }
    | undefined;

  if (!row || row.total === 0) {
    await interaction.reply({
      content: `📊 ${moderator.tag} has no decisions in the last ${days} days.`,
      ephemeral: true,
    });
    return;
  }

  const avgClaimToDecision = getAvgClaimToDecision(interaction.guildId, moderator.id, windowStartS);

  const avgSubmitToFirstClaim = getAvgSubmitToFirstClaim(interaction.guildId, windowStartS);

  const rejects = row.rejections + row.perm_reject + row.kicks;

  const embed = new EmbedBuilder()
    .setTitle(`📊 Moderator Stats: ${moderator.tag}`)
    .setDescription(`Performance metrics (last ${days} days)`)
    .setColor(0x5865f2)
    .setThumbnail(moderator.displayAvatarURL())
    .setTimestamp()
    .addFields(
      { name: "Decisions", value: `**${row.total}**`, inline: true },
      { name: "Accepted", value: `✅ ${row.approvals}`, inline: true },
      { name: "Rejected", value: `❌ ${rejects}`, inline: true },
      { name: "Need Info", value: `❔ ${row.need_info}`, inline: true },
      {
        name: "Avg Claim → Decision",
        value: formatDuration(avgClaimToDecision),
        inline: true,
      },
      {
        name: "Server Avg: Submit → First Claim",
        value: formatDuration(avgSubmitToFirstClaim),
        inline: true,
      }
    );

  await interaction.reply({
    embeds: [embed],
    ephemeral: false,
    allowedMentions: { parse: [] }, // Suppress mentions
  });

  logger.info(
    { guildId: interaction.guildId, moderatorId: moderator.id, days },
    "[modstats] user stats displayed"
  );
}

/**
 * WHAT: Main command executor for /modstats.
 * WHY: Routes to leaderboard or user subcommand.
 */
/**
 * WHAT: Rate limiter for /modstats reset attempts.
 * WHY: Prevents brute-force password guessing attacks.
 * HOW: In-memory map of userId -> last attempt timestamp.
 * SECURITY: 30-second cooldown per user after failed attempt.
 */
const resetRateLimiter = new Map<string, number>();
const RESET_RATE_LIMIT_MS = 30000; // 30 seconds

/**
 * WHAT: Handle /modstats reset subcommand.
 * WHY: Allows admins to clear corrupted/stale cache and force recomputation.
 * SECURITY: Password-protected, rate-limited, audit-logged.
 */
async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const now = Date.now();

  // Check rate limit (per user)
  const lastAttempt = resetRateLimiter.get(userId);
  if (lastAttempt && now - lastAttempt < RESET_RATE_LIMIT_MS) {
    await interaction.editReply({
      content: "❌ Too many attempts. Please wait 30 seconds before trying again.",
    });
    return;
  }

  // Get provided password (never log this value!)
  const providedPassword = interaction.options.getString("password", true);

  // Get expected password from config
  const { RESET_PASSWORD } = await import("../config.js");

  if (!RESET_PASSWORD) {
    await interaction.editReply({
      content: "❌ Reset not configured. Contact server administrator.",
    });
    logger.warn({ userId }, "[modstats:reset] attempted but RESET_PASSWORD not set");
    return;
  }

  // Constant-time password comparison
  const { secureCompare } = await import("../lib/secureCompare.js");
  const passwordMatches = secureCompare(providedPassword, RESET_PASSWORD);

  if (!passwordMatches) {
    // Record failed attempt for rate limiting
    resetRateLimiter.set(userId, now);

    await interaction.editReply({
      content: "❌ Unauthorized. Reset password invalid.",
    });

    // Audit log (denied)
    if (interaction.guild) {
      const { postAuditEmbed } = await import("../features/logger.js");
      await postAuditEmbed(interaction.guild, {
        action: "modstats_reset",
        userId,
        userTag: interaction.user.tag,
        result: "denied",
      });
    }

    logger.warn({ userId, userTag: interaction.user.tag }, "[modstats:reset] unauthorized attempt");
    return;
  }

  // Password correct - proceed with reset
  try {
    const { resetModstats } = await import("../features/modstats/reset.js");
    const result = await resetModstats(db, logger, {});

    await interaction.editReply({
      content: `✅ **Modstats cache reset complete**\n\n` +
        `• Cache cleared: ${result.cacheDropped ? "Yes" : "No"}\n` +
        `• Guilds affected: ${result.guildsAffected}\n` +
        `• Recomputation: Will occur lazily on next \`/modstats\` call\n\n` +
        `${result.errors && result.errors.length > 0 ? `⚠️ Warnings:\n${result.errors.map(e => `- ${e}`).join('\n')}` : ''}`,
    });

    // Audit log (success)
    if (interaction.guild) {
      const { postAuditEmbed } = await import("../features/logger.js");
      await postAuditEmbed(interaction.guild, {
        action: "modstats_reset",
        userId,
        userTag: interaction.user.tag,
        result: "success",
        details: `Cache cleared, ${result.guildsAffected} guilds affected`,
      });
    }

    logger.info(
      {
        userId,
        userTag: interaction.user.tag,
        guildId: interaction.guildId,
        guildsAffected: result.guildsAffected,
      },
      "[modstats:reset] cache reset successful"
    );

    // Clear rate limit on successful auth
    resetRateLimiter.delete(userId);
  } catch (err) {
    logger.error({ err, userId }, "[modstats:reset] reset failed");

    await interaction.editReply({
      content: "❌ Reset failed. Check logs for details.",
    });

    // Audit log (error)
    if (interaction.guild) {
      const { postAuditEmbed } = await import("../features/logger.js");
      await postAuditEmbed(interaction.guild, {
        action: "modstats_reset",
        userId,
        userTag: interaction.user.tag,
        result: "error",
        details: (err as Error).message,
      });
    }
  }
}

/**
 * WHAT: Handle /modstats export subcommand.
 * WHY: Provides full CSV export for external analysis.
 */
async function handleExport(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "❌ This command must be run in a guild.",
      ephemeral: true,
    });
    return;
  }

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
        SUM(CASE WHEN action = 'need_info' THEN 1 ELSE 0 END) as need_info,
        SUM(CASE WHEN action = 'perm_reject' THEN 1 ELSE 0 END) as perm_reject,
        SUM(CASE WHEN action = 'kick' THEN 1 ELSE 0 END) as kicks
      FROM action_log
      WHERE guild_id = ?
        AND action IN ('approve', 'reject', 'need_info', 'perm_reject', 'kick')
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
    need_info: number;
    perm_reject: number;
    kicks: number;
  }>;

  if (rows.length === 0) {
    await interaction.reply({
      content: `📊 No decisions found in the last ${days} days.`,
      ephemeral: true,
    });
    return;
  }

  // Generate CSV
  const csvLines = [
    "Moderator ID,Total Decisions,Approvals,Rejections,Need Info,Perm Reject,Kicks,Avg Response Time (seconds),Avg Response Time (formatted)",
  ];

  for (const row of rows) {
    const avgTime = getAvgClaimToDecision(interaction.guildId, row.actor_id, windowStartS);
    csvLines.push(
      `${row.actor_id},${row.total},${row.approvals},${row.rejections},${row.need_info},${row.perm_reject},${row.kicks},${avgTime ?? ""},${formatDuration(avgTime)}`
    );
  }

  const csvContent = csvLines.join("\n");
  const attachment = new AttachmentBuilder(Buffer.from(csvContent, "utf-8"), {
    name: `modstats-full-export-${days}d-${Date.now()}.csv`,
  });

  await interaction.reply({
    content: `📊 **Full Moderator Stats Export** (last ${days} days)\n✅ ${rows.length} moderators included`,
    files: [attachment],
    ephemeral: true,
  });

  logger.info(
    { guildId: interaction.guildId, days, count: rows.length },
    "[modstats] full CSV export generated"
  );
}

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "leaderboard") {
    await handleLeaderboard(interaction);
  } else if (subcommand === "user") {
    await handleUser(interaction);
  } else if (subcommand === "export") {
    await handleExport(interaction);
  } else if (subcommand === "reset") {
    await handleReset(interaction);
  } else {
    await interaction.reply({
      content: "❌ Unknown subcommand.",
      ephemeral: true,
    });
  }
}
