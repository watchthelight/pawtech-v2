/**
 * Pawtropolis Tech -- src/commands/config/data.ts
 * WHAT: SlashCommandBuilder definition for /config command.
 * WHY: Separates command definition from handler implementations.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Guild configuration management")
  // GROUP 1: "set" - Core settings (24 subcommands)
  .addSubcommandGroup((group) =>
    group
      .setName("set")
      .setDescription("Set core configuration values")
      // Role settings
      .addSubcommand((sc) =>
        sc
          .setName("mod_roles")
          .setDescription("Set moderator roles (users with these roles can run all commands)")
          .addRoleOption((o) => o.setName("role1").setDescription("First moderator role").setRequired(true))
          .addRoleOption((o) => o.setName("role2").setDescription("Second moderator role (optional)").setRequired(false))
          .addRoleOption((o) => o.setName("role3").setDescription("Third moderator role (optional)").setRequired(false))
          .addRoleOption((o) => o.setName("role4").setDescription("Fourth moderator role (optional)").setRequired(false))
          .addRoleOption((o) => o.setName("role5").setDescription("Fifth moderator role (optional)").setRequired(false))
      )
      .addSubcommand((sc) =>
        sc.setName("gatekeeper").setDescription("Set the gatekeeper role")
          .addRoleOption((o) => o.setName("role").setDescription("Gatekeeper role").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc.setName("reviewer_role").setDescription("Set the reviewer role for gate applications")
          .addRoleOption((o) => o.setName("role").setDescription("Reviewer role").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc.setName("leadership_role").setDescription("Set the leadership role")
          .addRoleOption((o) => o.setName("role").setDescription("Leadership role").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc.setName("bot_dev_role").setDescription("Set role to ping on new applications")
          .addRoleOption((o) => o.setName("role").setDescription("Bot Dev role").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc.setName("notify_role").setDescription("Set the role to ping for notifications")
          .addRoleOption((o) => o.setName("role").setDescription("Notification role").setRequired(true))
      )
      // Channel settings
      .addSubcommand((sc) =>
        sc.setName("modmail_log_channel").setDescription("Set the modmail log channel")
          .addChannelOption((o) => o.setName("channel").setDescription("Modmail log channel").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc.setName("logging").setDescription("Set the action logging channel")
          .addChannelOption((o) => o.setName("channel").setDescription("Logging channel").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc.setName("flags_channel").setDescription("Set the flags channel for Silent-Since-Join alerts")
          .addChannelOption((o) => o.setName("channel").setDescription("Flags channel").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc.setName("backfill_channel").setDescription("Set channel for backfill notifications")
          .addChannelOption((o) => o.setName("channel").setDescription("Notification channel").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc.setName("forum_channel").setDescription("Set the forum channel for notifications")
          .addChannelOption((o) => o.setName("channel").setDescription("Forum channel").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc.setName("notification_channel").setDescription("Set the notification channel")
          .addChannelOption((o) => o.setName("channel").setDescription("Notification channel").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc.setName("support_channel").setDescription("Set the support channel")
          .addChannelOption((o) => o.setName("channel").setDescription("Support channel").setRequired(true))
      )
      // Feature toggles
      .addSubcommand((sc) =>
        sc.setName("review_roles").setDescription("Set how roles are displayed in review cards")
          .addStringOption((o) => o.setName("mode").setDescription("Role display mode").setRequired(true)
            .addChoices({ name: "None (hide all)", value: "none" }, { name: "Level only", value: "level_only" }, { name: "All roles", value: "all" }))
      )
      .addSubcommand((sc) =>
        sc.setName("dadmode").setDescription("Toggle Dad Mode (playful I'm/Im responses)")
          .addStringOption((o) => o.setName("state").setDescription("Enable or disable").setRequired(true)
            .addChoices({ name: "On", value: "on" }, { name: "Off", value: "off" }))
          .addIntegerOption((o) => o.setName("chance").setDescription("Odds (1 in N, default: 1000)").setRequired(false).setMinValue(2).setMaxValue(100000))
      )
      .addSubcommand((sc) =>
        sc.setName("pingdevonapp").setDescription("Toggle Bot Dev role ping on new applications")
          .addBooleanOption((o) => o.setName("enabled").setDescription("Enable Bot Dev pings").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc.setName("banner_sync_toggle").setDescription("Enable or disable banner sync")
          .addBooleanOption((o) => o.setName("enabled").setDescription("Enable banner sync").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc.setName("avatar_scan_toggle").setDescription("Enable or disable avatar scanning")
          .addBooleanOption((o) => o.setName("enabled").setDescription("Enable avatar scan").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc.setName("listopen_output").setDescription("Set listopen command output visibility")
          .addStringOption((o) => o.setName("mode").setDescription("Output mode").setRequired(true)
            .addChoices({ name: "Public", value: "public" }, { name: "Ephemeral", value: "ephemeral" }))
      )
      .addSubcommand((sc) =>
        sc.setName("modmail_delete").setDescription("Delete modmail threads on close")
          .addBooleanOption((o) => o.setName("enabled").setDescription("Delete on close").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc.setName("notify_mode").setDescription("Set notification mode for forum posts")
          .addStringOption((o) => o.setName("mode").setDescription("Notification mode").setRequired(true)
            .addChoices({ name: "Post", value: "post" }, { name: "DM", value: "dm" }, { name: "Off", value: "off" }))
      )
      // Artist system
      .addSubcommand((sc) =>
        sc.setName("artist_rotation").setDescription("Configure artist rotation IDs")
          .addRoleOption((o) => o.setName("artist_role").setDescription("Server Artist role").setRequired(false))
          .addRoleOption((o) => o.setName("ambassador_role").setDescription("Community Ambassador role").setRequired(false))
          .addChannelOption((o) => o.setName("artist_channel").setDescription("Artist coordination channel").setRequired(false))
          .addRoleOption((o) => o.setName("headshot_ticket").setDescription("Headshot ticket role").setRequired(false))
          .addRoleOption((o) => o.setName("halfbody_ticket").setDescription("Half-body ticket role").setRequired(false))
          .addRoleOption((o) => o.setName("emoji_ticket").setDescription("Emoji ticket role").setRequired(false))
          .addRoleOption((o) => o.setName("fullbody_ticket").setDescription("Full-body ticket role").setRequired(false))
      )
      .addSubcommand((sc) =>
        sc.setName("artist_ignored_users").setDescription("Manage users excluded from artist queue")
          .addUserOption((o) => o.setName("add").setDescription("User to add to ignore list").setRequired(false))
          .addUserOption((o) => o.setName("remove").setDescription("User to remove from ignore list").setRequired(false))
      )
      .addSubcommand((sc) =>
        sc.setName("movie_threshold").setDescription("Set movie night qualification threshold")
          .addIntegerOption((o) => o.setName("minutes").setDescription("Minutes required (5-180)").setRequired(true).setMinValue(5).setMaxValue(180))
      )
  )
  // GROUP 2: "set-advanced" - Advanced/timing settings (13 subcommands)
  .addSubcommandGroup((group) =>
    group
      .setName("set-advanced")
      .setDescription("Set advanced configuration values")
      // Timing settings
      .addSubcommand((sc) =>
        sc.setName("flags_threshold").setDescription("Set silent days threshold for flagging (7-365)")
          .addIntegerOption((o) => o.setName("days").setDescription("Silent days threshold").setRequired(true).setMinValue(7).setMaxValue(365))
      )
      .addSubcommand((sc) =>
        sc.setName("reapply_cooldown").setDescription("Set hours before users can reapply")
          .addIntegerOption((o) => o.setName("hours").setDescription("Hours (1-720, default: 24)").setRequired(true).setMinValue(1).setMaxValue(720))
      )
      .addSubcommand((sc) =>
        sc.setName("min_account_age").setDescription("Set minimum account age to apply")
          .addIntegerOption((o) => o.setName("hours").setDescription("Hours (0-8760, default: 0)").setRequired(true).setMinValue(0).setMaxValue(8760))
      )
      .addSubcommand((sc) =>
        sc.setName("min_join_age").setDescription("Set minimum time in server before applying")
          .addIntegerOption((o) => o.setName("hours").setDescription("Hours (0-8760, default: 0)").setRequired(true).setMinValue(0).setMaxValue(8760))
      )
      .addSubcommand((sc) =>
        sc.setName("gate_answer_length").setDescription("Set max chars for gate answers")
          .addIntegerOption((o) => o.setName("length").setDescription("Max chars (100-4000)").setRequired(true).setMinValue(100).setMaxValue(4000))
      )
      .addSubcommand((sc) =>
        sc.setName("banner_sync_interval").setDescription("Set minutes between banner syncs")
          .addIntegerOption((o) => o.setName("minutes").setDescription("Minutes (1-60)").setRequired(true).setMinValue(1).setMaxValue(60))
      )
      .addSubcommand((sc) =>
        sc.setName("modmail_forward_size").setDescription("Set max size for modmail forward tracking")
          .addIntegerOption((o) => o.setName("size").setDescription("Max entries (1000-100000)").setRequired(true).setMinValue(1000).setMaxValue(100000))
      )
      // Rate limiting & resilience
      .addSubcommand((sc) =>
        sc.setName("retry_config").setDescription("Configure retry settings for API calls")
          .addIntegerOption((o) => o.setName("max_attempts").setDescription("Max attempts (1-10)").setRequired(false).setMinValue(1).setMaxValue(10))
          .addIntegerOption((o) => o.setName("initial_delay_ms").setDescription("Initial delay ms (50-1000)").setRequired(false).setMinValue(50).setMaxValue(1000))
          .addIntegerOption((o) => o.setName("max_delay_ms").setDescription("Max delay ms (1000-30000)").setRequired(false).setMinValue(1000).setMaxValue(30000))
      )
      .addSubcommand((sc) =>
        sc.setName("circuit_breaker").setDescription("Configure circuit breaker for API resilience")
          .addIntegerOption((o) => o.setName("threshold").setDescription("Failures before open (1-20)").setRequired(false).setMinValue(1).setMaxValue(20))
          .addIntegerOption((o) => o.setName("reset_ms").setDescription("Reset time ms (10000-300000)").setRequired(false).setMinValue(10000).setMaxValue(300000))
      )
      .addSubcommand((sc) =>
        sc.setName("flag_rate_limit").setDescription("Configure flag command rate limiting")
          .addIntegerOption((o) => o.setName("cooldown_ms").setDescription("Cooldown ms (500-10000)").setRequired(false).setMinValue(500).setMaxValue(10000))
          .addIntegerOption((o) => o.setName("ttl_ms").setDescription("Cache TTL ms (60000-7200000)").setRequired(false).setMinValue(60000).setMaxValue(7200000))
      )
      .addSubcommand((sc) =>
        sc.setName("notify_config").setDescription("Configure forum notification settings")
          .addIntegerOption((o) => o.setName("cooldown_seconds").setDescription("Cooldown (1-60)").setRequired(false).setMinValue(1).setMaxValue(60))
          .addIntegerOption((o) => o.setName("max_per_hour").setDescription("Max per hour (1-100)").setRequired(false).setMinValue(1).setMaxValue(100))
      )
      // Avatar scan thresholds
      .addSubcommand((sc) =>
        sc.setName("avatar_thresholds").setDescription("Configure avatar scan NSFW thresholds")
          .addNumberOption((o) => o.setName("hard").setDescription("Hard threshold (0.5-1.0)").setRequired(false).setMinValue(0.5).setMaxValue(1.0))
          .addNumberOption((o) => o.setName("soft").setDescription("Soft threshold (0.3-0.9)").setRequired(false).setMinValue(0.3).setMaxValue(0.9))
          .addNumberOption((o) => o.setName("racy").setDescription("Racy threshold (0.5-1.0)").setRequired(false).setMinValue(0.5).setMaxValue(1.0))
      )
      .addSubcommand((sc) =>
        sc.setName("avatar_scan_advanced").setDescription("Configure advanced avatar scan thresholds")
          .addNumberOption((o) => o.setName("nsfw_threshold").setDescription("NSFW threshold (0.1-1.0)").setRequired(false).setMinValue(0.1).setMaxValue(1.0))
          .addNumberOption((o) => o.setName("skin_edge_threshold").setDescription("Skin edge (0.05-0.5)").setRequired(false).setMinValue(0.05).setMaxValue(0.5))
          .addNumberOption((o) => o.setName("weight_model").setDescription("Model weight (0-1)").setRequired(false).setMinValue(0.0).setMaxValue(1.0))
          .addNumberOption((o) => o.setName("weight_edge").setDescription("Edge weight (0-1)").setRequired(false).setMinValue(0.0).setMaxValue(1.0))
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("get")
      .setDescription("Get specific configuration values")
      .addSubcommand((sc) =>
        sc
          .setName("logging")
          .setDescription("View the current action logging channel configuration")
      )
      .addSubcommand((sc) =>
        sc
          .setName("flags")
          .setDescription("View the current flags configuration (channel + threshold)")
      )
      .addSubcommand((sc) =>
        sc
          .setName("movie_config")
          .setDescription("View current movie night configuration")
      )
      .addSubcommand((sc) =>
        sc
          .setName("artist_rotation")
          .setDescription("View current artist rotation configuration")
      )
  )
  .addSubcommand((sc) => sc.setName("view").setDescription("View current guild configuration"))
  .addSubcommandGroup((group) =>
    group
      .setName("poke")
      .setDescription("Configure /poke command categories and excluded channels")
      .addSubcommand((sc) =>
        sc
          .setName("add-category")
          .setDescription("Add a category to poke targets")
          .addChannelOption((o) =>
            o.setName("category").setDescription("Category channel to add").setRequired(true)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("remove-category")
          .setDescription("Remove a category from poke targets")
          .addChannelOption((o) =>
            o.setName("category").setDescription("Category channel to remove").setRequired(true)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("exclude-channel")
          .setDescription("Exclude a channel from poke messages")
          .addChannelOption((o) =>
            o.setName("channel").setDescription("Channel to exclude").setRequired(true)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("include-channel")
          .setDescription("Remove a channel from the exclusion list")
          .addChannelOption((o) =>
            o.setName("channel").setDescription("Channel to include").setRequired(true)
          )
      )
      .addSubcommand((sc) =>
        sc.setName("list").setDescription("List current poke configuration")
      )
  );
