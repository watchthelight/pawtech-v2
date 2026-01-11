/**
 * Pawtropolis Tech — src/commands/developer.ts
 * WHAT: Developer/debugging commands for staff to inspect traces and system state
 * WHY: Enable staff to debug issues by looking up trace IDs from error cards
 * FLOWS:
 *  - /developer trace <trace_id> → lookup trace from cache → display verbose breakdown
 * DOCS:
 *  - Trace Store: src/lib/traceStore.ts
 *  - Wide Events: src/lib/wideEvent.ts
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";
import { requireStaff } from "../lib/config.js";
import { getTrace, getTraceStats } from "../lib/traceStore.js";
import type { WideEvent, PhaseRecord, QueryRecord, EntityRef } from "../lib/wideEvent.js";

// ===== Command Definition =====

export const data = new SlashCommandBuilder()
  .setName("developer")
  .setDescription("Developer tools for debugging")
  .addSubcommand((sub) =>
    sub
      .setName("trace")
      .setDescription("Look up a trace by ID from an error card")
      .addStringOption((opt) =>
        opt
          .setName("trace_id")
          .setDescription("The trace ID from the error card footer (e.g., xd6i6lUUV6g)")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("stats")
      .setDescription("Show trace cache statistics")
  );

// ===== Execute Handler =====

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  // Staff permission check
  if (!requireStaff(interaction)) return;

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "trace":
      await handleTrace(ctx);
      break;
    case "stats":
      await handleStats(ctx);
      break;
    default:
      await interaction.reply({
        content: "Unknown subcommand.",
      });
  }
}

// ===== Trace Subcommand =====

async function handleTrace(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const traceId = interaction.options.getString("trace_id", true).trim();

  // Validate trace ID format (11 chars, alphanumeric)
  if (!/^[a-zA-Z0-9]{11}$/.test(traceId)) {
    await interaction.reply({
      content: `Invalid trace ID format. Expected 11 alphanumeric characters, got: \`${traceId}\``,
    });
    return;
  }

  await withStep(ctx, "lookup_trace", async () => {
    const trace = getTrace(traceId);

    if (!trace) {
      const stats = getTraceStats();
      await interaction.reply({
        content: `Trace \`${traceId}\` not found. Traces expire after ${stats.ttlMinutes} minutes.\n\nCurrently storing ${stats.size}/${stats.maxSize} traces.`,
      });
      return;
    }

    await withStep(ctx, "build_embeds", async () => {
      const embeds = buildTraceEmbeds(trace);

      await withStep(ctx, "reply", async () => {
        await interaction.reply({
          embeds,
        });
      });
    });
  });
}

// ===== Stats Subcommand =====

async function handleStats(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "get_stats", async () => {
    const stats = getTraceStats();

    const embed = new EmbedBuilder()
      .setTitle("Trace Cache Statistics")
      .setColor(0x5865f2)
      .addFields(
        { name: "Traces Stored", value: `${stats.size}/${stats.maxSize}`, inline: true },
        { name: "TTL", value: `${stats.ttlMinutes} minutes`, inline: true },
        { name: "Memory Est.", value: `~${Math.round(stats.size * 2)}KB`, inline: true }
      )
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
    });
  });
}

// ===== Embed Builders =====

function buildTraceEmbeds(trace: WideEvent): EmbedBuilder[] {
  const embeds: EmbedBuilder[] = [];

  // Embed 1: Request Overview
  embeds.push(buildOverviewEmbed(trace));

  // Embed 2: Execution Timeline
  embeds.push(buildTimelineEmbed(trace));

  // Embed 3: Database Queries (if any)
  if (trace.queries.length > 0) {
    embeds.push(buildQueriesEmbed(trace));
  }

  // Embed 4: User Context
  embeds.push(buildUserContextEmbed(trace));

  // Embed 5: Error Details (if error)
  if (trace.error) {
    embeds.push(buildErrorEmbed(trace));
  }

  // Embed 6: Custom Attributes (if any)
  if (Object.keys(trace.attrs).length > 0 || trace.entitiesAffected.length > 0) {
    embeds.push(buildAttributesEmbed(trace));
  }

  return embeds;
}

function buildOverviewEmbed(trace: WideEvent): EmbedBuilder {
  const outcomeEmoji = getOutcomeEmoji(trace.outcome);
  const commandLabel = formatCommandLabel(trace);

  const embed = new EmbedBuilder()
    .setTitle(`Trace: ${trace.traceId}`)
    .setColor(getOutcomeColor(trace.outcome))
    .setDescription(`**Command:** ${commandLabel}`)
    .addFields(
      { name: "Outcome", value: `${outcomeEmoji} ${trace.outcome}`, inline: true },
      { name: "Duration", value: `${trace.durationMs}ms`, inline: true },
      { name: "Kind", value: trace.kind ?? "unknown", inline: true }
    );

  if (trace.guildId) {
    embed.addFields({ name: "Guild ID", value: `\`${trace.guildId}\``, inline: true });
  }
  if (trace.channelId) {
    embed.addFields({ name: "Channel ID", value: `\`${trace.channelId}\``, inline: true });
  }
  if (trace.userId) {
    embed.addFields({ name: "User ID", value: `\`${trace.userId}\``, inline: true });
  }

  embed.addFields(
    { name: "Deferred", value: trace.wasDeferred ? "Yes" : "No", inline: true },
    { name: "Replied", value: trace.wasReplied ? "Yes" : "No", inline: true },
    { name: "Environment", value: trace.environment, inline: true }
  );

  embed.setFooter({ text: `Version ${trace.serviceVersion}` });
  embed.setTimestamp(new Date(trace.timestamp));

  return embed;
}

function buildTimelineEmbed(trace: WideEvent): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("Execution Timeline")
    .setColor(0x5865f2);

  if (trace.phases.length === 0) {
    embed.setDescription("No execution phases recorded.");
    return embed;
  }

  const failedPhase = trace.error?.phase;
  const lines = trace.phases.map((phase) => formatPhaseLine(phase, failedPhase));

  // Calculate relative start times from first phase
  const firstStart = trace.phases[0]?.startMs ?? 0;
  const tableLines = trace.phases.map((phase) => {
    const relativeStart = phase.startMs - firstStart;
    const duration = phase.durationMs ?? "...";
    const isFailed = phase.name === failedPhase;
    const marker = isFailed ? " **<-- ERROR**" : "";
    const prefix = isFailed ? "\u274C " : "";
    return `${prefix}**${phase.name}** @ ${relativeStart}ms (${duration}ms)${marker}`;
  });

  embed.setDescription(tableLines.join("\n"));
  embed.setFooter({ text: `Total: ${trace.phases.length} phases, ${trace.durationMs}ms` });

  return embed;
}

function buildQueriesEmbed(trace: WideEvent): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("Database Queries")
    .setColor(0xffa500);

  const queryLines = trace.queries.map((q, i) => formatQueryLine(q, i + 1));

  // Truncate if too many queries
  const maxQueries = 10;
  let description = queryLines.slice(0, maxQueries).join("\n\n");
  if (queryLines.length > maxQueries) {
    description += `\n\n*...and ${queryLines.length - maxQueries} more queries*`;
  }

  embed.setDescription(description);
  embed.setFooter({ text: `Total: ${trace.queries.length} queries, ${trace.totalDbTimeMs}ms` });

  return embed;
}

function buildUserContextEmbed(trace: WideEvent): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("User Context")
    .setColor(0x5865f2);

  const permissions = [
    trace.isOwner ? "Owner" : null,
    trace.isAdmin ? "Admin" : null,
    trace.isStaff ? "Staff" : null,
  ].filter(Boolean);

  const permString = permissions.length > 0 ? permissions.join(", ") : "None";

  embed.addFields(
    { name: "Username", value: trace.username ?? "unknown", inline: true },
    { name: "User ID", value: trace.userId ?? "unknown", inline: true },
    { name: "Permissions", value: permString, inline: true }
  );

  embed.addFields({
    name: "Role Count",
    value: `${trace.userRoles.length} roles`,
    inline: true,
  });

  // Show first few role IDs
  if (trace.userRoles.length > 0) {
    const maxRoles = 10;
    const roleList = trace.userRoles.slice(0, maxRoles).map((r) => `\`${r}\``).join(", ");
    const suffix = trace.userRoles.length > maxRoles ? ` (+${trace.userRoles.length - maxRoles} more)` : "";
    embed.addFields({
      name: "Role IDs",
      value: roleList + suffix,
      inline: false,
    });
  }

  return embed;
}

function buildErrorEmbed(trace: WideEvent): EmbedBuilder {
  const error = trace.error!;

  const embed = new EmbedBuilder()
    .setTitle("Error Details")
    .setColor(0xed4245);

  embed.addFields(
    { name: "Kind", value: `\`${error.kind}\``, inline: true },
    { name: "Code", value: error.code !== null ? `\`${error.code}\`` : "none", inline: true },
    { name: "Retriable", value: error.isRetriable ? "Yes" : "No", inline: true }
  );

  embed.addFields({
    name: "Message",
    value: error.message.slice(0, 1000) || "No message",
    inline: false,
  });

  embed.addFields({
    name: "Failed Phase",
    value: `\`${error.phase}\``,
    inline: true,
  });

  if (error.sentryEventId) {
    embed.addFields({
      name: "Sentry ID",
      value: `\`${error.sentryEventId}\``,
      inline: true,
    });
  }

  if (error.lastSql) {
    embed.addFields({
      name: "Last SQL",
      value: `\`\`\`sql\n${error.lastSql.slice(0, 500)}\n\`\`\``,
      inline: false,
    });
  }

  if (error.stack) {
    embed.addFields({
      name: "Stack Trace",
      value: `\`\`\`\n${error.stack.slice(0, 800)}\n\`\`\``,
      inline: false,
    });
  }

  return embed;
}

function buildAttributesEmbed(trace: WideEvent): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("Custom Attributes & Entities")
    .setColor(0x5865f2);

  // Feature/action context
  if (trace.feature || trace.action) {
    embed.addFields({
      name: "Feature Context",
      value: `Feature: \`${trace.feature ?? "none"}\` | Action: \`${trace.action ?? "none"}\``,
      inline: false,
    });
  }

  // Custom attributes
  const attrEntries = Object.entries(trace.attrs);
  if (attrEntries.length > 0) {
    const attrLines = attrEntries.map(([k, v]) => `**${k}**: \`${formatAttrValue(v)}\``);
    embed.addFields({
      name: "Attributes",
      value: attrLines.join("\n").slice(0, 1000),
      inline: false,
    });
  }

  // Entities affected
  if (trace.entitiesAffected.length > 0) {
    const entityLines = trace.entitiesAffected.map((e) => formatEntityRef(e));
    embed.addFields({
      name: "Entities Affected",
      value: entityLines.join("\n").slice(0, 1000),
      inline: false,
    });
  }

  return embed;
}

// ===== Helpers =====

function getOutcomeEmoji(outcome: string): string {
  switch (outcome) {
    case "success":
      return "\u2705";
    case "error":
      return "\u274C";
    case "timeout":
      return "\u23F1\uFE0F";
    case "cancelled":
      return "\u26D4";
    default:
      return "\u2753";
  }
}

function getOutcomeColor(outcome: string): number {
  switch (outcome) {
    case "success":
      return 0x57f287; // Green
    case "error":
      return 0xed4245; // Red
    case "timeout":
      return 0xffa500; // Orange
    case "cancelled":
      return 0x99aab5; // Gray
    default:
      return 0x5865f2; // Blurple
  }
}

function formatCommandLabel(trace: WideEvent): string {
  let label = trace.command ?? trace.customId ?? trace.kind ?? "unknown";
  if (trace.subcommand) {
    label += ` ${trace.subcommand}`;
  }
  return `\`/${label}\``;
}

function formatPhaseLine(phase: PhaseRecord, failedPhase?: string): string {
  const isFailed = phase.name === failedPhase;
  const duration = phase.durationMs !== null ? `${phase.durationMs}ms` : "...";
  const prefix = isFailed ? "\u274C " : "";
  return `${prefix}${phase.name} (${duration})`;
}

function formatQueryLine(query: QueryRecord, index: number): string {
  const table = query.table ? `[${query.table}]` : "[?]";
  const truncatedSql = query.sql.length > 100 ? query.sql.slice(0, 100) + "..." : query.sql;
  return `**#${index}** ${table} - ${query.durationMs}ms\n\`\`\`sql\n${truncatedSql}\n\`\`\``;
}

function formatAttrValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value.slice(0, 100);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value).slice(0, 100);
}

function formatEntityRef(entity: EntityRef): string {
  const id = entity.code ?? entity.id;
  return `${entity.type}: \`${id}\``;
}
