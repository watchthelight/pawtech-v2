/**
 * Pawtropolis Tech -- src/commands/config/get.ts
 * WHAT: Get/view handlers for /config commands.
 * WHY: Groups all configuration viewing handlers together.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { EmbedBuilder, Colors } from "discord.js";
import {
  type ChatInputCommandInteraction,
  MessageFlags,
  getConfig,
  type CommandContext,
  replyOrEdit,
  ensureDeferred,
  getLoggingChannelId,
  getFlaggerConfig,
} from "./shared.js";

export async function executeGetLogging(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Shows current logging config with the full resolution chain.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_logging_config");
  const loggingChannelId = getLoggingChannelId(interaction.guildId!);

  const lines = ["**Action Logging Configuration**", ""];

  if (loggingChannelId) {
    lines.push(`**Logging Channel:** <#${loggingChannelId}>`);
    lines.push("");
    lines.push("All moderator actions (accept, reject, claim, modmail, etc.) are logged here.");
    lines.push("");
    lines.push("**Resolution Priority:**");
    lines.push("1. Guild-specific database configuration (current)");
    lines.push("2. Environment variable `LOGGING_CHANNEL` (if set)");
    lines.push("3. JSON console fallback (if no channel available)");
  } else {
    const envChannel = process.env.LOGGING_CHANNEL;
    if (envChannel) {
      lines.push(`**Logging Channel:** <#${envChannel}> (from environment variable)`);
      lines.push("");
      lines.push("Using fallback from `LOGGING_CHANNEL` env var.");
      lines.push("");
      lines.push("**To set a guild-specific channel:**");
      lines.push("`/config set logging channel:#your-channel`");
    } else {
      lines.push("**No logging channel configured**");
      lines.push("");
      lines.push("Actions are being logged as JSON to console only.");
      lines.push("");
      lines.push("**To enable pretty embed logging:**");
      lines.push("`/config set logging channel:#your-channel`");
    }
  }

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: lines.join("\n"),
    flags: interaction.replied ? undefined : MessageFlags.Ephemeral,
  });
}

export async function executeGetFlags(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Shows flag config with health checks.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_flags_config");
  const config = getFlaggerConfig(interaction.guildId!);

  const lines = ["**Silent-Since-Join Flagger Configuration (PR8)**", ""];

  if (config.channelId) {
    // Verify the channel still exists
    const channel = await interaction.guild!.channels.fetch(config.channelId).catch(() => null);
    if (channel) {
      const botMember = await interaction.guild!.members.fetchMe();
      const permissions = channel.permissionsFor(botMember);
      const hasPerms = permissions?.has("SendMessages") && permissions?.has("EmbedLinks");

      if (hasPerms) {
        lines.push(`**Flags Channel:** <#${config.channelId}> (healthy)`);
      } else {
        lines.push(`**Flags Channel:** <#${config.channelId}> (missing permissions)`);
        lines.push("   Bot needs SendMessages + EmbedLinks permissions");
      }
    } else {
      lines.push(`**Flags Channel:** <#${config.channelId}> (channel not found)`);
    }
  } else {
    const envChannel = process.env.FLAGGED_REPORT_CHANNEL_ID;
    if (envChannel) {
      lines.push(`**Flags Channel:** <#${envChannel}> (from environment variable)`);
      lines.push("");
      lines.push("Using fallback from `FLAGGED_REPORT_CHANNEL_ID` env var.");
      lines.push("");
      lines.push("**To set a guild-specific channel:**");
      lines.push("`/config set flags_channel channel:#your-channel`");
    } else {
      lines.push("**No flags channel configured**");
      lines.push("");
      lines.push("Silent-Since-Join detection is disabled until a channel is configured.");
      lines.push("");
      lines.push("**To enable flagging:**");
      lines.push("`/config set flags_channel channel:#your-channel`");
    }
  }

  // Threshold configuration
  lines.push("");
  lines.push(`**Silent Days Threshold:** ${config.silentDays} days`);
  lines.push("");
  lines.push("**Resolution Priority:**");
  lines.push("1. Guild-specific database configuration");
  lines.push("2. Environment variable `SILENT_FIRST_MSG_DAYS` (if set)");
  lines.push("3. Default: 90 days");
  lines.push("");
  lines.push("**To change threshold:**");
  lines.push("`/config set flags_threshold days:120`");

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: lines.join("\n"),
    flags: interaction.replied ? undefined : MessageFlags.Ephemeral,
  });
}

export async function executeView(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Displays ALL guild configuration variables and values.
   */
  const { interaction } = ctx;

  // Defer reply without ephemeral flag so everyone can see it
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }

  ctx.step("load_config");
  const cfg = getConfig(interaction.guildId!);
  if (!cfg) {
    await replyOrEdit(interaction, { content: "No configuration found. Run /gate setup first." });
    return;
  }

  ctx.step("format_display");
  const embeds: EmbedBuilder[] = [];

  // Helper to format value
  const fmt = (v: unknown, type?: "channel" | "role" | "user"): string => {
    if (v === null || v === undefined) return "*not set*";
    if (type === "channel") return `<#${v}>`;
    if (type === "role") return `<@&${v}>`;
    if (type === "user") return `<@${v}>`;
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (typeof v === "number") return v.toLocaleString();
    return String(v);
  };

  // EMBED 1: Permission & Channel Settings
  const embed1 = new EmbedBuilder()
    .setTitle("Guild Configuration (1/3)")
    .setColor(Colors.Blue);

  // Permission Settings
  let permValue = "";
  if (cfg.mod_role_ids && cfg.mod_role_ids.trim().length > 0) {
    const roleIds = cfg.mod_role_ids.split(",").map(id => id.trim()).filter(id => id);
    permValue += `- mod_role_ids: ${roleIds.map(id => `<@&${id}>`).join(", ")}\n`;
  } else {
    permValue += "- mod_role_ids: *not set*\n";
  }
  permValue += `- gatekeeper_role_id: ${fmt(cfg.gatekeeper_role_id, "role")}\n`;
  permValue += `- reviewer_role_id: ${fmt(cfg.reviewer_role_id, "role")}\n`;
  permValue += `- leadership_role_id: ${fmt(cfg.leadership_role_id, "role")}\n`;
  permValue += `- bot_dev_role_id: ${fmt(cfg.bot_dev_role_id, "role")}`;
  embed1.addFields({ name: "Permission Settings", value: permValue, inline: false });

  // Channel Settings
  let channelValue = "";
  channelValue += `- review_channel_id: ${fmt(cfg.review_channel_id, "channel")}\n`;
  channelValue += `- gate_channel_id: ${fmt(cfg.gate_channel_id, "channel")}\n`;
  channelValue += `- general_channel_id: ${fmt(cfg.general_channel_id, "channel")}\n`;
  channelValue += `- unverified_channel_id: ${fmt(cfg.unverified_channel_id, "channel")}\n`;
  channelValue += `- modmail_log_channel_id: ${fmt(cfg.modmail_log_channel_id, "channel")}\n`;
  channelValue += `- logging_channel_id: ${fmt(cfg.logging_channel_id, "channel")}\n`;
  channelValue += `- flags_channel_id: ${fmt(cfg.flags_channel_id, "channel")}\n`;
  channelValue += `- forum_channel_id: ${fmt(cfg.forum_channel_id, "channel")}\n`;
  channelValue += `- notification_channel_id: ${fmt(cfg.notification_channel_id, "channel")}\n`;
  channelValue += `- backfill_notification_channel_id: ${fmt(cfg.backfill_notification_channel_id, "channel")}\n`;
  channelValue += `- support_channel_id: ${fmt(cfg.support_channel_id, "channel")}\n`;
  channelValue += `- server_artist_channel_id: ${fmt(cfg.server_artist_channel_id, "channel")}`;
  embed1.addFields({ name: "Channel Settings", value: channelValue, inline: false });

  embeds.push(embed1);

  // EMBED 2: Role & Feature Settings
  const embed2 = new EmbedBuilder()
    .setTitle("Guild Configuration (2/3)")
    .setColor(Colors.Blue);

  // Role Settings
  let roleValue = "";
  roleValue += `- accepted_role_id: ${fmt(cfg.accepted_role_id, "role")}\n`;
  roleValue += `- welcome_ping_role_id: ${fmt(cfg.welcome_ping_role_id, "role")}\n`;
  roleValue += `- notify_role_id: ${fmt(cfg.notify_role_id, "role")}\n`;
  roleValue += `- artist_role_id: ${fmt(cfg.artist_role_id, "role")}\n`;
  roleValue += `- ambassador_role_id: ${fmt(cfg.ambassador_role_id, "role")}`;
  embed2.addFields({ name: "Role Settings", value: roleValue, inline: false });

  // Feature Toggles
  let featureValue = "";
  featureValue += `- avatar_scan_enabled: ${cfg.avatar_scan_enabled ? "yes" : "no"}\n`;
  featureValue += `- dadmode_enabled: ${cfg.dadmode_enabled ? `yes (1 in ${cfg.dadmode_odds ?? 1000})` : "no"}\n`;
  featureValue += `- ping_dev_on_app: ${cfg.ping_dev_on_app ? "yes" : "no"}\n`;
  featureValue += `- listopen_public_output: ${cfg.listopen_public_output ? "public" : "ephemeral"}\n`;
  featureValue += `- modmail_delete_on_close: ${cfg.modmail_delete_on_close ? "yes" : "no"}\n`;
  featureValue += `- banner_sync_enabled: ${(cfg.banner_sync_enabled ?? 1) ? "yes" : "no"}\n`;
  featureValue += `- review_roles_mode: ${cfg.review_roles_mode ?? "all"}\n`;
  featureValue += `- notify_mode: ${cfg.notify_mode ?? "post"}`;
  embed2.addFields({ name: "Feature Toggles", value: featureValue, inline: false });

  // Timing & Thresholds
  let timingValue = "";
  timingValue += `- reapply_cooldown_hours: ${cfg.reapply_cooldown_hours ?? 24}\n`;
  timingValue += `- min_account_age_hours: ${cfg.min_account_age_hours ?? 0}\n`;
  timingValue += `- min_join_age_hours: ${cfg.min_join_age_hours ?? 0}\n`;
  timingValue += `- silent_first_msg_days: ${cfg.silent_first_msg_days ?? 90}\n`;
  timingValue += `- notify_cooldown_seconds: ${cfg.notify_cooldown_seconds ?? 5}s\n`;
  timingValue += `- notify_max_per_hour: ${cfg.notify_max_per_hour ?? 10}\n`;
  timingValue += `- banner_sync_interval_minutes: ${cfg.banner_sync_interval_minutes ?? 10}min\n`;
  timingValue += `- gate_answer_max_length: ${cfg.gate_answer_max_length ?? 1000} chars`;
  embed2.addFields({ name: "Timing & Limits", value: timingValue, inline: false });

  embeds.push(embed2);

  // EMBED 3: Advanced Settings
  const embed3 = new EmbedBuilder()
    .setTitle("Guild Configuration (3/3)")
    .setColor(Colors.Blue)
    .setTimestamp();

  // Avatar Scan Settings
  let avatarValue = "";
  avatarValue += `- avatar_scan_nsfw_threshold: ${cfg.avatar_scan_nsfw_threshold ?? 0.6}\n`;
  avatarValue += `- avatar_scan_skin_edge_threshold: ${cfg.avatar_scan_skin_edge_threshold ?? 0.18}\n`;
  avatarValue += `- avatar_scan_weight_model: ${cfg.avatar_scan_weight_model ?? 0.7}\n`;
  avatarValue += `- avatar_scan_weight_edge: ${cfg.avatar_scan_weight_edge ?? 0.3}\n`;
  avatarValue += `- avatar_scan_hard_threshold: ${cfg.avatar_scan_hard_threshold ?? 0.8}\n`;
  avatarValue += `- avatar_scan_soft_threshold: ${cfg.avatar_scan_soft_threshold ?? 0.5}\n`;
  avatarValue += `- avatar_scan_racy_threshold: ${cfg.avatar_scan_racy_threshold ?? 0.8}`;
  embed3.addFields({ name: "Avatar Scan", value: avatarValue, inline: false });

  // Retry & Circuit Breaker
  let retryValue = "";
  retryValue += `- retry_max_attempts: ${cfg.retry_max_attempts ?? 3}\n`;
  retryValue += `- retry_initial_delay_ms: ${cfg.retry_initial_delay_ms ?? 100}ms\n`;
  retryValue += `- retry_max_delay_ms: ${cfg.retry_max_delay_ms ?? 5000}ms\n`;
  retryValue += `- circuit_breaker_threshold: ${cfg.circuit_breaker_threshold ?? 5}\n`;
  retryValue += `- circuit_breaker_reset_ms: ${cfg.circuit_breaker_reset_ms ?? 60000}ms`;
  embed3.addFields({ name: "Retry & Circuit Breaker", value: retryValue, inline: false });

  // Flag Rate Limiting
  let flagValue = "";
  flagValue += `- flag_rate_limit_ms: ${cfg.flag_rate_limit_ms ?? 2000}ms\n`;
  flagValue += `- flag_cooldown_ttl_ms: ${cfg.flag_cooldown_ttl_ms ?? 3600000}ms`;
  embed3.addFields({ name: "Flag Rate Limiting", value: flagValue, inline: false });

  // Modmail Settings
  let modmailValue = "";
  modmailValue += `- modmail_forward_max_size: ${cfg.modmail_forward_max_size ?? 10000}`;
  embed3.addFields({ name: "Modmail", value: modmailValue, inline: false });

  // JSON Config Fields (truncated display)
  const safeJsonLen = (json: string | null | undefined): string => {
    if (!json) return "*not set*";
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? `${parsed.length} items` : "configured";
    } catch {
      return "*invalid JSON*";
    }
  };
  let jsonValue = "";
  jsonValue += `- artist_ignored_users_json: ${safeJsonLen(cfg.artist_ignored_users_json)}\n`;
  jsonValue += `- artist_ticket_roles_json: ${cfg.artist_ticket_roles_json ? "configured" : "*not set*"}\n`;
  jsonValue += `- poke_category_ids_json: ${safeJsonLen(cfg.poke_category_ids_json)}\n`;
  jsonValue += `- poke_excluded_channel_ids_json: ${safeJsonLen(cfg.poke_excluded_channel_ids_json)}`;
  embed3.addFields({ name: "JSON Configs", value: jsonValue, inline: false });

  embeds.push(embed3);

  ctx.step("reply");
  await replyOrEdit(interaction, { embeds });
}
