/**
 * Pawtropolis Tech — src/logging/pretty.ts
 * WHAT: Pretty embed logging for moderator actions and analytics.
 * WHY: Provides audit trail + beautiful logging channel cards for every action.
 * FLOWS:
 *  - logActionPretty(guild, { appId?, appCode?, actorId, subjectId?, action, reason?, meta? })
 *    → inserts into action_log + posts embed to logging channel
 * DOCS:
 *  - Discord Embeds: https://discord.js.org/#/docs/discord.js/main/class/EmbedBuilder
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Guild } from "discord.js";
import { EmbedBuilder, TextChannel, ChannelType } from "discord.js";
import { db } from "../db/db.js";
import { nowUtc } from "../lib/time.js";
import { getLoggingChannelId } from "../config/loggingStore.js";
import { logger } from "../lib/logger.js";
import { getLoggingChannel, logActionJSON } from "../features/logger.js";

/**
 * Action types allowed in action_log
 */
export type ActionType =
  | "app_submitted"
  | "claim"
  | "unclaim"
  | "approve"
  | "reject"
  | "need_info"
  | "perm_reject"
  | "kick"
  | "modmail_open"
  | "modmail_close"
  | "modmail_transcript_fail"
  | "member_join"
  | "db_recover_list"
  | "db_recover_validate"
  | "db_recover_restore"
  | "ops_health_alert"
  | "ops_health_ack"
  | "ops_health_resolve"
  | "listopen_view"
  | "listopen_view_all"
  | "set_listopen_output"
  | "forum_post_ping"
  | "forum_post_ping_fail"
  | "modhistory_view"
  | "modhistory_export"
  | "modhistory_list"
  | "role_grant"
  | "role_grant_skipped"
  | "role_grant_blocked"
  | "panic_enabled"
  | "panic_disabled";

/**
 * Parameters for logging an action
 */
export interface LogActionParams {
  appId?: string;
  appCode?: string;
  actorId: string;
  subjectId?: string;
  action: ActionType;
  reason?: string;
  meta?: Record<string, any>;
}

/**
 * Action metadata for embed rendering
 */
interface ActionMeta {
  title: string;
  color: number;
  emoji: string;
}

/**
 * WHAT: Get display metadata for each action type.
 * WHY: Consistent colors, titles, and emojis across logging embeds.
 */
function getActionMeta(action: ActionType): ActionMeta {
  const meta: Record<ActionType, ActionMeta> = {
    app_submitted: {
      title: "Application Submitted",
      color: 0x5865f2, // Discord blurple
      emoji: "📝",
    },
    claim: {
      title: "Application Claimed",
      color: 0xfee75c, // Yellow
      emoji: "🏷️",
    },
    unclaim: {
      title: "Application Unclaimed",
      color: 0x99aab5, // Gray
      emoji: "🔓",
    },
    approve: {
      title: "Application Approved",
      color: 0x57f287, // Green
      emoji: "✅",
    },
    reject: {
      title: "Application Rejected",
      color: 0xed4245, // Red
      emoji: "❌",
    },
    need_info: {
      title: "More Info Requested",
      color: 0xfee75c, // Yellow
      emoji: "❓",
    },
    perm_reject: {
      title: "Permanently Rejected",
      color: 0x99000, // Dark red
      emoji: "⛔",
    },
    kick: {
      title: "Applicant Kicked",
      color: 0xed4245, // Red
      emoji: "👢",
    },
    modmail_open: {
      title: "Modmail Thread Opened",
      color: 0x5865f2, // Blurple
      emoji: "💬",
    },
    modmail_close: {
      title: "Modmail Thread Closed",
      color: 0x99aab5, // Gray
      emoji: "🔒",
    },
    modmail_transcript_fail: {
      title: "Modmail Transcript Failed",
      color: 0xed4245, // Red
      emoji: "⚠️",
    },
    member_join: {
      title: "Member Joined",
      color: 0x57f287, // Green
      emoji: "👋",
    },
    db_recover_list: {
      title: "Database Recovery — List Candidates",
      color: 0x3b82f6, // Blue
      emoji: "🗄️",
    },
    db_recover_validate: {
      title: "Database Recovery — Validate Backup",
      color: 0x3b82f6, // Blue
      emoji: "🔍",
    },
    db_recover_restore: {
      title: "Database Recovery — Restore",
      color: 0xfbbf24, // Amber (warning)
      emoji: "⚠️",
    },
    ops_health_alert: {
      title: "Operations Health Alert",
      color: 0xed4245, // Red
      emoji: "🚨",
    },
    ops_health_ack: {
      title: "Operations Health Alert Acknowledged",
      color: 0xfee75c, // Yellow
      emoji: "✔️",
    },
    ops_health_resolve: {
      title: "Operations Health Alert Resolved",
      color: 0x57f287, // Green
      emoji: "✅",
    },
    listopen_view: {
      title: "Viewed Open Applications",
      color: 0x5865f2, // Discord blurple
      emoji: "📋",
    },
    listopen_view_all: {
      title: "Viewed All Open Applications",
      color: 0xeb459e, // Pink (matches all view embed)
      emoji: "📋",
    },
    set_listopen_output: {
      title: "Set /listopen Output Mode",
      color: 0x3498db, // Blue
      emoji: "⚙️",
    },
    forum_post_ping: {
      title: "Forum Post Notification Sent",
      color: 0x5865f2, // Discord blurple
      emoji: "📢",
    },
    forum_post_ping_fail: {
      title: "Forum Post Notification Failed",
      color: 0xed4245, // Red
      emoji: "❌",
    },
    modhistory_view: {
      title: "Moderator History Viewed",
      color: 0x5865f2, // Discord blurple
      emoji: "📊",
    },
    modhistory_export: {
      title: "Moderator History Exported",
      color: 0xfaa61a, // Orange/Warning
      emoji: "📥",
    },
    modhistory_list: {
      title: "Moderator List Viewed",
      color: 0x5865f2, // Discord blurple
      emoji: "👥",
    },
    role_grant: {
      title: "Role Granted (Auto)",
      color: 0x57f287, // Green
      emoji: "🎁",
    },
    role_grant_skipped: {
      title: "Role Grant Skipped",
      color: 0x99aab5, // Gray
      emoji: "⏭️",
    },
    role_grant_blocked: {
      title: "Role Grant Blocked",
      color: 0xed4245, // Red
      emoji: "🚫",
    },
    panic_enabled: {
      title: "PANIC MODE ENABLED",
      color: 0xed4245, // Red
      emoji: "🚨",
    },
    panic_disabled: {
      title: "Panic Mode Disabled",
      color: 0x57f287, // Green
      emoji: "✅",
    },
  };

  return meta[action];
}

/**
 * WHAT: Log an action to action_log and post pretty embed to logging channel.
 * WHY: Single source of truth for all moderator actions and analytics data.
 *
 * @param guild - Discord guild where action occurred
 * @param params - Action parameters (appId, actorId, action, reason, etc.)
 * @example
 * await logActionPretty(guild, {
 *   appId: 'app-123',
 *   appCode: 'A1B2C3',
 *   actorId: '12345678',
 *   subjectId: '87654321',
 *   action: 'approve',
 *   reason: 'Great application!',
 * });
 */
export async function logActionPretty(guild: Guild, params: LogActionParams): Promise<void> {
  const { appId, appCode, actorId, subjectId, action, reason, meta } = params;

  const createdAt = nowUtc();
  const metaJson = meta ? JSON.stringify(meta) : null;

  // Insert into action_log table (append-only audit trail)
  // This powers /modstats analytics and provides durable event history
  // All timestamps use Unix epoch seconds for consistency with review_action table
  try {
    db.prepare(
      `
      INSERT INTO action_log (
        guild_id, app_id, app_code, actor_id, subject_id,
        action, reason, meta_json, created_at_s
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      guild.id,
      appId || null,
      appCode || null,
      actorId,
      subjectId || null,
      action,
      reason || null,
      metaJson,
      createdAt
    );

    logger.debug(
      { guildId: guild.id, action, actorId, appId, appCode },
      "[logging] action_log entry created"
    );
  } catch (err) {
    logger.error(
      { err, guildId: guild.id, action, actorId },
      "[logging] failed to insert action_log row"
    );
    return; // Don't proceed to embed if DB insert failed
  }

  // Get logging channel with permission validation
  // Priority: DB guild_config.logging_channel_id → env LOGGING_CHANNEL → null
  // Validates channel exists + bot has SendMessages + EmbedLinks permissions
  const channel = await getLoggingChannel(guild);

  if (!channel) {
    // Fallback: emit single-line JSON for external log aggregation
    // This ensures actions are recorded even when Discord channel unavailable
    logActionJSON({
      action,
      appId,
      appCode,
      moderatorId: actorId,
      applicantId: subjectId,
      reason,
      metadata: meta,
      timestamp: createdAt,
    });
    return;
  }

  // Build embed with color-coded metadata
  // Color scheme matches Discord conventions (green=approve, red=reject, etc.)
  const actionMeta = getActionMeta(action);
  const embed = new EmbedBuilder()
    .setTitle(`${actionMeta.emoji} ${actionMeta.title}`)
    .setColor(actionMeta.color)
    .setTimestamp(createdAt * 1000); // Convert Unix seconds → milliseconds for Discord

  // Add fields - prefer appCode (short hex) over appId (full UUID)
  // appId is stored in DB for data integrity but humans see appCode
  if (appCode) {
    embed.addFields({ name: "App Code", value: `\`${appCode}\``, inline: true });
  } else if (appId) {
    // Fallback: extract short code from appId if appCode not provided
    const { shortCode } = await import("../lib/ids.js");
    const code = shortCode(appId);
    embed.addFields({ name: "App Code", value: `\`${code}\``, inline: true });
  }

  embed.addFields({ name: "Actor", value: `<@${actorId}>`, inline: true });

  if (subjectId) {
    embed.addFields({ name: "Applicant", value: `<@${subjectId}>`, inline: true });
  }

  if (reason) {
    embed.addFields({ name: "Reason", value: reason, inline: false });
  }

  // Add meta fields for specific actions
  if (meta && action === "modmail_close") {
    if (meta.transcriptLines !== undefined) {
      embed.addFields({
        name: "Transcript",
        value: `${meta.transcriptLines} lines`,
        inline: true,
      });
    }
    if (meta.archive) {
      embed.addFields({
        name: "Archive Method",
        value: meta.archive === "delete" ? "🗑️ Deleted" : "📦 Archived",
        inline: true,
      });
    }
  }

  if (meta && action === "modmail_open" && meta.public !== undefined) {
    embed.addFields({
      name: "Visibility",
      value: meta.public ? "🌐 Public" : "🔒 Private",
      inline: true,
    });
  }

  // Add meta fields for role grant actions
  if (meta && (action === "role_grant" || action === "role_grant_skipped" || action === "role_grant_blocked")) {
    if (meta.level !== undefined) {
      embed.addFields({
        name: "Level",
        value: `${meta.level}`,
        inline: true,
      });
    }
    if (meta.levelRoleName) {
      embed.addFields({
        name: "Level Role",
        value: meta.levelRoleId ? `${meta.levelRoleName} (<@&${meta.levelRoleId}>)` : meta.levelRoleName,
        inline: true,
      });
    }
    if (meta.rewardRoleName) {
      embed.addFields({
        name: "Reward Role",
        value: meta.rewardRoleId ? `${meta.rewardRoleName} (<@&${meta.rewardRoleId}>)` : meta.rewardRoleName,
        inline: true,
      });
    }
  }

  // Send embed to logging channel
  // IMPORTANT: allowedMentions: { parse: [] } prevents @mentions from pinging users
  // This is critical for audit logs - we want to show WHO acted, not ping them
  try {
    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] }, // Suppress all mentions in logs
    });
    logger.debug(
      { guildId: guild.id, channelId: channel.id, action },
      "[logging] embed posted successfully"
    );
  } catch (err) {
    logger.warn(
      { err, guildId: guild.id, channelId: channel.id },
      "[logging] failed to post embed - falling back to JSON"
    );

    // Fallback to JSON logging if embed send fails
    logActionJSON({
      action,
      appId,
      appCode,
      moderatorId: actorId,
      applicantId: subjectId,
      reason,
      metadata: meta,
      timestamp: createdAt,
    });
  }
}
