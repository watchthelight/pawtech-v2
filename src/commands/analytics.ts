/**
 * Pawtropolis Tech — src/commands/analytics.ts
 * WHAT: Slash command definitions for /analytics.
 * WHY: Provides staff with reviewer activity insights and CSV exports.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { SlashCommandBuilder } from "discord.js";

export const analyticsData = new SlashCommandBuilder()
  .setName("analytics")
  .setDescription("View reviewer activity analytics")
  .addIntegerOption((option) =>
    option.setName("from").setDescription("Start timestamp (Unix epoch seconds)").setRequired(false)
  )
  .addIntegerOption((option) =>
    option.setName("to").setDescription("End timestamp (Unix epoch seconds)").setRequired(false)
  )
  .addBooleanOption((option) =>
    option
      .setName("all-guilds")
      .setDescription("Include all guilds (owners only)")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("bucket")
      .setDescription("Time bucket for volume series")
      .setRequired(false)
      .addChoices({ name: "Day", value: "day" }, { name: "Week", value: "week" })
  );

export const analyticsExportData = new SlashCommandBuilder()
  .setName("analytics-export")
  .setDescription("Export reviewer activity as CSV")
  .addIntegerOption((option) =>
    option.setName("from").setDescription("Start timestamp (Unix epoch seconds)").setRequired(false)
  )
  .addIntegerOption((option) =>
    option.setName("to").setDescription("End timestamp (Unix epoch seconds)").setRequired(false)
  )
  .addBooleanOption((option) =>
    option
      .setName("all-guilds")
      .setDescription("Include all guilds (owners only)")
      .setRequired(false)
  );
