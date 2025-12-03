/**
 * Pawtropolis Tech — src/commands/analytics.ts
 * WHAT: Slash command definitions for /analytics.
 * WHY: Provides staff with reviewer activity insights and CSV exports.
 *
 * NOTE: This file only defines the command schema. The actual execute() handlers
 * live elsewhere (likely in a feature module). This split keeps command registration
 * lightweight and allows the same schema to be reused for multiple guild deployments.
 *
 * GOTCHA: No execute() function here means this file is useless on its own.
 * If you're wondering why /analytics doesn't work, check that whatever imports
 * these exports actually wires up the handlers. Yes, someone made that mistake.
 * Yes, it was embarrassing.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { SlashCommandBuilder } from "discord.js";

// Unix epoch seconds are used here instead of Discord's snowflake timestamps or ISO strings
// because they're easier for staff to generate (Date.now()/1000) and work well with
// database queries that store timestamps as integers.
//
// Fun fact: staff will absolutely still paste milliseconds here and wonder why they're
// querying data from the year 55000. The handler should probably sanity-check these.
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
  //
  // Discord doesn't have a way to hide options based on permissions, so any random
  // admin can see this option exists. They just shouldn't be able to use it.
  // If the handler doesn't check this properly, congrats, you've built a data leak.
  .addBooleanOption((option) =>
    option
      .setName("all-guilds")
      .setDescription("Include all guilds (owners only)")
      .setRequired(false)
  )
  // "Month" was deliberately omitted as a bucket option. Months have variable lengths
  // (28-31 days) which makes comparison charts misleading. February would look like
  // a slacker next to March. Staff complained. Staff can cope.
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
//
// Why CSV and not Excel? Because Excel files require a library that adds 15MB
// to the bundle, and frankly if you can't open a CSV you shouldn't be doing
// data analysis anyway.
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
  // Yes, this is duplicated from the other command. No, we can't share options
  // between SlashCommandBuilders without getting into factory function territory.
  // Sometimes copy-paste is the honest answer.
  .addBooleanOption((option) =>
    option
      .setName("all-guilds")
      .setDescription("Include all guilds (owners only)")
      .setRequired(false)
  );
