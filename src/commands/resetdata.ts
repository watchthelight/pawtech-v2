/**
 * Pawtropolis Tech — src/commands/resetdata.ts
 * WHAT: Admin command to reset metrics from current timestamp forward.
 * WHY: Allows starting fresh metrics analysis without deleting historical logs.
 * FLOWS:
 *  - User provides RESET_PASSWORD → sets metrics epoch → clears cached metrics
 * DOCS:
 *  - SlashCommandBuilder: https://discord.js.org/#/docs/builders/main/class/SlashCommandBuilder
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";
import { setMetricsEpoch } from "../features/metricsEpoch.js";
import { __test__clearModMetricsCache as clearModMetricsCache } from "../features/modPerformance.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { logActionPretty } from "../logging/pretty.js";
import crypto from "node:crypto";

export const data = new SlashCommandBuilder()
  .setName("resetdata")
  .setDescription("Reset metrics data from now forward (requires password)")
  .addStringOption((option) =>
    option
      .setName("password")
      .setDescription("Reset password (same as gate reset)")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

/**
 * WHAT: Constant-time string comparison to prevent timing attacks.
 * WHY: Password validation must not leak information via timing.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * execute
 * WHAT: Resets metrics epoch for the guild after password validation.
 * SECURITY:
 *  - Requires ManageGuild permission OR ADMIN_ROLE_ID
 *  - Validates password with constant-time comparison
 *  - Logs action to audit trail
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  // Defer reply (this might take a moment)
  await interaction.deferReply({ ephemeral: true });

  const password = interaction.options.getString("password", true);
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.editReply({
      content: "❌ This command can only be used in a guild.",
    });
    return;
  }

  // Validate password
  const correctPassword = process.env.RESET_PASSWORD;

  if (!correctPassword) {
    logger.error("[resetdata] RESET_PASSWORD not configured in environment");
    await interaction.editReply({
      content: "❌ Reset password not configured. Contact bot administrator.",
    });
    return;
  }

  if (!constantTimeCompare(password, correctPassword)) {
    logger.warn({ userId: interaction.user.id, guildId }, "[resetdata] incorrect password attempt");

    await interaction.editReply({
      content: "❌ Incorrect password. Reset denied.",
    });
    return;
  }

  // Check admin role if not using ManageGuild
  const member = interaction.member;
  const adminRoleIds = (process.env.ADMIN_ROLE_ID || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const hasManageGuild =
    member && "permissions" in member && member.permissions.has(PermissionFlagsBits.ManageGuild);
  const hasAdminRole =
    member &&
    "roles" in member &&
    adminRoleIds.length > 0 &&
    adminRoleIds.some((roleId) => member.roles.cache.has(roleId));

  if (!hasManageGuild && !hasAdminRole) {
    logger.warn(
      { userId: interaction.user.id, guildId },
      "[resetdata] unauthorized attempt (no permissions)"
    );

    await interaction.editReply({
      content: "❌ You don't have permission to reset metrics data.",
    });
    return;
  }

  // Set metrics epoch
  const epoch = new Date();

  await withStep(ctx, "set_epoch", async () => {
    setMetricsEpoch(guildId, epoch);
  });

  // Clear mod metrics cache
  await withStep(ctx, "clear_cache", async () => {
    clearModMetricsCache();
  });

  // Delete cached mod_metrics rows (optional, harmless)
  await withStep(ctx, "clear_db_cache", async () => {
    db.prepare(`DELETE FROM mod_metrics WHERE guild_id = ?`).run(guildId);
  });

  // Log action to audit trail
  await withStep(ctx, "log_action", async () => {
    if (!interaction.guild) return;

    await logActionPretty(interaction.guild, {
      actorId: interaction.user.id,
      action: "modmail_close", // Repurpose for audit (or add metrics_reset to ActionType)
      meta: { action_type: "metrics_reset", epoch: epoch.toISOString() },
    });
  });

  logger.info(
    { userId: interaction.user.id, guildId, epoch: epoch.toISOString() },
    "[resetdata] metrics reset successful"
  );

  // Success response
  const embed = new EmbedBuilder()
    .setTitle("✅ Metrics Data Reset")
    .setDescription(
      "All metrics and graphs have been reset. New data will be tracked from this moment forward."
    )
    .addFields({
      name: "New Epoch",
      value: `\`${epoch.toISOString()}\``,
      inline: false,
    })
    .setColor(0x57f287)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
