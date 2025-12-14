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
  type GuildMember,
} from "discord.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";
import { setMetricsEpoch } from "../features/metricsEpoch.js";
import { __test__clearModMetricsCache as clearModMetricsCache } from "../features/modPerformance.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { logActionPretty } from "../logging/pretty.js";
import { secureCompare } from "../lib/secureCompare.js";
import { checkCooldown, formatCooldown, COOLDOWNS } from "../lib/rateLimiter.js";

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

  // Brute force protection: check if user is on cooldown from previous failed attempt
  const passwordCooldownKey = `resetdata:${guildId}:${interaction.user.id}`;
  const cooldownResult = checkCooldown("password_fail", passwordCooldownKey, COOLDOWNS.PASSWORD_FAIL_MS);
  if (!cooldownResult.allowed) {
    await interaction.editReply({
      content: `❌ Too many failed attempts. Try again in ${formatCooldown(cooldownResult.remainingMs!)}.`,
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

  if (!secureCompare(password, correctPassword)) {
    // Cooldown already triggered by checkCooldown above (brute force protection)
    logger.warn({ userId: interaction.user.id, guildId }, "[resetdata] incorrect password attempt");

    await interaction.editReply({
      content: "❌ Incorrect password. Reset denied.",
    });
    return;
  }

  // Two-layer auth: Discord's setDefaultMemberPermissions handles UI visibility,
  // but we double-check at runtime because permissions can change between
  // command registration and execution.
  const member = interaction.member as GuildMember | null;
  const adminRoleIds = (process.env.ADMIN_ROLE_ID || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  // The "permissions" can be a string in DMs or uncached scenarios - we need
  // the full Permissions object to call .has()
  const hasManageGuild =
    member && typeof member.permissions !== "string" && member.permissions.has(PermissionFlagsBits.ManageGuild);
  const hasAdminRole =
    member &&
    "cache" in member.roles &&
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

  // The epoch is the "start from here" timestamp for all metrics calculations.
  // Historical data is preserved in logs but metrics queries will filter by this date.
  const epoch = new Date();

  await withStep(ctx, "set_epoch", async () => {
    setMetricsEpoch(guildId, epoch);
  });

  // Clear in-memory cache - this forces fresh calculations on next request.
  // Without this, stale aggregated metrics would persist until TTL expires.
  await withStep(ctx, "clear_cache", async () => {
    clearModMetricsCache();
  });

  // Nuke any pre-computed metrics rows. This is technically optional since
  // queries respect the epoch, but it keeps the DB clean and avoids confusion
  // when debugging.
  await withStep(ctx, "clear_db_cache", async () => {
    db.prepare(`DELETE FROM mod_metrics WHERE guild_id = ?`).run(guildId);
  });

  // Log to audit trail. Using "modmail_close" as action type is a hack -
  // ideally we'd add "metrics_reset" to the ActionType enum, but this works
  // for now since the meta field clarifies what actually happened.
  await withStep(ctx, "log_action", async () => {
    if (!interaction.guild) return;

    await logActionPretty(interaction.guild, {
      actorId: interaction.user.id,
      action: "modmail_close",
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
