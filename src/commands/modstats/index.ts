/**
 * Pawtropolis Tech -- src/commands/modstats/index.ts
 * WHAT: /modstats command for moderator analytics and leaderboards.
 * WHY: Provides transparency, gamification, and performance metrics for review team.
 * FLOWS:
 *  - /modstats leaderboard [days] → ranked list of moderators by decisions
 *  - /modstats user @moderator [days] → individual stats + server averages
 *  - /modstats export [days] → full CSV export
 *  - /modstats reset password → clear and rebuild statistics
 * DOCS:
 *  - Discord slash commands: https://discord.js.org/#/docs/discord.js/main/class/ChatInputCommandInteraction
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *
 * NOTE: This file was decomposed into smaller modules:
 * @see helpers.ts - Time formatting and database query utilities
 * @see leaderboard.ts - Leaderboard and export handlers
 * @see userStats.ts - Individual moderator statistics
 * @see reset.ts - Reset handler with rate limiting
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import type { CommandContext } from "../../lib/cmdWrap.js";
import { requireStaff } from "../../lib/config.js";

// Import handlers from decomposed modules
import { handleLeaderboard, handleExport } from "./leaderboard.js";
import { handleUser } from "./userStats.js";
import { handleReset, cleanupModstatsRateLimiter } from "./reset.js";

// Re-export cleanup function for graceful shutdown
export { cleanupModstatsRateLimiter };

export const data = new SlashCommandBuilder()
  .setName("modstats")
  .setDescription("View moderator analytics and leaderboards")
  // Visible to all, enforced via requireStaff() which checks mod_roles config
  .setDefaultMemberPermissions(null)
  .addSubcommand((sub) =>
    sub
      .setName("leaderboard")
      .setDescription("Show leaderboard of moderators by decisions")
      .addIntegerOption((opt) =>
        opt
          .setName("days")
          .setDescription("Number of days to analyze (default: 30)")
          .setMinValue(1)
          .setMaxValue(365)
          .setRequired(false)
      )
      .addBooleanOption((opt) =>
        opt.setName("export").setDescription("Export leaderboard as CSV file").setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("user")
      .setDescription("Show detailed stats for a specific moderator")
      .addUserOption((opt) =>
        opt.setName("moderator").setDescription("Moderator to analyze").setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt
          .setName("days")
          .setDescription("Number of days to analyze (default: 30)")
          .setMinValue(1)
          .setMaxValue(365)
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("export")
      .setDescription("Export all moderator metrics as CSV")
      .addIntegerOption((opt) =>
        opt
          .setName("days")
          .setDescription("Number of days to analyze (default: 30)")
          .setMinValue(1)
          .setMaxValue(365)
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("reset")
      .setDescription("Clear and rebuild moderator statistics (password required)")
      .addStringOption((opt) =>
        opt.setName("password").setDescription("Admin reset password").setRequired(true)
      )
  );

/**
 * WHAT: Main command executor for /modstats.
 * WHY: Routes to appropriate subcommand handler.
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;

  // Require staff permissions for all modstats subcommands
  if (!requireStaff(interaction)) return;

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "leaderboard") {
    await handleLeaderboard(interaction);
  } else if (subcommand === "user") {
    await handleUser(interaction);
  } else if (subcommand === "export") {
    await handleExport(interaction);
  } else if (subcommand === "reset") {
    await handleReset(interaction);
  } else {
    await interaction.reply({
      content: "❌ Unknown subcommand.",
      ephemeral: true,
    });
  }
}
