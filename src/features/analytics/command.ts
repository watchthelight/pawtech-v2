/**
 * Pawtropolis Tech — src/features/analytics/command.ts
 * WHAT: Slash command handlers for /analytics and /analytics export.
 * WHY: Provides staff with reviewer activity insights and audit exports.
 * FLOWS:
 *  - /analytics → ephemeral embed summary (totals, per-mod, top reasons, queue age)
 *  - /analytics export → ephemeral CSV attachment
 * DOCS:
 *  - discord.js Commands: https://discord.js.org/#/docs/discord.js/main/class/ChatInputCommandInteraction
 *  - AttachmentBuilder: https://discord.js.org/#/docs/discord.js/main/class/AttachmentBuilder
 *
 * NOTE: Owner check via OWNER_IDS; mod check via existing staff permission helpers.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
  GuildMember,
} from "discord.js";
import type { CommandContext } from "../../lib/cmdWrap.js";
import { PassThrough } from "stream";
import { captureException } from "../../lib/sentry.js";
import { logger } from "../../lib/logger.js";
import { nowUtc, tsToIso } from "../../lib/time.js";
import { isOwner } from "../../lib/owner.js";
import { hasStaffPermissions } from "../../lib/config.js";
import {
  getActionCountsByMod,
  getTopReasons,
  getVolumeSeries,
  getLeadTimeStats,
  getOpenQueueAge,
} from "./queries.js";
import { streamReviewActionsCSV } from "../../lib/csv.js";

/**
 * parseWindow
 * WHAT: Resolves time window with defaults (last 7 days if not specified).
 * WHY: Consistent default behavior across analytics commands.
 *
 * @param now - Current timestamp (for testing)
 * @param from - Optional start timestamp
 * @param to - Optional end timestamp
 * @returns { from, to } (inclusive window)
 */
export function parseWindow(
  now = nowUtc(),
  from?: number,
  to?: number
): { from: number; to: number } {
  // Default window: last 7 days ending now. This is the most common use case for
  // "how are we doing this week?" and keeps the query fast by limiting scope.
  // Note: Both bounds are inclusive, so a 7-day window actually spans 7*86400+1 seconds.
  const resolvedTo = to !== undefined ? to : now;
  const resolvedFrom = from !== undefined ? from : resolvedTo - 7 * 86400;

  return { from: resolvedFrom, to: resolvedTo };
}

/**
 * formatDuration
 * WHAT: Converts seconds to human-readable duration (e.g., "2h 15m").
 * WHY: Makes lead times and queue ages readable in embeds.
 *
 * @param seconds - Duration in seconds
 * @returns Formatted string
 */
function formatDuration(seconds: number): string {
  // Human-friendly duration formatting. We intentionally drop precision at each tier
  // because "2h 15m" is more useful than "2h 15m 42s" for analytics at a glance.
  // Negative durations (shouldn't happen, but data bugs exist) will show as "0s".
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * executeAnalyticsCommand
 * WHAT: Handles /analytics slash command.
 * WHY: Provides ephemeral summary of reviewer activity.
 * HOW: Queries analytics data, builds compact embed, replies ephemerally.
 *
 * @param ctx - Command context with interaction
 */
export async function executeAnalyticsCommand(
  ctx: CommandContext<ChatInputCommandInteraction>
): Promise<void> {
  const { interaction } = ctx;
  const start = Date.now();

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Parse options
    const from = interaction.options.getInteger("from") ?? undefined;
    const to = interaction.options.getInteger("to") ?? undefined;
    const allGuilds = interaction.options.getBoolean("all-guilds") ?? false;
    const bucket = (interaction.options.getString("bucket") ?? "day") as "day" | "week";

    // Resolve time window
    const window = parseWindow(nowUtc(), from, to);

    // Validate from < to
    if (window.from > window.to) {
      await interaction.editReply({
        content: "❌ Invalid time range: `from` must be before `to`.",
      });
      return;
    }

    // Permission check
    if (allGuilds) {
      if (!isOwner(interaction.user.id)) {
        await interaction.editReply({
          content: "❌ The `--all-guilds` flag is restricted to bot owners.",
        });
        return;
      }
    } else {
      // Check staff permissions for guild-scoped queries
      if (!interaction.guildId) {
        await interaction.editReply({
          content: "❌ This command must be run in a guild.",
        });
        return;
      }

      const member = interaction.member as GuildMember | null;
      if (!member || !hasStaffPermissions(member, interaction.guildId)) {
        await interaction.editReply({
          content: "❌ You don't have permission to use this command.",
        });
        return;
      }
    }

    const scope = allGuilds ? undefined : interaction.guildId!;
    const scopeLabel = allGuilds ? "all guilds" : interaction.guild?.name || "this guild";

    // Sentry span
    const span = captureException(null, {
      area: "analytics.run",
      tags: {
        from: window.from,
        to: window.to,
        bucket,
        scope: scope || "all",
      },
    });

    // Query analytics data in parallel using Promise.allSettled
    // This allows partial results to be displayed even if some queries fail.
    // These are all synchronous SQLite calls wrapped in Promise.resolve for the Promise.allSettled pattern.
    // We run them "in parallel" for consistency and future-proofing if any become async (e.g., remote DB).
    // In practice, better-sqlite3 is synchronous so they execute sequentially anyway.
    // The queueAge query is guild-scoped only because cross-guild queue stats don't make sense.
    const results = await Promise.allSettled([
      Promise.resolve(getActionCountsByMod({ guildId: scope, from: window.from, to: window.to })),
      Promise.resolve(
        getTopReasons({ guildId: scope, from: window.from, to: window.to, limit: 10 })
      ),
      Promise.resolve(
        getVolumeSeries({ guildId: scope, from: window.from, to: window.to, bucket })
      ),
      Promise.resolve(getLeadTimeStats({ guildId: scope, from: window.from, to: window.to })),
      scope ? Promise.resolve(getOpenQueueAge(scope)) : Promise.resolve(null),
    ]);

    // Extract results, using null/defaults for failures
    const actionCounts = results[0].status === "fulfilled" ? results[0].value : null;
    const topReasons = results[1].status === "fulfilled" ? results[1].value : [];
    const volumeSeries = results[2].status === "fulfilled" ? results[2].value : [];
    const leadTimeStats = results[3].status === "fulfilled" ? results[3].value : null;
    const queueAge = results[4].status === "fulfilled" ? results[4].value : null;

    // Log any failures
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      logger.warn(
        {
          guildId: scope,
          failedQueries: failures.length,
          errors: failures.map((f) => (f as PromiseRejectedResult).reason?.message || "Unknown"),
        },
        "[analytics] Some queries failed - showing partial results"
      );
    }

    // Calculate totals from volume series
    const totals = volumeSeries.reduce(
      (acc, bucket) => ({
        approvals: acc.approvals + bucket.approvals,
        rejects: acc.rejects + bucket.rejects,
        permrejects: acc.permrejects + bucket.permrejects,
        total: acc.total + bucket.total,
      }),
      { approvals: 0, rejects: 0, permrejects: 0, total: 0 }
    );

    // Build per-moderator summary
    const modSummary = new Map<
      string,
      { approve: number; reject: number; permreject: number; other: number }
    >();

    if (actionCounts) {
      for (const { moderator_id, action, count } of actionCounts) {
        if (!modSummary.has(moderator_id)) {
          modSummary.set(moderator_id, { approve: 0, reject: 0, permreject: 0, other: 0 });
        }
        const summary = modSummary.get(moderator_id)!;

        if (action === "approve") summary.approve += count;
        else if (action === "reject") summary.reject += count;
        else if (action === "perm_reject") summary.permreject += count;
        else summary.other += count;
      }
    }

    // Sort mods by total actions (descending)
    const modEntries = Array.from(modSummary.entries())
      .map(([mod_id, counts]) => ({
        mod_id,
        ...counts,
        total: counts.approve + counts.reject + counts.permreject + counts.other,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10); // Top 10

    // Build embed
    const embed = new EmbedBuilder()
      .setTitle("📊 Analytics Summary")
      .setColor(0x5865f2)
      .setDescription(
        `**Scope:** ${scopeLabel}\n**Window:** ${tsToIso(window.from)} → ${tsToIso(window.to)}`
      )
      .setTimestamp();

    // Show warning if partial results due to query failures
    if (failures.length > 0) {
      embed.addFields({
        name: "⚠️ Partial Results",
        value: `${failures.length} of 5 data sources unavailable`,
        inline: false,
      });
    }

    // Totals field (from volumeSeries)
    embed.addFields({
      name: "📈 Totals",
      value:
        volumeSeries.length > 0
          ? `✅ Approvals: **${totals.approvals}**\n❌ Rejects: **${totals.rejects}**\n🚫 Perm Rejects: **${totals.permrejects}**\n🔢 Total Actions: **${totals.total}**`
          : "Data unavailable",
      inline: false,
    });

    // Per-moderator field
    if (modEntries.length > 0) {
      const modLines = modEntries
        .map(
          (m) =>
            `<@${m.mod_id}>: ✅${m.approve} ❌${m.reject} 🚫${m.permreject} ➕${m.other} (${m.total})`
        )
        .join("\n");

      embed.addFields({
        name: "Top Moderators",
        value: modLines.slice(0, 1024), // Discord field limit (1024 chars per field value)
        inline: false,
      });
    }

    // Top reasons field
    if (topReasons.length > 0) {
      const reasonLines = topReasons
        .map((r) => {
          const truncated = r.reason.length > 50 ? r.reason.slice(0, 47) + "..." : r.reason;
          return `• ${truncated} (${r.count})`;
        })
        .join("\n");

      embed.addFields({
        name: "📝 Top Rejection Reasons",
        value: reasonLines.slice(0, 1024),
        inline: false,
      });
    }

    // Lead time stats
    if (leadTimeStats && leadTimeStats.n > 0) {
      embed.addFields({
        name: "⏱️ Review Lead Time",
        value: `p50: ${formatDuration(leadTimeStats.p50)} | p90: ${formatDuration(leadTimeStats.p90)} | mean: ${formatDuration(leadTimeStats.mean)} (n=${leadTimeStats.n})`,
        inline: false,
      });
    }

    // Queue age (guild-scoped only)
    if (queueAge && queueAge.count > 0) {
      embed.addFields({
        name: "⏳ Open Queue Age",
        value: `Pending: **${queueAge.count}** | p50: ${formatDuration(queueAge.p50_age_sec)} | max: ${formatDuration(queueAge.max_age_sec)}`,
        inline: false,
      });
    } else if (queueAge && queueAge.count === 0) {
      embed.addFields({
        name: "⏳ Open Queue Age",
        value: "No pending applications",
        inline: false,
      });
    }

    const elapsed = Date.now() - start;
    logger.info(
      {
        render: "analytics",
        ms: elapsed,
        from: window.from,
        to: window.to,
        bucket,
        scope: scope || "all",
      },
      "[analytics] render completed"
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const traceId = ctx.traceId;
    logger.error({ err, traceId }, "[analytics] command failed");
    captureException(err, { area: "analytics.run", traceId });

    await interaction
      .editReply({
        content: `❌ Analytics query failed. Trace ID: \`${traceId}\``,
      })
      .catch(() => undefined);
  }
}

/**
 * executeAnalyticsExportCommand
 * WHAT: Handles /analytics export slash command.
 * WHY: Provides CSV export of audit rows for external analysis.
 * HOW: Streams review_action rows to CSV, attaches as file, replies ephemerally.
 *
 * @param ctx - Command context with interaction
 */
export async function executeAnalyticsExportCommand(
  ctx: CommandContext<ChatInputCommandInteraction>
): Promise<void> {
  const { interaction } = ctx;
  const start = Date.now();

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Parse options
    const from = interaction.options.getInteger("from") ?? undefined;
    const to = interaction.options.getInteger("to") ?? undefined;
    const allGuilds = interaction.options.getBoolean("all-guilds") ?? false;

    // Resolve time window
    const window = parseWindow(nowUtc(), from, to);

    // Validate from < to
    if (window.from > window.to) {
      await interaction.editReply({
        content: "❌ Invalid time range: `from` must be before `to`.",
      });
      return;
    }

    // Permission check
    if (allGuilds) {
      if (!isOwner(interaction.user.id)) {
        await interaction.editReply({
          content: "❌ The `--all-guilds` flag is restricted to bot owners.",
        });
        return;
      }
    } else {
      if (!interaction.guildId) {
        await interaction.editReply({
          content: "❌ This command must be run in a guild.",
        });
        return;
      }

      const member = interaction.member as GuildMember | null;
      if (!member || !hasStaffPermissions(member, interaction.guildId)) {
        await interaction.editReply({
          content: "❌ You don't have permission to use this command.",
        });
        return;
      }
    }

    const scope = allGuilds ? undefined : interaction.guildId!;
    const scopeLabel = allGuilds ? "all" : scope;

    // Sentry span
    captureException(null, {
      area: "analytics.export",
      tags: {
        from: window.from,
        to: window.to,
        scope: scopeLabel,
      },
    });

    // Stream CSV to buffer
    // We use a PassThrough stream here instead of buffering in memory because:
    // 1. It lets streamReviewActionsCSV write incrementally (back-pressure friendly)
    // 2. Future optimization: could stream directly to Discord if they ever support it
    // Current limitation: We still buffer the full CSV before sending, so very large
    // exports (100k+ rows) could cause memory pressure. Consider pagination for those.
    const chunks: Buffer[] = [];
    const stream = new PassThrough();

    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

    const exportPromise = streamReviewActionsCSV(
      {
        guildId: scope,
        from: window.from,
        to: window.to,
        allGuilds,
      },
      stream
    );

    const { rowCount, bytes } = await exportPromise;

    // Wait for stream to finish
    await new Promise<void>((resolve) => {
      stream.on("end", () => resolve());
    });

    const buffer = Buffer.concat(chunks);

    // Create attachment
    const filename = `analytics_${scopeLabel}_${window.from}-${window.to}.csv`;
    const attachment = new AttachmentBuilder(buffer, { name: filename });

    const elapsed = Date.now() - start;
    logger.info(
      {
        export: "analytics",
        rows: rowCount,
        bytes,
        ms: elapsed,
        scope: scopeLabel,
      },
      "[analytics] export completed"
    );

    await interaction.editReply({
      content: `📊 Export complete: **${rowCount}** rows, ${(bytes / 1024).toFixed(1)} KB`,
      files: [attachment],
    });
  } catch (err) {
    const traceId = ctx.traceId;
    logger.error({ err, traceId }, "[analytics] export failed");
    captureException(err, { area: "analytics.export", traceId });

    await interaction
      .editReply({
        content: `❌ Export failed. Trace ID: \`${traceId}\``,
      })
      .catch(() => undefined);
  }
}
