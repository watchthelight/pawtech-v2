/**
 * Pawtropolis Tech -- src/commands/stats/index.ts
 * WHAT: Main execute router for /stats command.
 * WHY: Consolidates analytics commands under unified /stats parent.
 * FLOWS:
 *  - /stats activity → Server activity heatmap (SM+)
 *  - /stats approval-rate → Approval/rejection analytics (Staff)
 *  - /stats leaderboard → Moderator rankings (GK+)
 *  - /stats user → Individual mod stats (GK+)
 *  - /stats export → Full CSV export (SA+)
 *  - /stats reset → Clear and rebuild stats (SA+)
 *  - /stats history → Mod action history (Leadership)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { ChatInputCommandInteraction } from "discord.js";
import type { CommandContext } from "../../lib/cmdWrap.js";

// Re-export command data
export { data } from "./data.js";

// Import handlers
import { handleActivity } from "./activity.js";
import { handleApprovalRate } from "./approvalRate.js";
import { handleLeaderboard } from "./leaderboard.js";
import { handleUser } from "./user.js";
import { handleExport } from "./export.js";
import { handleReset, cleanupStatsRateLimiter } from "./reset.js";
import { handleHistory } from "./history.js";

// Re-export cleanup function for graceful shutdown
export { cleanupStatsRateLimiter };

/**
 * Main command executor for /stats.
 * Routes to appropriate subcommand handler.
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const subcommand = interaction.options.getSubcommand();

  // Permission checks are handled within each handler
  // to allow for different permission levels per subcommand

  switch (subcommand) {
    case "activity":
      await handleActivity(ctx);
      break;

    case "approval-rate":
      await handleApprovalRate(ctx);
      break;

    case "leaderboard":
      await handleLeaderboard(interaction);
      break;

    case "user":
      await handleUser(interaction);
      break;

    case "export":
      await handleExport(interaction);
      break;

    case "reset":
      await handleReset(interaction);
      break;

    case "history":
      await handleHistory(ctx);
      break;

    default:
      await interaction.reply({
        content: "Unknown subcommand.",
        ephemeral: true,
      });
  }
}
