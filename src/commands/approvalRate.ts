/**
 * Pawtropolis Tech -- src/commands/approvalRate.ts
 * WHAT: Slash command definition for /approval-rate.
 * WHY: Provides staff with server-wide approval/rejection rate analytics.
 *
 * NOTE: This file only defines the command schema. The execute handler
 * is in src/features/analytics/approvalRateCommand.ts.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("approval-rate")
  .setDescription("View server-wide approval/rejection rate analytics")
  .addIntegerOption((option) =>
    option
      .setName("days")
      .setDescription("Number of days to analyze (default: 30)")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(365)
  );
