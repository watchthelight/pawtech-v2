/**
 * Pawtropolis Tech — src/commands/analytics.ts
 * WHAT: Slash command definitions for /analytics.
 * WHY: Provides staff with reviewer activity insights and CSV exports.
 *
 * NOTE: This file only defines the command schema. The actual execute() handlers
 * live elsewhere (likely in a feature module). This split keeps command registration
 * lightweight and allows the same schema to be reused for multiple guild deployments.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { SlashCommandBuilder } from "discord.js";

// Unix epoch seconds are used here instead of Discord's snowflake timestamps or ISO strings
// because they're easier for staff to generate (Date.now()/1000) and work well with
// database queries that store timestamps as integers.
export const analyticsData = new SlashCommandBuilder()
  .setName("analytics")
  .setDescription("View reviewer activity analytics")
  .addIntegerOption((option) =>
    option.setName("from").setDescription("Start timestamp (Unix epoch seconds)").setRequired(false)
  )
  .addIntegerOption((option) =>
    option.setName("to").setDescription("End timestamp (Unix epoch seconds)").setRequired(false)
  )
  // all-guilds is dangerous - it exposes cross-guild data. The handler MUST verify
  // the caller is a bot owner, not just a guild admin. Guild admins should only
  // see their own guild's data.
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

// CSV export is a separate command rather than a flag on /analytics because
// Discord's response model differs: embeds vs file attachments have different
// size limits and the UX is cleaner when users explicitly ask for a file.
// Also allows different rate limiting if needed.
export const analyticsExportData = new SlashCommandBuilder()
  .setName("analytics-export")
  .setDescription("Export reviewer activity as CSV")
  .addIntegerOption((option) =>
    option.setName("from").setDescription("Start timestamp (Unix epoch seconds)").setRequired(false)
  )
  .addIntegerOption((option) =>
    option.setName("to").setDescription("End timestamp (Unix epoch seconds)").setRequired(false)
  )
  // Same permission caveat as above - all-guilds MUST be owner-only in the handler.
  .addBooleanOption((option) =>
    option
      .setName("all-guilds")
      .setDescription("Include all guilds (owners only)")
      .setRequired(false)
  );
