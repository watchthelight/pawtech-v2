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
import { isPanicMode, setPanicMode } from "../features/panicStore.js";
import { logger } from "../lib/logger.js";
import { logActionPretty } from "../logging/pretty.js";
import { requireStaff } from "../lib/config.js";

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
      setPanicMode(guildId, true);
      logger.warn({
        evt: "panic_command",
        guildId,
        userId: interaction.user.id,
        action: "on",
      }, `Panic mode enabled by ${interaction.user.tag}`);

      // Log to Discord channel
      await logActionPretty(interaction.guild, {
        actorId: interaction.user.id,
        action: "panic_enabled",
        reason: "Manual activation via /panic on",
      }).catch(() => {});

      await interaction.reply({
        content: "🚨 **PANIC MODE ENABLED**\n\nAll automatic role grants are now **stopped**.\nUse `/panic off` to resume normal operation.",
        ephemeral: false,
      });
      break;
    }

    case "off": {
      setPanicMode(guildId, false);
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
      }).catch(() => {});

      await interaction.reply({
        content: "✅ **Panic mode disabled**\n\nRole automation has resumed normal operation.",
        ephemeral: false,
      });
      break;
    }

    case "status": {
      const active = isPanicMode(guildId);
      await interaction.reply({
        content: active
          ? "🚨 **Panic mode is ACTIVE** - Role automation is stopped.\nUse `/panic off` to resume."
          : "✅ **Panic mode is OFF** - Role automation is running normally.",
        ephemeral: true,
      });
      break;
    }
  }
}
