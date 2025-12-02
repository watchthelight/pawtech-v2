/**
 * Pawtropolis Tech — src/commands/review/getNotifyConfig.ts
 * WHAT: Admin command to view current forum post notification settings
 * WHY: Allow admins to inspect configuration without database access
 * SECURITY: Requires guild admin or reviewer role
 * FLOWS:
 *  - Read config via getNotifyConfig()
 *  - Format as embed
 *  - Log action to action_log
 * DOCS:
 *  - discord.js EmbedBuilder: https://discord.js.org/#/docs/builders/main/class/EmbedBuilder
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import type { CommandContext } from "../../lib/cmdWrap.js";
import { getNotifyConfig } from "../../features/notifyConfig.js";
import { logActionPretty } from "../../logging/pretty.js";
import { logger } from "../../lib/logger.js";
import { requireAdminOrLeadership } from "../../lib/config.js";
import { db } from "../../db/db.js";

export const data = new SlashCommandBuilder()
  .setName("review-get-notify-config")
  .setDescription("View current forum post notification settings (admin only)")
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
    const config = getNotifyConfig(guildId);

    // Build embed
    const embed = new EmbedBuilder()
      .setTitle("📬 Forum Post Notification Configuration")
      .setColor(0x5865f2)
      .addFields(
        {
          name: "Mode",
          value: config.notify_mode === "post" ? "🔗 In-thread (post)" : "📢 Separate channel",
          inline: true,
        },
        {
          name: "Status",
          value: config.notify_role_id ? "✅ Enabled" : "⚠️ Not configured",
          inline: true,
        },
        {
          name: "Role",
          value: config.notify_role_id ? `<@&${config.notify_role_id}>` : "*Not set*",
          inline: true,
        },
        {
          name: "Forum Channel",
          value: config.forum_channel_id ? `<#${config.forum_channel_id}>` : "*All forums*",
          inline: true,
        },
        {
          name: "Notification Channel",
          value: config.notification_channel_id
            ? `<#${config.notification_channel_id}>`
            : "*Not set (uses thread)*",
          inline: true,
        },
        {
          name: "Rate Limits",
          value: `Cooldown: **${config.notify_cooldown_seconds}s**\nMax/hour: **${config.notify_max_per_hour}**`,
          inline: true,
        }
      )
      .setFooter({ text: "Use /review-set-notify-config to update settings" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Dual logging: pretty log to Discord audit channel + structured log to DB.
    // This is intentional redundancy - Discord channel can be cleared, DB persists.
    if (interaction.guild) {
      await logActionPretty(interaction.guild, {
        actorId: userId,
        action: "forum_post_ping", // Reusing existing action type, not ideal but works
        reason: "Viewed forum post notification configuration",
        meta: { config },
      });
    }

    // Direct DB insert for the action_log table. This gives us queryable
    // audit history independent of the Discord audit channel.
    // Schema: guild_id, app_id, app_code, actor_id, subject_id, action, reason, meta_json, created_at_s
    db.prepare(
      `
      INSERT INTO action_log (guild_id, actor_id, action, reason, meta_json, created_at_s)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      guildId,
      userId,
      "forum_post_ping", // Using existing action type for config views
      "Viewed forum post notification configuration",
      JSON.stringify({ config }),
      Math.floor(Date.now() / 1000)
    );

    logger.info({ guildId, userId, config }, "[getNotifyConfig] config viewed by admin");
  } catch (err) {
    logger.error({ err, guildId, userId }, "[getNotifyConfig] failed to get config");
    await interaction.editReply({
      content: "❌ Failed to retrieve notification config. Check logs for details.",
    });
  }
}
