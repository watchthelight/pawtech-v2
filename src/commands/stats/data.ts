/**
 * Pawtropolis Tech -- src/commands/stats/data.ts
 * WHAT: SlashCommandBuilder for /stats command with all analytics subcommands.
 * WHY: Consolidates analytics commands under a unified /stats parent.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Analytics and performance metrics")
  .setDefaultMemberPermissions(null) // Visible to all, checked at runtime
  .setDMPermission(false)

  // /stats activity [weeks:1-8] - Server activity heatmap (SM+)
  .addSubcommand((sub) =>
    sub
      .setName("activity")
      .setDescription("View server activity heatmap with trends analysis")
      .addIntegerOption((opt) =>
        opt
          .setName("weeks")
          .setDescription("Number of weeks to show (1-8, default: 1)")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(8)
      )
  )

  // /stats approval-rate [days:1-365] - Approval/rejection analytics (Staff)
  .addSubcommand((sub) =>
    sub
      .setName("approval-rate")
      .setDescription("View server-wide approval/rejection rate analytics")
      .addIntegerOption((opt) =>
        opt
          .setName("days")
          .setDescription("Number of days to analyze (default: 30)")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(365)
      )
  )

  // /stats leaderboard [days] [export] - Moderator rankings (GK+)
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
        opt
          .setName("export")
          .setDescription("Export leaderboard as CSV file")
          .setRequired(false)
      )
  )

  // /stats user <moderator> [days] - Individual mod stats (GK+)
  .addSubcommand((sub) =>
    sub
      .setName("user")
      .setDescription("Show detailed stats for a specific moderator")
      .addUserOption((opt) =>
        opt
          .setName("moderator")
          .setDescription("Moderator to analyze")
          .setRequired(true)
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

  // /stats export [days] - Full CSV export (SA+)
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

  // /stats reset <password> - Clear and rebuild (SA+)
  .addSubcommand((sub) =>
    sub
      .setName("reset")
      .setDescription("Clear and rebuild moderator statistics (password required)")
      .addStringOption((opt) =>
        opt
          .setName("password")
          .setDescription("Admin reset password")
          .setRequired(true)
      )
  )

  // /stats history <moderator> [days] [export] - Mod action history (Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("history")
      .setDescription("View moderator action history (leadership only)")
      .addUserOption((opt) =>
        opt
          .setName("moderator")
          .setDescription("Moderator to inspect")
          .setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt
          .setName("days")
          .setDescription("Days of history to fetch (default: 30)")
          .setMinValue(1)
          .setMaxValue(365)
          .setRequired(false)
      )
      .addBooleanOption((opt) =>
        opt
          .setName("export")
          .setDescription("Export full history as CSV (default: false)")
          .setRequired(false)
      )
  );
