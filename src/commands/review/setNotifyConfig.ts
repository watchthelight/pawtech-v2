/**
 * Pawtropolis Tech — src/commands/review/setNotifyConfig.ts
 * WHAT: Admin command to configure forum post notification settings
 * WHY: Allow admins to control where/how role pings are sent
 * SECURITY: Requires guild admin or reviewer role
 * FLOWS:
 *  - Parse options (mode, role, channel, cooldown, max_per_hour)
 *  - Validate inputs
 *  - Update guild_config via setNotifyConfig()
 *  - Log action to action_log + logActionPretty
 * DOCS:
 *  - discord.js SlashCommandBuilder: https://discord.js.org/#/docs/builders/main/class/SlashCommandBuilder
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import type { CommandContext } from "../../lib/cmdWrap.js";
import { setNotifyConfig, getNotifyConfig, type NotifyConfig } from "../../features/notifyConfig.js";
import { logActionPretty } from "../../logging/pretty.js";
import { logger } from "../../lib/logger.js";
import { requireAdminOrLeadership } from "../../utils/requireAdminOrLeadership.js";
import { db } from "../../db/db.js";

/**
 * Command builder for /review-set-notify-config.
 *
 * Two notification modes exist:
 * - "post": Pings role directly in the new forum thread (lower noise, but mods must visit thread)
 * - "channel": Posts to a dedicated channel (more visible, good for high-traffic forums)
 *
 * Rate limiting is built in because forum spam + role pings = very annoyed moderators.
 */
export const data = new SlashCommandBuilder()
  .setName("review-set-notify-config")
  .setDescription("Configure forum post notification settings (admin only)")
  .addStringOption((option) =>
    option
      .setName("mode")
      .setDescription("Notification mode: 'post' (in-thread) or 'channel' (separate channel)")
      .setRequired(false)
      .addChoices(
        { name: "post (in-thread)", value: "post" },
        { name: "channel (separate channel)", value: "channel" }
      )
  )
  .addRoleOption((option) =>
    option
      .setName("role")
      .setDescription("Role to ping when new forum post is created")
      .setRequired(false)
  )
  .addChannelOption((option) =>
    option
      .setName("forum")
      .setDescription("Forum channel to watch (leave empty to watch all forums)")
      .setRequired(false)
  )
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Channel to send notifications (only for mode=channel)")
      .setRequired(false)
  )
  // Cooldown prevents ping spam when multiple posts arrive in quick succession
  .addIntegerOption((option) =>
    option
      .setName("cooldown")
      .setDescription("Minimum seconds between notifications (default: 5)")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(300)
  )
  // Hourly cap is a safety net against sustained spam or bot attacks
  .addIntegerOption((option) =>
    option
      .setName("max_per_hour")
      .setDescription("Maximum notifications per hour (default: 10)")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(100)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (!guildId) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Authorization check
  const authorized = await requireAdminOrLeadership(interaction);
  if (!authorized) {
    await interaction.reply({
      content: "❌ You must be a server administrator to use this command.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Get current config for comparison
    const oldConfig = getNotifyConfig(guildId);

    // Parse options
    const mode = interaction.options.getString("mode") as "post" | "channel" | null;
    const role = interaction.options.getRole("role");
    const forum = interaction.options.getChannel("forum");
    const channel = interaction.options.getChannel("channel");
    const cooldown = interaction.options.getInteger("cooldown");
    const maxPerHour = interaction.options.getInteger("max_per_hour");

    // Build partial update - only include fields that were explicitly provided.
    // This allows users to update just one setting without touching others.
    const updateConfig: Partial<NotifyConfig> = {};

    if (mode !== null) {
      updateConfig.notify_mode = mode;
    }
    if (role !== null) {
      updateConfig.notify_role_id = role.id;
    }
    if (forum !== null) {
      updateConfig.forum_channel_id = forum.id;
    }
    if (channel !== null) {
      updateConfig.notification_channel_id = channel.id;
    }
    if (cooldown !== null) {
      updateConfig.notify_cooldown_seconds = cooldown;
    }
    if (maxPerHour !== null) {
      updateConfig.notify_max_per_hour = maxPerHour;
    }

    // Validation: channel mode requires a destination channel. Check both the
    // new value and the existing config to handle partial updates correctly.
    if (mode === "channel" && !channel && !oldConfig.notification_channel_id) {
      await interaction.editReply({
        content: "❌ When using mode=channel, you must specify a notification channel.",
      });
      return;
    }

    // Require at least one option - prevents accidental no-op commands
    if (Object.keys(updateConfig).length === 0) {
      await interaction.editReply({
        content: "❌ Please provide at least one configuration option to update.",
      });
      return;
    }

    // Update config
    setNotifyConfig(guildId, updateConfig);
    const newConfig = getNotifyConfig(guildId);

    // Build summary
    const summary = [
      "✅ **Forum post notification config updated:**",
      `• Mode: **${newConfig.notify_mode}**`,
      `• Role: ${newConfig.notify_role_id ? `<@&${newConfig.notify_role_id}>` : "*not set*"}`,
      `• Forum: ${newConfig.forum_channel_id ? `<#${newConfig.forum_channel_id}>` : "*all forums*"}`,
      `• Channel: ${newConfig.notification_channel_id ? `<#${newConfig.notification_channel_id}>` : "*not set*"}`,
      `• Cooldown: **${newConfig.notify_cooldown_seconds}s**`,
      `• Max per hour: **${newConfig.notify_max_per_hour}**`,
    ].join("\n");

    await interaction.editReply({ content: summary });

    // Log action
    if (interaction.guild) {
      await logActionPretty(interaction.guild, {
        actorId: userId,
        action: "forum_post_ping",
        reason: "Updated forum post notification configuration",
        meta: {
          old_config: oldConfig,
          new_config: newConfig,
          updated_fields: Object.keys(updateConfig),
        },
      });
    }

    // Insert action_log entry
    // Schema: guild_id, app_id, app_code, actor_id, subject_id, action, reason, meta_json, created_at_s
    db.prepare(
      `
      INSERT INTO action_log (guild_id, actor_id, action, reason, meta_json, created_at_s)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      guildId,
      userId,
      "forum_post_ping", // Using existing action type for config changes
      "Updated forum post notification configuration",
      JSON.stringify({
        old_config: oldConfig,
        new_config: newConfig,
        updated_fields: Object.keys(updateConfig),
      }),
      Math.floor(Date.now() / 1000)
    );

    logger.info(
      { guildId, userId, oldConfig, newConfig },
      "[setNotifyConfig] config updated by admin"
    );
  } catch (err) {
    logger.error({ err, guildId, userId }, "[setNotifyConfig] failed to update config");
    await interaction.editReply({
      content: "❌ Failed to update notification config. Check logs for details.",
    });
  }
}
