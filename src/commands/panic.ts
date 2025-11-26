// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/commands/panic.ts
 * WHAT: Emergency shutoff for role automation system
 * WHY: Safety valve during testing - instantly stops all automatic role grants
 * FLOWS:
 *  - /panic → enable panic mode (stop role automation)
 *  - /panic off → disable panic mode (resume normal operation)
 *  - /panic status → check current state
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { setPanicMode, getPanicDetails } from "../features/panicStore.js";
import { logger } from "../lib/logger.js";
import { logActionPretty } from "../logging/pretty.js";
import { requireStaff } from "../lib/config.js";

/*
 * Panic Mode: Emergency Kill Switch
 * ----------------------------------
 * When something goes wrong with role automation (assigning wrong roles, hitting
 * rate limits, bot acting weird), staff can instantly stop all automatic role
 * changes with /panic on.
 *
 * WHAT IT AFFECTS:
 *   - Acceptance role grants (when applications are approved)
 *   - Movie tier role updates
 *   - Any other automatic role assignment in the codebase
 *
 * WHAT IT DOES NOT AFFECT:
 *   - Manual role changes by staff
 *   - Application approval/rejection (the app is marked approved, just no role)
 *   - Other bot functionality (commands, logging, etc.)
 *
 * HOW IT WORKS:
 * The panicStore maintains a per-guild boolean. Role-granting code checks
 * isPanicMode(guildId) before attempting any role changes. If true, it logs
 * a warning and skips the role operation.
 *
 * PERSISTENCE:
 * Panic state is stored in SQLite, so it survives bot restarts. This is
 * intentional - if you panic because of a bug, you want it to stay panicked
 * until a human explicitly clears it.
 *
 * AUDIT TRAIL:
 * All panic mode changes are logged to both the logger and the Discord audit
 * channel (if configured). This ensures accountability for who activated it.
 */

export const data = new SlashCommandBuilder()
  .setName("panic")
  .setDescription("Emergency shutoff for role automation")
  .addSubcommand((sub) =>
    sub
      .setName("on")
      .setDescription("Enable panic mode - stops all automatic role grants")
  )
  .addSubcommand((sub) =>
    sub
      .setName("off")
      .setDescription("Disable panic mode - resume normal role automation")
  )
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Check if panic mode is active")
  );

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const interaction = ctx.interaction;

  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Check staff permissions
  if (!requireStaff(interaction)) return;

  const guildId = interaction.guild.id;
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "on": {
      setPanicMode(guildId, true, interaction.user.id);
      /*
       * Log level is WARN, not INFO, because enabling panic mode is an
       * exceptional situation that warrants attention in log monitoring.
       * If you're seeing this in prod, something probably went wrong.
       */
      logger.warn({
        evt: "panic_command",
        guildId,
        userId: interaction.user.id,
        action: "on",
      }, `Panic mode enabled by ${interaction.user.tag}`);

      // Log to Discord channel - non-fatal if it fails (still log warning)
      await logActionPretty(interaction.guild, {
        actorId: interaction.user.id,
        action: "panic_enabled",
        reason: "Manual activation via /panic on",
      }).catch((err) => {
        logger.warn({ err, guildId, action: "panic_enabled" },
          "[panic] Failed to log action - audit trail incomplete");
      });

      await interaction.reply({
        content: "🚨 **PANIC MODE ENABLED**\n\nAll automatic role grants are now **stopped**.\nUse `/panic off` to resume normal operation.",
        ephemeral: false,
      });
      break;
    }

    case "off": {
      setPanicMode(guildId, false, interaction.user.id);
      logger.info({
        evt: "panic_command",
        guildId,
        userId: interaction.user.id,
        action: "off",
      }, `Panic mode disabled by ${interaction.user.tag}`);

      // Log to Discord channel
      await logActionPretty(interaction.guild, {
        actorId: interaction.user.id,
        action: "panic_disabled",
        reason: "Manual deactivation via /panic off",
      }).catch((err) => {
        logger.warn({ err, guildId, action: "panic_disabled" },
          "[panic] Failed to log action - audit trail incomplete");
      });

      await interaction.reply({
        content: "✅ **Panic mode disabled**\n\nRole automation has resumed normal operation.",
        ephemeral: false,
      });
      break;
    }

    case "status": {
      /*
       * Status is ephemeral because it's informational only - no need to
       * broadcast to the channel. Staff can share the info if needed.
       *
       * The <t:...:F> format is Discord's timestamp formatting - renders as
       * a full date/time in the user's local timezone.
       */
      const details = getPanicDetails(guildId);
      if (details?.enabled) {
        let statusMsg = "🚨 **Panic mode is ACTIVE** - Role automation is stopped.";
        if (details.enabledBy) {
          statusMsg += `\nEnabled by: <@${details.enabledBy}>`;
        }
        if (details.enabledAt) {
          statusMsg += `\nEnabled at: <t:${Math.floor(details.enabledAt.getTime() / 1000)}:F>`;
        }
        statusMsg += "\n\nUse `/panic off` to resume.";
        await interaction.reply({
          content: statusMsg,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "✅ **Panic mode is OFF** - Role automation is running normally.",
          ephemeral: true,
        });
      }
      break;
    }
  }
}
