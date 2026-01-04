/**
 * Pawtropolis Tech — src/commands/event/data.ts
 * WHAT: SlashCommandBuilder for unified event attendance commands
 * WHY: Provides /event movie and /event game subcommand groups
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { SlashCommandBuilder, ChannelType } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("event")
  .setDescription("Event attendance tracking commands")

  // ========================================
  // MOVIE NIGHT SUBCOMMAND GROUP
  // ========================================
  .addSubcommandGroup((group) =>
    group
      .setName("movie")
      .setDescription("Movie night attendance tracking")
      .addSubcommand((sub) =>
        sub
          .setName("start")
          .setDescription("Start tracking movie night attendance")
          .addChannelOption((opt) =>
            opt
              .setName("channel")
              .setDescription("Voice channel to track")
              .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("end")
          .setDescription("End movie night and finalize attendance")
      )
      .addSubcommand((sub) =>
        sub
          .setName("attendance")
          .setDescription("View attendance stats for a user or the whole event")
          .addUserOption((opt) =>
            opt
              .setName("user")
              .setDescription("User to check (leave empty to see all attendees)")
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Manually add minutes to a user's current event attendance")
          .addUserOption((opt) =>
            opt
              .setName("user")
              .setDescription("User to add minutes for")
              .setRequired(true)
          )
          .addIntegerOption((opt) =>
            opt
              .setName("minutes")
              .setDescription("Number of minutes to add (1-300)")
              .setMinValue(1)
              .setMaxValue(300)
              .setRequired(true)
          )
          .addStringOption((opt) =>
            opt
              .setName("reason")
              .setDescription("Reason for the adjustment")
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("credit")
          .setDescription("Credit attendance minutes to any event date")
          .addUserOption((opt) =>
            opt
              .setName("user")
              .setDescription("User to credit")
              .setRequired(true)
          )
          .addStringOption((opt) =>
            opt
              .setName("date")
              .setDescription("Event date (YYYY-MM-DD)")
              .setRequired(true)
          )
          .addIntegerOption((opt) =>
            opt
              .setName("minutes")
              .setDescription("Number of minutes to credit (1-300)")
              .setMinValue(1)
              .setMaxValue(300)
              .setRequired(true)
          )
          .addStringOption((opt) =>
            opt
              .setName("reason")
              .setDescription("Reason for the credit")
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("bump")
          .setDescription("Give a user full credit for a movie (compensation)")
          .addUserOption((opt) =>
            opt
              .setName("user")
              .setDescription("User to bump")
              .setRequired(true)
          )
          .addStringOption((opt) =>
            opt
              .setName("date")
              .setDescription("Event date (YYYY-MM-DD, defaults to today)")
              .setRequired(false)
          )
          .addStringOption((opt) =>
            opt
              .setName("reason")
              .setDescription("Reason for the bump")
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("resume")
          .setDescription("Check status of recovered movie session after bot restart")
      )
  )

  // ========================================
  // GAME NIGHT SUBCOMMAND GROUP
  // ========================================
  .addSubcommandGroup((group) =>
    group
      .setName("game")
      .setDescription("Game night attendance tracking")
      .addSubcommand((sub) =>
        sub
          .setName("start")
          .setDescription("Start tracking game night attendance")
          .addChannelOption((opt) =>
            opt
              .setName("channel")
              .setDescription("Voice channel to track")
              .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("end")
          .setDescription("End game night and finalize attendance")
      )
      .addSubcommand((sub) =>
        sub
          .setName("attendance")
          .setDescription("View attendance stats for a user or the whole event")
          .addUserOption((opt) =>
            opt
              .setName("user")
              .setDescription("User to check (leave empty to see all attendees)")
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Manually add minutes to a user's current event attendance")
          .addUserOption((opt) =>
            opt
              .setName("user")
              .setDescription("User to add minutes for")
              .setRequired(true)
          )
          .addIntegerOption((opt) =>
            opt
              .setName("minutes")
              .setDescription("Number of minutes to add (1-300)")
              .setMinValue(1)
              .setMaxValue(300)
              .setRequired(true)
          )
          .addStringOption((opt) =>
            opt
              .setName("reason")
              .setDescription("Reason for the adjustment")
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("credit")
          .setDescription("Credit attendance minutes to any event date")
          .addUserOption((opt) =>
            opt
              .setName("user")
              .setDescription("User to credit")
              .setRequired(true)
          )
          .addStringOption((opt) =>
            opt
              .setName("date")
              .setDescription("Event date (YYYY-MM-DD)")
              .setRequired(true)
          )
          .addIntegerOption((opt) =>
            opt
              .setName("minutes")
              .setDescription("Number of minutes to credit (1-300)")
              .setMinValue(1)
              .setMaxValue(300)
              .setRequired(true)
          )
          .addStringOption((opt) =>
            opt
              .setName("reason")
              .setDescription("Reason for the credit")
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("bump")
          .setDescription("Give a user full credit for a game night (compensation)")
          .addUserOption((opt) =>
            opt
              .setName("user")
              .setDescription("User to bump")
              .setRequired(true)
          )
          .addStringOption((opt) =>
            opt
              .setName("date")
              .setDescription("Event date (YYYY-MM-DD, defaults to today)")
              .setRequired(false)
          )
          .addStringOption((opt) =>
            opt
              .setName("reason")
              .setDescription("Reason for the bump")
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("resume")
          .setDescription("Check status of recovered game session after bot restart")
      )
  );
