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
import { setNotifyConfig, getNotifyConfig } from "../../features/notifyConfig.js";
import { logActionPretty } from "../../logging/pretty.js";
import { logger } from "../../lib/logger.js";
import { isOwner } from "../../utils/owner.js";
import { hasStaffPermissions, getConfig } from "../../lib/config.js";
import { db } from "../../db/db.js";

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
  .addIntegerOption((option) =>
    option
      .setName("cooldown")
      .setDescription("Minimum seconds between notifications (default: 5)")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(300)
  )
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
  if (isOwner(userId)) {
    // Owner always allowed
  } else if (interaction.guild?.ownerId === userId) {
    // Guild owner allowed
  } else {
    const member = interaction.member;
    if (!member || typeof member.permissions === "string") {
      await interaction.reply({
        content: "❌ You must be a server administrator to use this command.",
        ephemeral: true,
      });
      return;
    }

    const hasPerms = hasStaffPermissions(member as any, guildId);
    const config = getConfig(guildId);
    const hasLeadershipRole = config?.leadership_role_id && (member as any).roles.cache.has(config.leadership_role_id);

    if (!hasPerms && !hasLeadershipRole) {
      await interaction.reply({
        content: "❌ You must be a server administrator to use this command.",
        ephemeral: true,
      });
      return;
    }
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

    // Build update config
    const updateConfig: any = {};

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

    // Validation
    if (mode === "channel" && !channel && !oldConfig.notification_channel_id) {
      await interaction.editReply({
        content: "❌ When using mode=channel, you must specify a notification channel.",
      });
      return;
    }

    // Check if at least one option provided
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
    db.prepare(
      `
      INSERT INTO action_log (guild_id, actor_id, action, target_type, target_id, reason, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      guildId,
      userId,
      "set_notify_config",
      "guild_config",
      guildId,
      "Updated forum post notification configuration",
      JSON.stringify({
        old_config: oldConfig,
        new_config: newConfig,
        updated_fields: Object.keys(updateConfig),
      })
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
