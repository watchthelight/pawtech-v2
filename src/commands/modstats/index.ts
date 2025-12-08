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
import { requireMinRole, ROLE_IDS } from "../../lib/config.js";

/*
 * GOTCHA: If you're wondering why this is split across 4 files for ~120 lines of routing,
 * the answer is "the handlers used to live here and this file was 800 lines of pain."
 * Now it's just a router. You're welcome.
 */
import { handleLeaderboard, handleExport } from "./leaderboard.js";
import { handleUser } from "./userStats.js";
import { handleReset, cleanupModstatsRateLimiter } from "./reset.js";

// Re-export cleanup function for graceful shutdown
export { cleanupModstatsRateLimiter };

export const data = new SlashCommandBuilder()
  .setName("modstats")
  .setDescription("View moderator analytics and leaderboards")
  /*
   * WHY null permissions: Discord's permission system can't know about our mod_roles config.
   * Setting this to null makes the command visible to everyone, then requireStaff() does
   * the real check. Yes, it means non-mods see the command. No, they can't use it.
   * It's annoying but it's how Discord works.
   */
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
  // The nuclear option. See reset.ts for the rate limiter that prevents abuse.
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

  const subcommand = interaction.options.getSubcommand();

  // Different permission levels for different subcommands:
  // - leaderboard/user: Gatekeeper+ (GK+)
  // - export/reset: Senior Administrator+ (SA+)
  if (subcommand === "leaderboard" || subcommand === "user") {
    if (!requireMinRole(interaction, ROLE_IDS.GATEKEEPER, {
      command: `modstats ${subcommand}`,
      description: `Views moderator ${subcommand === "leaderboard" ? "leaderboard" : "individual stats"}.`,
      requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.GATEKEEPER }],
    })) return;
  } else if (subcommand === "export" || subcommand === "reset") {
    if (!requireMinRole(interaction, ROLE_IDS.SENIOR_ADMIN, {
      command: `modstats ${subcommand}`,
      description: subcommand === "export" ? "Exports moderator metrics as CSV." : "Resets moderator statistics.",
      requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.SENIOR_ADMIN }],
    })) return;
  }

  /*
   * Yes, a switch statement would be cleaner. But if-else chains are easier to
   * step through in a debugger, and I debug this more than I'd like to admit.
   */
  if (subcommand === "leaderboard") {
    await handleLeaderboard(interaction);
  } else if (subcommand === "user") {
    await handleUser(interaction);
  } else if (subcommand === "export") {
    await handleExport(interaction);
  } else if (subcommand === "reset") {
    await handleReset(interaction);
  } else {
    /*
     * This should be unreachable since Discord validates subcommands, but TypeScript
     * doesn't know that. Also protects against future subcommands someone adds to the
     * builder but forgets to handle here. Ask me how I know.
     */
    await interaction.reply({
      content: "❌ Unknown subcommand.",
      ephemeral: true,
    });
  }
}
