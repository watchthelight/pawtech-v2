/**
 * Pawtropolis Tech — src/commands/config.ts
 * WHAT: Guild configuration commands (/config set) for mod roles, gatekeeper role, and modmail log channel.
 * WHY: Allows guild admins to configure who can run all commands via mod roles.
 * FLOWS:
 *  - /config set mod_roles → accepts 1..n roles → store as CSV
 *  - /config set gatekeeper → accepts 1 role → store id
 *  - /config set modmail_log_channel → accepts 1 channel → store id
 * DOCS:
 *  - Slash commands: https://discord.com/developers/docs/interactions/application-commands
 *  - Roles: https://discord.js.org/#/docs/discord.js/main/class/Role
 *  - Channels: https://discord.js.org/#/docs/discord.js/main/class/Channel
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { requireStaff, upsertConfig, getConfig } from "../lib/config.js";
import { type CommandContext, replyOrEdit, ensureDeferred } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import { db } from "../db/db.js";
import { retrofitModmailParentsForGuild } from "../features/modmail.js";
import { setLoggingChannelId, getLoggingChannelId } from "../config/loggingStore.js";
import {
  setFlagsChannelId,
  setSilentFirstMsgDays,
  getFlaggerConfig,
} from "../config/flaggerStore.js";

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Guild configuration management")
  .addSubcommandGroup((group) =>
    group
      .setName("set")
      .setDescription("Set configuration values")
      // Discord doesn't support variadic role options (arbitrary number of roles).
      // The workaround is role1-role5 slots. If you need more, add more options.
      // Roles are stored as a comma-separated string in the DB for flexibility.
      .addSubcommand((sc) =>
        sc
          .setName("mod_roles")
          .setDescription("Set moderator roles (users with these roles can run all commands)")
          .addRoleOption((o) =>
            o.setName("role1").setDescription("First moderator role").setRequired(true)
          )
          .addRoleOption((o) =>
            o.setName("role2").setDescription("Second moderator role (optional)").setRequired(false)
          )
          .addRoleOption((o) =>
            o.setName("role3").setDescription("Third moderator role (optional)").setRequired(false)
          )
          .addRoleOption((o) =>
            o.setName("role4").setDescription("Fourth moderator role (optional)").setRequired(false)
          )
          .addRoleOption((o) =>
            o.setName("role5").setDescription("Fifth moderator role (optional)").setRequired(false)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("gatekeeper")
          .setDescription("Set the gatekeeper role (for future use)")
          .addRoleOption((o) =>
            o.setName("role").setDescription("Gatekeeper role").setRequired(true)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("modmail_log_channel")
          .setDescription("Set the modmail log channel (for future use)")
          .addChannelOption((o) =>
            o.setName("channel").setDescription("Modmail log channel").setRequired(true)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("review_roles")
          .setDescription("Set how roles are displayed in review cards")
          .addStringOption((o) =>
            o
              .setName("mode")
              .setDescription("Role display mode")
              .setRequired(true)
              .addChoices(
                { name: "None (hide all roles)", value: "none" },
                { name: "Level only (show highest level role)", value: "level_only" },
                { name: "All roles", value: "all" }
              )
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("logging")
          .setDescription("Set the action logging channel for analytics and audit trail")
          .addChannelOption((o) =>
            o.setName("channel").setDescription("Logging channel").setRequired(true)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("flags_channel")
          .setDescription("Set the flags channel for Silent-Since-Join alerts (PR8)")
          .addChannelOption((o) =>
            o.setName("channel").setDescription("Flags channel").setRequired(true)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("flags_threshold")
          .setDescription("Set silent days threshold for flagging (7-365 days)")
          .addIntegerOption((o) =>
            o
              .setName("days")
              .setDescription("Silent days threshold (min: 7, max: 365)")
              .setRequired(true)
              .setMinValue(7)
              .setMaxValue(365)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("dadmode")
          .setDescription("Toggle Dad Mode (playful I'm/Im responses)")
          .addStringOption((o) =>
            o
              .setName("state")
              .setDescription("Enable or disable Dad Mode")
              .setRequired(true)
              .addChoices({ name: "On", value: "on" }, { name: "Off", value: "off" })
          )
          .addIntegerOption((o) =>
            o
              .setName("chance")
              .setDescription("Odds (1 in N). Default: 1000. Min: 2, Max: 100000")
              .setRequired(false)
              .setMinValue(2)
              .setMaxValue(100000)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("pingdevonapp")
          .setDescription("Toggle Bot Dev role ping on new applications")
          .addBooleanOption((o) =>
            o
              .setName("enabled")
              .setDescription("Enable or disable Bot Dev pings")
              .setRequired(true)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("movie_threshold")
          .setDescription("Set movie night qualification threshold in minutes")
          .addIntegerOption((o) =>
            o
              .setName("minutes")
              .setDescription("Minutes required to qualify (5-180)")
              .setRequired(true)
              .setMinValue(5)
              .setMaxValue(180)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("artist_rotation")
          .setDescription("Configure artist rotation IDs (role, channel, tickets)")
          .addRoleOption((o) =>
            o.setName("artist_role").setDescription("Server Artist role").setRequired(false)
          )
          .addRoleOption((o) =>
            o.setName("ambassador_role").setDescription("Community Ambassador role").setRequired(false)
          )
          .addChannelOption((o) =>
            o.setName("artist_channel").setDescription("Server artist coordination channel").setRequired(false)
          )
          .addRoleOption((o) =>
            o.setName("headshot_ticket").setDescription("Headshot ticket role").setRequired(false)
          )
          .addRoleOption((o) =>
            o.setName("halfbody_ticket").setDescription("Half-body ticket role").setRequired(false)
          )
          .addRoleOption((o) =>
            o.setName("emoji_ticket").setDescription("Emoji ticket role").setRequired(false)
          )
          .addRoleOption((o) =>
            o.setName("fullbody_ticket").setDescription("Full-body ticket role").setRequired(false)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("artist_ignored_users")
          .setDescription("Manage users excluded from artist queue")
          .addUserOption((o) =>
            o.setName("add").setDescription("User to add to ignore list").setRequired(false)
          )
          .addUserOption((o) =>
            o.setName("remove").setDescription("User to remove from ignore list").setRequired(false)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("backfill_channel")
          .setDescription("Set channel for backfill completion notifications")
          .addChannelOption((o) =>
            o.setName("channel").setDescription("Notification channel").setRequired(true)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("bot_dev_role")
          .setDescription("Set role to ping on new applications (with pingdevonapp enabled)")
          .addRoleOption((o) =>
            o.setName("role").setDescription("Bot Dev role to ping").setRequired(true)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("gate_answer_length")
          .setDescription("Set max characters for gate application answers")
          .addIntegerOption((o) =>
            o
              .setName("length")
              .setDescription("Max characters (100-4000, default: 1000)")
              .setRequired(true)
              .setMinValue(100)
              .setMaxValue(4000)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("banner_sync_interval")
          .setDescription("Set minutes between banner sync updates")
          .addIntegerOption((o) =>
            o
              .setName("minutes")
              .setDescription("Minutes between syncs (1-60, default: 10)")
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(60)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("modmail_forward_size")
          .setDescription("Set max size for modmail forward tracking")
          .addIntegerOption((o) =>
            o
              .setName("size")
              .setDescription("Max entries (1000-100000, default: 10000)")
              .setRequired(true)
              .setMinValue(1000)
              .setMaxValue(100000)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("retry_config")
          .setDescription("Configure retry settings for API calls")
          .addIntegerOption((o) =>
            o
              .setName("max_attempts")
              .setDescription("Max retry attempts (1-10, default: 3)")
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(10)
          )
          .addIntegerOption((o) =>
            o
              .setName("initial_delay_ms")
              .setDescription("Initial delay in ms (50-1000, default: 100)")
              .setRequired(false)
              .setMinValue(50)
              .setMaxValue(1000)
          )
          .addIntegerOption((o) =>
            o
              .setName("max_delay_ms")
              .setDescription("Max delay in ms (1000-30000, default: 5000)")
              .setRequired(false)
              .setMinValue(1000)
              .setMaxValue(30000)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("circuit_breaker")
          .setDescription("Configure circuit breaker for API resilience")
          .addIntegerOption((o) =>
            o
              .setName("threshold")
              .setDescription("Failures before opening (1-20, default: 5)")
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(20)
          )
          .addIntegerOption((o) =>
            o
              .setName("reset_ms")
              .setDescription("Time before retry in ms (10000-300000, default: 60000)")
              .setRequired(false)
              .setMinValue(10000)
              .setMaxValue(300000)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("avatar_thresholds")
          .setDescription("Configure avatar scan NSFW thresholds")
          .addNumberOption((o) =>
            o
              .setName("hard")
              .setDescription("Hard evidence threshold (0.5-1.0, default: 0.8)")
              .setRequired(false)
              .setMinValue(0.5)
              .setMaxValue(1.0)
          )
          .addNumberOption((o) =>
            o
              .setName("soft")
              .setDescription("Soft evidence threshold (0.3-0.9, default: 0.5)")
              .setRequired(false)
              .setMinValue(0.3)
              .setMaxValue(0.9)
          )
          .addNumberOption((o) =>
            o
              .setName("racy")
              .setDescription("Racy content threshold (0.5-1.0, default: 0.8)")
              .setRequired(false)
              .setMinValue(0.5)
              .setMaxValue(1.0)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("flag_rate_limit")
          .setDescription("Configure flag command rate limiting")
          .addIntegerOption((o) =>
            o
              .setName("cooldown_ms")
              .setDescription("Cooldown between flags in ms (500-10000, default: 2000)")
              .setRequired(false)
              .setMinValue(500)
              .setMaxValue(10000)
          )
          .addIntegerOption((o) =>
            o
              .setName("ttl_ms")
              .setDescription("Cache TTL in ms (60000-7200000, default: 3600000)")
              .setRequired(false)
              .setMinValue(60000)
              .setMaxValue(7200000)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("notify_config")
          .setDescription("Configure forum post notification settings")
          .addIntegerOption((o) =>
            o
              .setName("cooldown_seconds")
              .setDescription("Cooldown between notifications (1-60, default: 5)")
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(60)
          )
          .addIntegerOption((o) =>
            o
              .setName("max_per_hour")
              .setDescription("Max notifications per hour (1-100, default: 10)")
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(100)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("banner_sync_toggle")
          .setDescription("Enable or disable banner sync feature")
          .addBooleanOption((o) =>
            o
              .setName("enabled")
              .setDescription("Enable banner sync (default: true)")
              .setRequired(true)
          )
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

async function executeSetModRoles(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetModRoles
   * WHAT: Sets moderator roles in guild config (stores as CSV).
   * WHY: Allows guild admins to specify which roles can run all commands.
   * PARAMS: ctx — command context; extracts role options from interaction.
   * RETURNS: Promise<void> after confirming update.
   * DOCS:
   *  - Role: https://discord.js.org/#/docs/discord.js/main/class/Role
   *  - CSV storage pattern for flexibility with multiple roles
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("gather_roles");
  const roles = [];
  for (let i = 1; i <= 5; i++) {
    const role = interaction.options.getRole(`role${i}`);
    if (role) {
      roles.push(role.id);
      logger.info(
        {
          evt: "config_set_mod_role",
          guildId: interaction.guildId,
          roleId: role.id,
          roleName: role.name,
        },
        "[config] adding mod role"
      );
    }
  }

  if (roles.length === 0) {
    await replyOrEdit(interaction, { content: "At least one role is required." });
    return;
  }

  ctx.step("persist_roles");
  const csv = roles.join(",");
  upsertConfig(interaction.guildId!, { mod_role_ids: csv });

  logger.info(
    { evt: "config_set_mod_roles", guildId: interaction.guildId, roleIds: roles, csv },
    "[config] mod roles updated"
  );

  // IMPORTANT SIDE EFFECT: When mod roles change, we need to update permissions on
  // channels that host modmail threads. Discord threads inherit *some* permissions
  // from their parent channel, but SendMessagesInThreads specifically must be granted
  // on the parent. If we skip this, newly-added mod roles can't reply to modmail.
  //
  // This is a best-effort operation - we don't fail the whole command if it errors.
  // The mod can manually fix permissions if needed.
  ctx.step("retrofit_modmail_perms");
  try {
    await retrofitModmailParentsForGuild(interaction.guild!);
    logger.info(
      { evt: "config_retrofit_modmail", guildId: interaction.guildId },
      "[config] retrofitted modmail parent permissions after mod roles update"
    );
  } catch (err) {
    logger.warn(
      { err, guildId: interaction.guildId },
      "[config] failed to retrofit modmail permissions"
    );
  }

  ctx.step("reply");
  const roleList = roles.map((id) => `<@&${id}>`).join(", ");
  await replyOrEdit(interaction, {
    content: `Moderator roles updated: ${roleList}\n\nUsers with any of these roles can now run all commands.`,
  });
}

async function executeSetGatekeeper(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetGatekeeper
   * WHAT: Sets the gatekeeper role in guild config.
   * WHY: Configures a role for future gatekeeper functionality.
   * PARAMS: ctx — command context; extracts role option from interaction.
   * RETURNS: Promise<void> after confirming update.
   * DOCS:
   *  - Role: https://discord.js.org/#/docs/discord.js/main/class/Role
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_role");
  const role = interaction.options.getRole("role", true);

  ctx.step("persist_role");
  upsertConfig(interaction.guildId!, { gatekeeper_role_id: role.id });

  logger.info(
    {
      evt: "config_set_gatekeeper",
      guildId: interaction.guildId,
      roleId: role.id,
      roleName: role.name,
    },
    "[config] gatekeeper role updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Gatekeeper role set to <@&${role.id}>`,
  });
}

async function executeSetModmailLogChannel(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetModmailLogChannel
   * WHAT: Sets the modmail log channel in guild config.
   * WHY: Configures where modmail logs will be posted (future use).
   * PARAMS: ctx — command context; extracts channel option from interaction.
   * RETURNS: Promise<void> after confirming update.
   * DOCS:
   *  - Channel: https://discord.js.org/#/docs/discord.js/main/class/Channel
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_channel");
  const channel = interaction.options.getChannel("channel", true);

  ctx.step("persist_channel");
  upsertConfig(interaction.guildId!, { modmail_log_channel_id: channel.id });

  logger.info(
    { evt: "config_set_modmail_log_channel", guildId: interaction.guildId, channelId: channel.id },
    "[config] modmail log channel updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Modmail log channel set to <#${channel.id}>`,
  });
}

async function executeSetReviewRoles(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Controls role display in review cards. Some servers have 50+ roles and the
   * card becomes unreadable. "level_only" is a compromise - shows just the
   * highest progression role (Level 1, Level 2, etc.) which is usually the
   * most relevant for review decisions.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_mode");
  const mode = interaction.options.getString("mode", true);

  // This validation is technically redundant since Discord's addChoices() already
  // constrains the input, but it guards against future refactors that might
  // accidentally remove the choices constraint.
  if (!["none", "level_only", "all"].includes(mode)) {
    await replyOrEdit(interaction, { content: "Invalid mode. Choose: none, level_only, or all." });
    return;
  }

  ctx.step("persist_mode");
  upsertConfig(interaction.guildId!, { review_roles_mode: mode });

  logger.info(
    { evt: "config_set_review_roles", guildId: interaction.guildId, mode },
    "[config] review roles mode updated"
  );

  ctx.step("reply");
  const modeDescription =
    mode === "none"
      ? "hidden"
      : mode === "level_only"
        ? "only showing highest level role"
        : "showing all roles";

  await replyOrEdit(interaction, {
    content: `Review card role display set to **${mode}** (${modeDescription}).`,
  });
}

async function executeSetLogging(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetLogging
   * WHAT: Sets the action logging channel for analytics and audit trail.
   * WHY: Configures where action log embeds will be posted (pretty logging).
   * PARAMS: ctx — command context; extracts channel option from interaction.
   * RETURNS: Promise<void> after confirming update.
   * DOCS:
   *  - Channel: https://discord.js.org/#/docs/discord.js/main/class/Channel
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_channel");
  const channel = interaction.options.getChannel("channel", true);

  ctx.step("persist_channel");
  setLoggingChannelId(interaction.guildId!, channel.id);

  logger.info(
    { evt: "config_set_logging", guildId: interaction.guildId, channelId: channel.id },
    "[config] logging channel updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `✅ Action logging channel set to <#${channel.id}>\n\nAll moderator actions will now be logged here with pretty embeds.`,
  });
}

async function executeGetLogging(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Shows current logging config with the full resolution chain. This is helpful
   * for debugging "why isn't logging working?" - the answer is usually that no
   * channel is configured and it's falling back to console JSON.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_logging_config");
  const loggingChannelId = getLoggingChannelId(interaction.guildId!);

  const lines = ["**Action Logging Configuration**", ""];

  if (loggingChannelId) {
    lines.push(`✅ **Logging Channel:** <#${loggingChannelId}>`);
    lines.push("");
    lines.push("All moderator actions (accept, reject, claim, modmail, etc.) are logged here.");
    lines.push("");
    lines.push("**Resolution Priority:**");
    lines.push("1. Guild-specific database configuration (current)");
    lines.push("2. Environment variable `LOGGING_CHANNEL` (if set)");
    lines.push("3. JSON console fallback (if no channel available)");
  } else {
    const envChannel = process.env.LOGGING_CHANNEL;
    if (envChannel) {
      lines.push(`⚠️ **Logging Channel:** <#${envChannel}> (from environment variable)`);
      lines.push("");
      lines.push("Using fallback from `LOGGING_CHANNEL` env var.");
      lines.push("");
      lines.push("**To set a guild-specific channel:**");
      lines.push("`/config set logging channel:#your-channel`");
    } else {
      lines.push("❌ **No logging channel configured**");
      lines.push("");
      lines.push("Actions are being logged as JSON to console only.");
      lines.push("");
      lines.push("**To enable pretty embed logging:**");
      lines.push("`/config set logging channel:#your-channel`");
    }
  }

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: lines.join("\n"),
    flags: interaction.replied ? undefined : MessageFlags.Ephemeral,
  });
}

async function executeSetFlagsChannel(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetFlagsChannel
   * WHAT: Sets the flags channel for Silent-Since-Join alerts (PR8).
   * WHY: Configures where flag alerts will be posted when threshold is exceeded.
   * PARAMS: ctx — command context; extracts channel option from interaction.
   * RETURNS: Promise<void> after confirming update.
   * DOCS:
   *  - Channel: https://discord.js.org/#/docs/discord.js/main/class/Channel
   *  - PR8 specification: docs/context/10_Roadmap_Open_Issues_and_Tasks.md
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_channel");
  const channel = interaction.options.getChannel("channel", true);

  // Validate channel is text-based
  if (!("isTextBased" in channel) || !channel.isTextBased()) {
    await replyOrEdit(interaction, {
      content: "❌ Flags channel must be a text channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ctx.step("persist_channel");
  setFlagsChannelId(interaction.guildId!, channel.id);

  logger.info(
    { evt: "config_set_flags_channel", guildId: interaction.guildId, channelId: channel.id },
    "[config] flags channel updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `✅ Flags channel set to <#${channel.id}>\n\nSilent-Since-Join alerts will now be posted here when accounts exceed the configured threshold.`,
  });
}

async function executeSetFlagsThreshold(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetFlagsThreshold
   * WHAT: Sets the silent days threshold for flagging (7-365 days).
   * WHY: Configures how long an account must be silent before flagging.
   * PARAMS: ctx — command context; extracts days option from interaction.
   * RETURNS: Promise<void> after confirming update.
   * DOCS:
   *  - PR8 specification: docs/context/10_Roadmap_Open_Issues_and_Tasks.md
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_days");
  const days = interaction.options.getInteger("days", true);

  if (days < 7 || days > 365 || !Number.isInteger(days)) {
    await replyOrEdit(interaction, {
      content: '❌ Invalid days value. Must be an integer between 7 and 365.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  ctx.step("persist_threshold");
  try {
    setSilentFirstMsgDays(interaction.guildId!, days);
  } catch (err: any) {
    logger.error(
      { err, guildId: interaction.guildId, days },
      "[config] failed to set flags threshold"
    );
    await replyOrEdit(interaction, {
      content: `❌ Failed to set threshold: ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  logger.info(
    { evt: "config_set_flags_threshold", guildId: interaction.guildId, days },
    "[config] flags threshold updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `✅ Silent days threshold set to **${days} days**\n\nAccounts that stay silent for ${days}+ days before their first message will now be flagged.`,
  });
}

async function executeGetFlags(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Shows flag config with health checks. We proactively verify the channel exists
   * and the bot has permissions, because a misconfigured flag channel fails silently
   * (the flagger just logs a warning and continues). Better to surface issues here.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_flags_config");
  const config = getFlaggerConfig(interaction.guildId!);

  const lines = ["**Silent-Since-Join Flagger Configuration (PR8)**", ""];

  if (config.channelId) {
    // Verify the channel still exists - it might have been deleted since config was set.
    const channel = await interaction.guild!.channels.fetch(config.channelId).catch(() => null);
    if (channel) {
      // fetchMe() gets the bot's own member object, which we need for permission checks.
      // This is a common pattern when you need to check "can the bot do X in channel Y".
      const botMember = await interaction.guild!.members.fetchMe();
      const permissions = channel.permissionsFor(botMember);
      const hasPerms = permissions?.has("SendMessages") && permissions?.has("EmbedLinks");

      if (hasPerms) {
        lines.push(`✅ **Flags Channel:** <#${config.channelId}> (healthy)`);
      } else {
        lines.push(`⚠️ **Flags Channel:** <#${config.channelId}> (missing permissions)`);
        lines.push("   ⚠️ Bot needs SendMessages + EmbedLinks permissions");
      }
    } else {
      lines.push(`❌ **Flags Channel:** <#${config.channelId}> (channel not found)`);
    }
  } else {
    const envChannel = process.env.FLAGGED_REPORT_CHANNEL_ID;
    if (envChannel) {
      lines.push(`⚠️ **Flags Channel:** <#${envChannel}> (from environment variable)`);
      lines.push("");
      lines.push("Using fallback from `FLAGGED_REPORT_CHANNEL_ID` env var.");
      lines.push("");
      lines.push("**To set a guild-specific channel:**");
      lines.push("`/config set flags_channel channel:#your-channel`");
    } else {
      lines.push("❌ **No flags channel configured**");
      lines.push("");
      lines.push("Silent-Since-Join detection is disabled until a channel is configured.");
      lines.push("");
      lines.push("**To enable flagging:**");
      lines.push("`/config set flags_channel channel:#your-channel`");
    }
  }

  // Threshold configuration
  lines.push("");
  lines.push(`📅 **Silent Days Threshold:** ${config.silentDays} days`);
  lines.push("");
  lines.push("**Resolution Priority:**");
  lines.push("1. Guild-specific database configuration");
  lines.push("2. Environment variable `SILENT_FIRST_MSG_DAYS` (if set)");
  lines.push("3. Default: 90 days");
  lines.push("");
  lines.push("**To change threshold:**");
  lines.push("`/config set flags_threshold days:120`");

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: lines.join("\n"),
    flags: interaction.replied ? undefined : MessageFlags.Ephemeral,
  });
}

async function executeView(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeView
   * WHAT: Displays ALL guild configuration variables and values.
   * WHY: Allows staff to verify current configuration at a glance.
   * PARAMS: ctx — command context.
   * RETURNS: Promise<void> after displaying config.
   */
  const { interaction } = ctx;

  // Defer reply without ephemeral flag so everyone can see it
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }

  ctx.step("load_config");
  const cfg = getConfig(interaction.guildId!);
  if (!cfg) {
    await replyOrEdit(interaction, { content: "No configuration found. Run /gate setup first." });
    return;
  }

  ctx.step("format_display");
  const { EmbedBuilder, Colors } = await import("discord.js");
  const embeds: EmbedBuilder[] = [];

  // Helper to format value
  const fmt = (v: unknown, type?: "channel" | "role" | "user"): string => {
    if (v === null || v === undefined) return "*not set*";
    if (type === "channel") return `<#${v}>`;
    if (type === "role") return `<@&${v}>`;
    if (type === "user") return `<@${v}>`;
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (typeof v === "number") return v.toLocaleString();
    return String(v);
  };

  // EMBED 1: Permission & Channel Settings
  const embed1 = new EmbedBuilder()
    .setTitle("Guild Configuration (1/3)")
    .setColor(Colors.Blue);

  // Permission Settings
  let permValue = "";
  if (cfg.mod_role_ids && cfg.mod_role_ids.trim().length > 0) {
    const roleIds = cfg.mod_role_ids.split(",").map(id => id.trim()).filter(id => id);
    permValue += `• mod_role_ids: ${roleIds.map(id => `<@&${id}>`).join(", ")}\n`;
  } else {
    permValue += "• mod_role_ids: *not set*\n";
  }
  permValue += `• gatekeeper_role_id: ${fmt(cfg.gatekeeper_role_id, "role")}\n`;
  permValue += `• reviewer_role_id: ${fmt(cfg.reviewer_role_id, "role")}\n`;
  permValue += `• leadership_role_id: ${fmt(cfg.leadership_role_id, "role")}\n`;
  permValue += `• bot_dev_role_id: ${fmt(cfg.bot_dev_role_id, "role")}`;
  embed1.addFields({ name: "🔐 Permission Settings", value: permValue, inline: false });

  // Channel Settings
  let channelValue = "";
  channelValue += `• review_channel_id: ${fmt(cfg.review_channel_id, "channel")}\n`;
  channelValue += `• gate_channel_id: ${fmt(cfg.gate_channel_id, "channel")}\n`;
  channelValue += `• general_channel_id: ${fmt(cfg.general_channel_id, "channel")}\n`;
  channelValue += `• unverified_channel_id: ${fmt(cfg.unverified_channel_id, "channel")}\n`;
  channelValue += `• modmail_log_channel_id: ${fmt(cfg.modmail_log_channel_id, "channel")}\n`;
  channelValue += `• logging_channel_id: ${fmt(cfg.logging_channel_id, "channel")}\n`;
  channelValue += `• flags_channel_id: ${fmt(cfg.flags_channel_id, "channel")}\n`;
  channelValue += `• forum_channel_id: ${fmt(cfg.forum_channel_id, "channel")}\n`;
  channelValue += `• notification_channel_id: ${fmt(cfg.notification_channel_id, "channel")}\n`;
  channelValue += `• backfill_notification_channel_id: ${fmt(cfg.backfill_notification_channel_id, "channel")}\n`;
  channelValue += `• support_channel_id: ${fmt(cfg.support_channel_id, "channel")}\n`;
  channelValue += `• server_artist_channel_id: ${fmt(cfg.server_artist_channel_id, "channel")}`;
  embed1.addFields({ name: "📺 Channel Settings", value: channelValue, inline: false });

  embeds.push(embed1);

  // EMBED 2: Role & Feature Settings
  const embed2 = new EmbedBuilder()
    .setTitle("Guild Configuration (2/3)")
    .setColor(Colors.Blue);

  // Role Settings
  let roleValue = "";
  roleValue += `• accepted_role_id: ${fmt(cfg.accepted_role_id, "role")}\n`;
  roleValue += `• welcome_ping_role_id: ${fmt(cfg.welcome_ping_role_id, "role")}\n`;
  roleValue += `• notify_role_id: ${fmt(cfg.notify_role_id, "role")}\n`;
  roleValue += `• artist_role_id: ${fmt(cfg.artist_role_id, "role")}\n`;
  roleValue += `• ambassador_role_id: ${fmt(cfg.ambassador_role_id, "role")}`;
  embed2.addFields({ name: "🎭 Role Settings", value: roleValue, inline: false });

  // Feature Toggles
  let featureValue = "";
  featureValue += `• avatar_scan_enabled: ${cfg.avatar_scan_enabled ? "yes" : "no"}\n`;
  featureValue += `• dadmode_enabled: ${cfg.dadmode_enabled ? `yes (1 in ${cfg.dadmode_odds ?? 1000})` : "no"}\n`;
  featureValue += `• ping_dev_on_app: ${cfg.ping_dev_on_app ? "yes" : "no"}\n`;
  featureValue += `• listopen_public_output: ${cfg.listopen_public_output ? "public" : "ephemeral"}\n`;
  featureValue += `• modmail_delete_on_close: ${cfg.modmail_delete_on_close ? "yes" : "no"}\n`;
  featureValue += `• banner_sync_enabled: ${(cfg.banner_sync_enabled ?? 1) ? "yes" : "no"}\n`;
  featureValue += `• review_roles_mode: ${cfg.review_roles_mode ?? "all"}\n`;
  featureValue += `• notify_mode: ${cfg.notify_mode ?? "post"}`;
  embed2.addFields({ name: "⚙️ Feature Toggles", value: featureValue, inline: false });

  // Timing & Thresholds
  let timingValue = "";
  timingValue += `• reapply_cooldown_hours: ${cfg.reapply_cooldown_hours ?? 24}\n`;
  timingValue += `• min_account_age_hours: ${cfg.min_account_age_hours ?? 0}\n`;
  timingValue += `• min_join_age_hours: ${cfg.min_join_age_hours ?? 0}\n`;
  timingValue += `• silent_first_msg_days: ${cfg.silent_first_msg_days ?? 90}\n`;
  timingValue += `• notify_cooldown_seconds: ${cfg.notify_cooldown_seconds ?? 5}s\n`;
  timingValue += `• notify_max_per_hour: ${cfg.notify_max_per_hour ?? 10}\n`;
  timingValue += `• banner_sync_interval_minutes: ${cfg.banner_sync_interval_minutes ?? 10}min\n`;
  timingValue += `• gate_answer_max_length: ${cfg.gate_answer_max_length ?? 1000} chars`;
  embed2.addFields({ name: "⏱️ Timing & Limits", value: timingValue, inline: false });

  embeds.push(embed2);

  // EMBED 3: Advanced Settings
  const embed3 = new EmbedBuilder()
    .setTitle("Guild Configuration (3/3)")
    .setColor(Colors.Blue)
    .setTimestamp();

  // Avatar Scan Settings
  let avatarValue = "";
  avatarValue += `• avatar_scan_nsfw_threshold: ${cfg.avatar_scan_nsfw_threshold ?? 0.6}\n`;
  avatarValue += `• avatar_scan_skin_edge_threshold: ${cfg.avatar_scan_skin_edge_threshold ?? 0.18}\n`;
  avatarValue += `• avatar_scan_weight_model: ${cfg.avatar_scan_weight_model ?? 0.7}\n`;
  avatarValue += `• avatar_scan_weight_edge: ${cfg.avatar_scan_weight_edge ?? 0.3}\n`;
  avatarValue += `• avatar_scan_hard_threshold: ${cfg.avatar_scan_hard_threshold ?? 0.8}\n`;
  avatarValue += `• avatar_scan_soft_threshold: ${cfg.avatar_scan_soft_threshold ?? 0.5}\n`;
  avatarValue += `• avatar_scan_racy_threshold: ${cfg.avatar_scan_racy_threshold ?? 0.8}`;
  embed3.addFields({ name: "🔍 Avatar Scan", value: avatarValue, inline: false });

  // Retry & Circuit Breaker
  let retryValue = "";
  retryValue += `• retry_max_attempts: ${cfg.retry_max_attempts ?? 3}\n`;
  retryValue += `• retry_initial_delay_ms: ${cfg.retry_initial_delay_ms ?? 100}ms\n`;
  retryValue += `• retry_max_delay_ms: ${cfg.retry_max_delay_ms ?? 5000}ms\n`;
  retryValue += `• circuit_breaker_threshold: ${cfg.circuit_breaker_threshold ?? 5}\n`;
  retryValue += `• circuit_breaker_reset_ms: ${cfg.circuit_breaker_reset_ms ?? 60000}ms`;
  embed3.addFields({ name: "🔄 Retry & Circuit Breaker", value: retryValue, inline: false });

  // Flag Rate Limiting
  let flagValue = "";
  flagValue += `• flag_rate_limit_ms: ${cfg.flag_rate_limit_ms ?? 2000}ms\n`;
  flagValue += `• flag_cooldown_ttl_ms: ${cfg.flag_cooldown_ttl_ms ?? 3600000}ms`;
  embed3.addFields({ name: "🚩 Flag Rate Limiting", value: flagValue, inline: false });

  // Modmail Settings
  let modmailValue = "";
  modmailValue += `• modmail_forward_max_size: ${cfg.modmail_forward_max_size ?? 10000}`;
  embed3.addFields({ name: "📬 Modmail", value: modmailValue, inline: false });

  // JSON Config Fields (truncated display)
  const safeJsonLen = (json: string | null | undefined): string => {
    if (!json) return "*not set*";
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? `${parsed.length} items` : "configured";
    } catch {
      return "*invalid JSON*";
    }
  };
  let jsonValue = "";
  jsonValue += `• artist_ignored_users_json: ${safeJsonLen(cfg.artist_ignored_users_json)}\n`;
  jsonValue += `• artist_ticket_roles_json: ${cfg.artist_ticket_roles_json ? "configured" : "*not set*"}\n`;
  jsonValue += `• poke_category_ids_json: ${safeJsonLen(cfg.poke_category_ids_json)}\n`;
  jsonValue += `• poke_excluded_channel_ids_json: ${safeJsonLen(cfg.poke_excluded_channel_ids_json)}`;
  embed3.addFields({ name: "📋 JSON Configs", value: jsonValue, inline: false });

  embeds.push(embed3);

  ctx.step("reply");
  await replyOrEdit(interaction, { embeds });
}

async function executeSetDadMode(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Dad Mode: responds to "I'm tired" with "Hi tired, I'm dad!" (or similar).
   * The odds setting controls how often it triggers - 1 in N messages that match.
   * Default is 1 in 1000, which is rare enough to be surprising but not annoying.
   *
   * The feature exists because community servers need some levity. It's entirely
   * opt-in and the odds can be cranked up to 100000 (basically never) if a server
   * wants it dormant but available.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const state = interaction.options.getString("state", true); // "on" | "off"
  const chance = interaction.options.getInteger("chance");

  ctx.step("update_config");
  const existingCfg = getConfig(interaction.guildId!);
  let dadmodeEnabled = existingCfg?.dadmode_enabled ?? false;
  let dadmodeOdds = existingCfg?.dadmode_odds ?? 1000;

  if (state === "off") {
    dadmodeEnabled = false;
    upsertConfig(interaction.guildId!, { dadmode_enabled: false });
  } else {
    dadmodeEnabled = true;
    if (chance !== null) {
      // Clamp to valid range. Discord's min/max should catch this, but defense in depth.
      const validChance = Math.min(100000, Math.max(2, chance));
      dadmodeOdds = validChance;
      upsertConfig(interaction.guildId!, { dadmode_enabled: true, dadmode_odds: validChance });
    } else {
      // Preserve existing odds if just toggling on, or default to 1000 for fresh configs.
      if (!dadmodeOdds) {
        dadmodeOdds = 1000;
      }
      upsertConfig(interaction.guildId!, {
        dadmode_enabled: true,
        dadmode_odds: dadmodeOdds,
      });
    }
  }

  ctx.step("reply");
  const statusText = dadmodeEnabled
    ? `**ON** (1 in **${dadmodeOdds ?? 1000}**)`
    : "**OFF**";
  await replyOrEdit(interaction, {
    content: `Dad Mode: ${statusText}`,
  });

  logger.info(
    {
      guildId: interaction.guildId,
      enabled: dadmodeEnabled,
      odds: dadmodeOdds,
      moderatorId: interaction.user.id,
    },
    "[config] dadmode updated"
  );
}

async function executeSetPingDevOnApp(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetPingDevOnApp
   * WHAT: Toggle Bot Dev role ping on new applications.
   * WHY: Allows control over whether Bot Dev role gets pinged alongside Gatekeeper role.
   * PARAMS: ctx — command context; extracts enabled boolean.
   * RETURNS: Promise<void> after confirming update.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const enabled = interaction.options.getBoolean("enabled", true);

  ctx.step("update_config");
  upsertConfig(interaction.guildId!, { ping_dev_on_app: enabled ? 1 : 0 });

  logger.info(
    {
      guildId: interaction.guildId,
      enabled,
      moderatorId: interaction.user.id,
    },
    "[config] ping_dev_on_app updated"
  );

  ctx.step("reply");
  const statusText = enabled ? "**enabled**" : "**disabled**";
  await replyOrEdit(interaction, {
    content: `Bot Dev role ping on new applications: ${statusText}`,
  });
}

async function executeSetMovieThreshold(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetMovieThreshold
   * WHAT: Sets the movie night qualification threshold in minutes.
   * WHY: Allows guilds to customize threshold for short films vs feature films.
   * PARAMS: ctx - command context; extracts minutes option from interaction.
   * RETURNS: Promise<void> after confirming update.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_minutes");
  const minutes = interaction.options.getInteger("minutes", true);

  // Validation: reasonable range (5-180 minutes = 5 min to 3 hours)
  if (minutes < 5 || minutes > 180 || !Number.isInteger(minutes)) {
    await replyOrEdit(interaction, {
      content: "Threshold must be between 5 and 180 minutes.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ctx.step("persist_threshold");
  // Insert or update guild config
  const stmt = db.prepare(`
    INSERT INTO guild_movie_config (guild_id, qualification_threshold_minutes, updated_at)
    VALUES (?, ?, strftime('%s', 'now'))
    ON CONFLICT(guild_id) DO UPDATE SET
      qualification_threshold_minutes = excluded.qualification_threshold_minutes,
      updated_at = excluded.updated_at
  `);

  stmt.run(interaction.guildId, minutes);

  logger.info(
    {
      evt: "movie_threshold_updated",
      guildId: interaction.guildId,
      threshold: minutes,
      userId: interaction.user.id,
    },
    "Movie qualification threshold updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Movie night qualification threshold set to **${minutes} minutes**.\n\nMembers must watch for at least ${minutes} minutes to qualify for tier roles.`,
  });
}

async function executeGetMovieConfig(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeGetMovieConfig
   * WHAT: Shows current movie night configuration.
   * WHY: Allows admins to view threshold and attendance mode settings.
   * PARAMS: ctx - command context.
   * RETURNS: Promise<void> after displaying config.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_movie_config");
  const stmt = db.prepare(`
    SELECT attendance_mode, qualification_threshold_minutes
    FROM guild_movie_config
    WHERE guild_id = ?
  `);
  const config = stmt.get(interaction.guildId) as
    { attendance_mode: string; qualification_threshold_minutes: number } | undefined;

  const mode = config?.attendance_mode ?? "cumulative";
  const threshold = config?.qualification_threshold_minutes ?? 30;

  const modeDescription = mode === "continuous"
    ? "Longest single session must exceed threshold (stricter)"
    : "Total time across all sessions must exceed threshold (more forgiving)";

  ctx.step("reply");
  await replyOrEdit(interaction, {
    embeds: [{
      title: "Movie Night Configuration",
      color: 0x5865F2,
      fields: [
        {
          name: "Attendance Mode",
          value: `\`${mode}\`\n${modeDescription}`,
          inline: false,
        },
        {
          name: "Qualification Threshold",
          value: `**${threshold} minutes**\nMembers must watch for at least ${threshold} minutes to qualify.`,
          inline: false,
        },
      ],
      footer: { text: "Use /config set movie_threshold to change threshold" },
    }],
    flags: interaction.replied ? undefined : MessageFlags.Ephemeral,
  });
}

// ============================================================
// ARTIST ROTATION CONFIG SUBCOMMANDS (Issue #78)
// ============================================================

async function executeSetArtistRotation(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetArtistRotation
   * WHAT: Configures artist rotation IDs (roles, channel, ticket roles).
   * WHY: Allows per-guild configuration instead of hardcoded Discord IDs.
   * PARAMS: ctx - command context; extracts role/channel options.
   * RETURNS: Promise<void> after confirming update.
   * DOCS: Issue #78 - docs/roadmap/078-move-artist-rotation-ids-to-config.md
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("gather_options");
  const artistRole = interaction.options.getRole("artist_role");
  const ambassadorRole = interaction.options.getRole("ambassador_role");
  const artistChannel = interaction.options.getChannel("artist_channel");
  const headshotTicket = interaction.options.getRole("headshot_ticket");
  const halfbodyTicket = interaction.options.getRole("halfbody_ticket");
  const emojiTicket = interaction.options.getRole("emoji_ticket");
  const fullbodyTicket = interaction.options.getRole("fullbody_ticket");

  // Check if any option was provided
  const hasAnyOption = artistRole || ambassadorRole || artistChannel ||
    headshotTicket || halfbodyTicket || emojiTicket || fullbodyTicket;

  if (!hasAnyOption) {
    await replyOrEdit(interaction, {
      content: "Please provide at least one option to configure.\n\nUse `/config get artist_rotation` to view current settings.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ctx.step("update_config");

  // Build partial update object
  const updates: Record<string, string | null> = {};
  const changes: string[] = [];

  if (artistRole) {
    updates.artist_role_id = artistRole.id;
    changes.push(`Artist Role: <@&${artistRole.id}>`);
  }

  if (ambassadorRole) {
    updates.ambassador_role_id = ambassadorRole.id;
    changes.push(`Ambassador Role: <@&${ambassadorRole.id}>`);
  }

  if (artistChannel) {
    updates.server_artist_channel_id = artistChannel.id;
    changes.push(`Artist Channel: <#${artistChannel.id}>`);
  }

  // Build ticket roles JSON if any ticket role was provided
  const cfg = getConfig(interaction.guildId!);
  let ticketRoles: Record<string, string | null> = {};

  // Parse existing ticket roles
  if (cfg?.artist_ticket_roles_json) {
    try {
      ticketRoles = JSON.parse(cfg.artist_ticket_roles_json);
    } catch {
      // Invalid JSON, start fresh
    }
  }

  let ticketRolesChanged = false;
  if (headshotTicket) {
    ticketRoles.headshot = headshotTicket.id;
    changes.push(`Headshot Ticket: <@&${headshotTicket.id}>`);
    ticketRolesChanged = true;
  }
  if (halfbodyTicket) {
    ticketRoles.halfbody = halfbodyTicket.id;
    changes.push(`Half-body Ticket: <@&${halfbodyTicket.id}>`);
    ticketRolesChanged = true;
  }
  if (emojiTicket) {
    ticketRoles.emoji = emojiTicket.id;
    changes.push(`Emoji Ticket: <@&${emojiTicket.id}>`);
    ticketRolesChanged = true;
  }
  if (fullbodyTicket) {
    ticketRoles.fullbody = fullbodyTicket.id;
    changes.push(`Full-body Ticket: <@&${fullbodyTicket.id}>`);
    ticketRolesChanged = true;
  }

  if (ticketRolesChanged) {
    updates.artist_ticket_roles_json = JSON.stringify(ticketRoles);
  }

  // Apply updates
  upsertConfig(interaction.guildId!, updates);

  logger.info(
    {
      evt: "config_set_artist_rotation",
      guildId: interaction.guildId,
      updates,
      userId: interaction.user.id,
    },
    "[config] artist rotation config updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Artist rotation configuration updated:\n\n${changes.map(c => `- ${c}`).join("\n")}`,
  });
}

async function executeGetArtistRotation(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeGetArtistRotation
   * WHAT: Shows current artist rotation configuration.
   * WHY: Allows admins to view configured IDs and see fallback values.
   * PARAMS: ctx - command context.
   * RETURNS: Promise<void> after displaying config.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_config");
  const cfg = getConfig(interaction.guildId!);

  // Import getArtistConfig to show resolved values
  const { getArtistConfig, ARTIST_ROLE_ID, AMBASSADOR_ROLE_ID, SERVER_ARTIST_CHANNEL_ID, TICKET_ROLES } =
    await import("../features/artistRotation/constants.js");
  const resolved = getArtistConfig(interaction.guildId!);

  const lines: string[] = ["**Artist Rotation Configuration (Issue #78)**", ""];

  // Show artist role
  if (cfg?.artist_role_id) {
    lines.push(`**Artist Role:** <@&${cfg.artist_role_id}> (configured)`);
  } else {
    lines.push(`**Artist Role:** <@&${ARTIST_ROLE_ID}> (fallback)`);
  }

  // Show ambassador role
  if (cfg?.ambassador_role_id) {
    lines.push(`**Ambassador Role:** <@&${cfg.ambassador_role_id}> (configured)`);
  } else {
    lines.push(`**Ambassador Role:** <@&${AMBASSADOR_ROLE_ID}> (fallback)`);
  }

  // Show artist channel
  if (cfg?.server_artist_channel_id) {
    lines.push(`**Artist Channel:** <#${cfg.server_artist_channel_id}> (configured)`);
  } else {
    lines.push(`**Artist Channel:** <#${SERVER_ARTIST_CHANNEL_ID}> (fallback)`);
  }

  lines.push("");
  lines.push("**Ticket Roles:**");

  // Parse configured ticket roles
  let configuredTickets: Record<string, string | null> = {};
  if (cfg?.artist_ticket_roles_json) {
    try {
      configuredTickets = JSON.parse(cfg.artist_ticket_roles_json);
    } catch {
      // Invalid JSON
    }
  }

  const ticketTypes = ["headshot", "halfbody", "emoji", "fullbody"] as const;
  for (const type of ticketTypes) {
    const configuredId = configuredTickets[type];
    const fallbackId = TICKET_ROLES[type];
    const resolvedId = resolved.ticketRoles[type];

    if (configuredId) {
      lines.push(`- ${type}: <@&${configuredId}> (configured)`);
    } else if (fallbackId) {
      lines.push(`- ${type}: <@&${fallbackId}> (fallback)`);
    } else {
      lines.push(`- ${type}: *not configured*`);
    }
  }

  lines.push("");
  lines.push("**To configure:**");
  lines.push("`/config set artist_rotation artist_role:@role ambassador_role:@role ...`");

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: lines.join("\n"),
    flags: interaction.replied ? undefined : MessageFlags.Ephemeral,
  });
}

// ============================================================
// POKE CONFIG SUBCOMMANDS (Issue #79)
// ============================================================

async function executePokeAddCategory(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executePokeAddCategory
   * WHAT: Adds a category to the poke target list.
   * WHY: Allows guild admins to configure which categories /poke targets.
   * PARAMS: ctx - command context; extracts category option from interaction.
   * RETURNS: Promise<void> after confirming update.
   * DOCS: Issue #79 - docs/roadmap/079-move-poke-category-ids-to-config.md
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_category");
  const category = interaction.options.getChannel("category", true);

  // Validate it's actually a category channel
  const { ChannelType } = await import("discord.js");
  if (category.type !== ChannelType.GuildCategory) {
    await replyOrEdit(interaction, {
      content: `Channel <#${category.id}> is not a category. Please select a category channel.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ctx.step("update_config");
  const cfg = getConfig(interaction.guildId!);

  // Parse existing category IDs or start fresh
  let categoryIds: string[] = [];
  if (cfg?.poke_category_ids_json) {
    try {
      const parsed = JSON.parse(cfg.poke_category_ids_json);
      if (Array.isArray(parsed)) {
        categoryIds = parsed;
      }
    } catch {
      // Invalid JSON, start fresh
    }
  }

  // Check if already exists
  if (categoryIds.includes(category.id)) {
    await replyOrEdit(interaction, {
      content: `Category <#${category.id}> is already in the poke target list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Add and save
  categoryIds.push(category.id);
  upsertConfig(interaction.guildId!, { poke_category_ids_json: JSON.stringify(categoryIds) });

  logger.info(
    {
      evt: "poke_category_added",
      guildId: interaction.guildId,
      categoryId: category.id,
      categoryName: category.name,
      totalCategories: categoryIds.length,
    },
    "[config] poke category added"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Added category **${category.name}** to poke targets.\n\nTotal categories: ${categoryIds.length}`,
  });
}

async function executePokeRemoveCategory(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executePokeRemoveCategory
   * WHAT: Removes a category from the poke target list.
   * WHY: Allows guild admins to configure which categories /poke targets.
   * PARAMS: ctx - command context; extracts category option from interaction.
   * RETURNS: Promise<void> after confirming update.
   * DOCS: Issue #79 - docs/roadmap/079-move-poke-category-ids-to-config.md
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_category");
  const category = interaction.options.getChannel("category", true);

  ctx.step("update_config");
  const cfg = getConfig(interaction.guildId!);

  // Parse existing category IDs
  let categoryIds: string[] = [];
  if (cfg?.poke_category_ids_json) {
    try {
      const parsed = JSON.parse(cfg.poke_category_ids_json);
      if (Array.isArray(parsed)) {
        categoryIds = parsed;
      }
    } catch {
      // Invalid JSON, nothing to remove
    }
  }

  // Check if exists
  const idx = categoryIds.indexOf(category.id);
  if (idx === -1) {
    await replyOrEdit(interaction, {
      content: `Category <#${category.id}> is not in the poke target list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Remove and save
  categoryIds.splice(idx, 1);
  upsertConfig(interaction.guildId!, { poke_category_ids_json: JSON.stringify(categoryIds) });

  logger.info(
    {
      evt: "poke_category_removed",
      guildId: interaction.guildId,
      categoryId: category.id,
      categoryName: category.name,
      totalCategories: categoryIds.length,
    },
    "[config] poke category removed"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Removed category **${category.name}** from poke targets.\n\nRemaining categories: ${categoryIds.length}`,
  });
}

async function executePokeExcludeChannel(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executePokeExcludeChannel
   * WHAT: Adds a channel to the poke exclusion list.
   * WHY: Allows guild admins to exclude specific channels from receiving poke messages.
   * PARAMS: ctx - command context; extracts channel option from interaction.
   * RETURNS: Promise<void> after confirming update.
   * DOCS: Issue #79 - docs/roadmap/079-move-poke-category-ids-to-config.md
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_channel");
  const channel = interaction.options.getChannel("channel", true);

  ctx.step("update_config");
  const cfg = getConfig(interaction.guildId!);

  // Parse existing excluded channel IDs or start fresh
  let excludedIds: string[] = [];
  if (cfg?.poke_excluded_channel_ids_json) {
    try {
      const parsed = JSON.parse(cfg.poke_excluded_channel_ids_json);
      if (Array.isArray(parsed)) {
        excludedIds = parsed;
      }
    } catch {
      // Invalid JSON, start fresh
    }
  }

  // Check if already excluded
  if (excludedIds.includes(channel.id)) {
    await replyOrEdit(interaction, {
      content: `Channel <#${channel.id}> is already excluded from pokes.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Add and save
  excludedIds.push(channel.id);
  upsertConfig(interaction.guildId!, { poke_excluded_channel_ids_json: JSON.stringify(excludedIds) });

  logger.info(
    {
      evt: "poke_channel_excluded",
      guildId: interaction.guildId,
      channelId: channel.id,
      channelName: channel.name,
      totalExcluded: excludedIds.length,
    },
    "[config] poke channel excluded"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Excluded channel **${channel.name}** from poke messages.\n\nTotal excluded: ${excludedIds.length}`,
  });
}

async function executePokeIncludeChannel(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executePokeIncludeChannel
   * WHAT: Removes a channel from the poke exclusion list.
   * WHY: Allows guild admins to re-include previously excluded channels.
   * PARAMS: ctx - command context; extracts channel option from interaction.
   * RETURNS: Promise<void> after confirming update.
   * DOCS: Issue #79 - docs/roadmap/079-move-poke-category-ids-to-config.md
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_channel");
  const channel = interaction.options.getChannel("channel", true);

  ctx.step("update_config");
  const cfg = getConfig(interaction.guildId!);

  // Parse existing excluded channel IDs
  let excludedIds: string[] = [];
  if (cfg?.poke_excluded_channel_ids_json) {
    try {
      const parsed = JSON.parse(cfg.poke_excluded_channel_ids_json);
      if (Array.isArray(parsed)) {
        excludedIds = parsed;
      }
    } catch {
      // Invalid JSON, nothing to remove
    }
  }

  // Check if exists
  const idx = excludedIds.indexOf(channel.id);
  if (idx === -1) {
    await replyOrEdit(interaction, {
      content: `Channel <#${channel.id}> is not in the exclusion list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Remove and save
  excludedIds.splice(idx, 1);
  upsertConfig(interaction.guildId!, { poke_excluded_channel_ids_json: JSON.stringify(excludedIds) });

  logger.info(
    {
      evt: "poke_channel_included",
      guildId: interaction.guildId,
      channelId: channel.id,
      channelName: channel.name,
      totalExcluded: excludedIds.length,
    },
    "[config] poke channel re-included"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Re-included channel **${channel.name}** (removed from exclusion list).\n\nRemaining excluded: ${excludedIds.length}`,
  });
}

// ============================================================
// NEW CONFIGURABLE SETTINGS (previously hardcoded)
// ============================================================

async function executeSetArtistIgnoredUsers(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Manages the list of users to exclude from the artist queue.
   * Replaces hardcoded IGNORED_ARTIST_USER_IDS constant.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const addUser = interaction.options.getUser("add");
  const removeUser = interaction.options.getUser("remove");

  if (!addUser && !removeUser) {
    // Show current list
    const cfg = getConfig(interaction.guildId!);
    let ignoredIds: string[] = [];
    if (cfg?.artist_ignored_users_json) {
      try {
        ignoredIds = JSON.parse(cfg.artist_ignored_users_json);
      } catch {
        // Invalid JSON
      }
    }

    if (ignoredIds.length === 0) {
      await replyOrEdit(interaction, {
        content: "No users are currently ignored from the artist queue.\n\nUse `/config set artist_ignored_users add:@user` to add users.",
      });
    } else {
      const userList = ignoredIds.map((id) => `<@${id}>`).join("\n");
      await replyOrEdit(interaction, {
        content: `**Users ignored from artist queue (${ignoredIds.length}):**\n${userList}`,
      });
    }
    return;
  }

  ctx.step("update_config");
  const cfg = getConfig(interaction.guildId!);
  let ignoredIds: string[] = [];
  if (cfg?.artist_ignored_users_json) {
    try {
      ignoredIds = JSON.parse(cfg.artist_ignored_users_json);
    } catch {
      // Invalid JSON, start fresh
    }
  }

  if (addUser) {
    if (ignoredIds.includes(addUser.id)) {
      await replyOrEdit(interaction, {
        content: `<@${addUser.id}> is already in the ignore list.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    ignoredIds.push(addUser.id);
    upsertConfig(interaction.guildId!, { artist_ignored_users_json: JSON.stringify(ignoredIds) });
    logger.info(
      { evt: "artist_ignored_user_added", guildId: interaction.guildId, userId: addUser.id },
      "[config] artist ignored user added"
    );
    await replyOrEdit(interaction, {
      content: `Added <@${addUser.id}> to the artist queue ignore list.\n\nTotal ignored: ${ignoredIds.length}`,
    });
  } else if (removeUser) {
    const idx = ignoredIds.indexOf(removeUser.id);
    if (idx === -1) {
      await replyOrEdit(interaction, {
        content: `<@${removeUser.id}> is not in the ignore list.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    ignoredIds.splice(idx, 1);
    upsertConfig(interaction.guildId!, { artist_ignored_users_json: JSON.stringify(ignoredIds) });
    logger.info(
      { evt: "artist_ignored_user_removed", guildId: interaction.guildId, userId: removeUser.id },
      "[config] artist ignored user removed"
    );
    await replyOrEdit(interaction, {
      content: `Removed <@${removeUser.id}> from the artist queue ignore list.\n\nRemaining ignored: ${ignoredIds.length}`,
    });
  }
}

async function executeSetBackfillChannel(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Sets the channel for backfill completion notifications.
   * Replaces hardcoded channel ID in backfill.ts.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_channel");
  const channel = interaction.options.getChannel("channel", true);

  ctx.step("persist_channel");
  upsertConfig(interaction.guildId!, { backfill_notification_channel_id: channel.id });

  logger.info(
    { evt: "config_set_backfill_channel", guildId: interaction.guildId, channelId: channel.id },
    "[config] backfill notification channel updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `✅ Backfill notification channel set to <#${channel.id}>\n\nBackfill completion messages will now be posted here.`,
  });
}

async function executeSetBotDevRole(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Sets the role to ping on new applications (when ping_dev_on_app is enabled).
   * Replaces hardcoded "Bot Dev" role lookup in review/card.ts.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_role");
  const role = interaction.options.getRole("role", true);

  ctx.step("persist_role");
  upsertConfig(interaction.guildId!, { bot_dev_role_id: role.id });

  logger.info(
    { evt: "config_set_bot_dev_role", guildId: interaction.guildId, roleId: role.id, roleName: role.name },
    "[config] bot dev role updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `✅ Bot Dev role set to <@&${role.id}>\n\nThis role will be pinged on new applications when \`/config set pingdevonapp enabled:true\` is set.`,
  });
}

async function executeSetGateAnswerLength(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Sets the max character length for gate application answers.
   * Replaces hardcoded 1000 char limit in gate.ts.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_length");
  const length = interaction.options.getInteger("length", true);

  ctx.step("persist_length");
  upsertConfig(interaction.guildId!, { gate_answer_max_length: length });

  logger.info(
    { evt: "config_set_gate_answer_length", guildId: interaction.guildId, length },
    "[config] gate answer max length updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `✅ Gate answer max length set to **${length} characters**\n\nApplication answers will be limited to this length.`,
  });
}

async function executeSetBannerSyncInterval(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Sets the interval between banner sync updates.
   * Replaces hardcoded 10 minute interval in bannerSync.ts.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_minutes");
  const minutes = interaction.options.getInteger("minutes", true);

  ctx.step("persist_interval");
  upsertConfig(interaction.guildId!, { banner_sync_interval_minutes: minutes });

  logger.info(
    { evt: "config_set_banner_sync_interval", guildId: interaction.guildId, minutes },
    "[config] banner sync interval updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `✅ Banner sync interval set to **${minutes} minute${minutes === 1 ? "" : "s"}**\n\nBanner updates will be rate-limited to this interval.`,
  });
}

async function executeSetModmailForwardSize(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Sets the max size for modmail forward tracking.
   * Replaces hardcoded 10000 limit in modmail/routing.ts.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_size");
  const size = interaction.options.getInteger("size", true);

  ctx.step("persist_size");
  upsertConfig(interaction.guildId!, { modmail_forward_max_size: size });

  logger.info(
    { evt: "config_set_modmail_forward_size", guildId: interaction.guildId, size },
    "[config] modmail forward max size updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `✅ Modmail forward tracking max size set to **${size.toLocaleString()} entries**\n\nOlder entries will be evicted when this limit is reached.`,
  });
}

async function executeSetRetryConfig(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Configures retry settings for API calls.
   * Replaces hardcoded retry values in various services.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const maxAttempts = interaction.options.getInteger("max_attempts");
  const initialDelay = interaction.options.getInteger("initial_delay_ms");
  const maxDelay = interaction.options.getInteger("max_delay_ms");

  if (maxAttempts === null && initialDelay === null && maxDelay === null) {
    // Show current config
    const cfg = getConfig(interaction.guildId!);
    await replyOrEdit(interaction, {
      content: `**Retry Configuration**\n` +
        `• Max attempts: ${cfg?.retry_max_attempts ?? 3}\n` +
        `• Initial delay: ${cfg?.retry_initial_delay_ms ?? 100}ms\n` +
        `• Max delay: ${cfg?.retry_max_delay_ms ?? 5000}ms\n\n` +
        `Use options to change values.`,
    });
    return;
  }

  ctx.step("update_config");
  const updates: Record<string, number> = {};
  const changes: string[] = [];

  if (maxAttempts !== null) {
    updates.retry_max_attempts = maxAttempts;
    changes.push(`Max attempts: ${maxAttempts}`);
  }
  if (initialDelay !== null) {
    updates.retry_initial_delay_ms = initialDelay;
    changes.push(`Initial delay: ${initialDelay}ms`);
  }
  if (maxDelay !== null) {
    updates.retry_max_delay_ms = maxDelay;
    changes.push(`Max delay: ${maxDelay}ms`);
  }

  upsertConfig(interaction.guildId!, updates);

  logger.info(
    { evt: "config_set_retry", guildId: interaction.guildId, updates },
    "[config] retry config updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `✅ Retry configuration updated:\n${changes.map(c => `• ${c}`).join("\n")}`,
  });
}

async function executeSetCircuitBreaker(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Configures circuit breaker settings for API resilience.
   * Prevents cascading failures when external services are down.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const threshold = interaction.options.getInteger("threshold");
  const resetMs = interaction.options.getInteger("reset_ms");

  if (threshold === null && resetMs === null) {
    // Show current config
    const cfg = getConfig(interaction.guildId!);
    await replyOrEdit(interaction, {
      content: `**Circuit Breaker Configuration**\n` +
        `• Failure threshold: ${cfg?.circuit_breaker_threshold ?? 5} failures\n` +
        `• Reset time: ${cfg?.circuit_breaker_reset_ms ?? 60000}ms\n\n` +
        `Use options to change values.`,
    });
    return;
  }

  ctx.step("update_config");
  const updates: Record<string, number> = {};
  const changes: string[] = [];

  if (threshold !== null) {
    updates.circuit_breaker_threshold = threshold;
    changes.push(`Failure threshold: ${threshold}`);
  }
  if (resetMs !== null) {
    updates.circuit_breaker_reset_ms = resetMs;
    changes.push(`Reset time: ${resetMs}ms`);
  }

  upsertConfig(interaction.guildId!, updates);

  logger.info(
    { evt: "config_set_circuit_breaker", guildId: interaction.guildId, updates },
    "[config] circuit breaker config updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `✅ Circuit breaker configuration updated:\n${changes.map(c => `• ${c}`).join("\n")}`,
  });
}

async function executeSetAvatarThresholds(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Configures avatar scan NSFW detection thresholds.
   * Allows tuning sensitivity for different community needs.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const hard = interaction.options.getNumber("hard");
  const soft = interaction.options.getNumber("soft");
  const racy = interaction.options.getNumber("racy");

  if (hard === null && soft === null && racy === null) {
    // Show current config
    const cfg = getConfig(interaction.guildId!);
    await replyOrEdit(interaction, {
      content: `**Avatar Scan Thresholds**\n` +
        `• Hard evidence: ${cfg?.avatar_scan_hard_threshold ?? 0.8}\n` +
        `• Soft evidence: ${cfg?.avatar_scan_soft_threshold ?? 0.5}\n` +
        `• Racy content: ${cfg?.avatar_scan_racy_threshold ?? 0.8}\n\n` +
        `Use options to change values.`,
    });
    return;
  }

  ctx.step("update_config");
  const updates: Record<string, number> = {};
  const changes: string[] = [];

  if (hard !== null) {
    updates.avatar_scan_hard_threshold = hard;
    changes.push(`Hard evidence: ${hard}`);
  }
  if (soft !== null) {
    updates.avatar_scan_soft_threshold = soft;
    changes.push(`Soft evidence: ${soft}`);
  }
  if (racy !== null) {
    updates.avatar_scan_racy_threshold = racy;
    changes.push(`Racy content: ${racy}`);
  }

  upsertConfig(interaction.guildId!, updates);

  logger.info(
    { evt: "config_set_avatar_thresholds", guildId: interaction.guildId, updates },
    "[config] avatar thresholds updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `✅ Avatar scan thresholds updated:\n${changes.map(c => `• ${c}`).join("\n")}`,
  });
}

async function executeSetFlagRateLimit(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Configures flag command rate limiting.
   * Prevents spam and abuse of flag features.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const cooldownMs = interaction.options.getInteger("cooldown_ms");
  const ttlMs = interaction.options.getInteger("ttl_ms");

  if (cooldownMs === null && ttlMs === null) {
    // Show current config
    const cfg = getConfig(interaction.guildId!);
    await replyOrEdit(interaction, {
      content: `**Flag Rate Limit Configuration**\n` +
        `• Cooldown: ${cfg?.flag_rate_limit_ms ?? 2000}ms\n` +
        `• Cache TTL: ${cfg?.flag_cooldown_ttl_ms ?? 3600000}ms\n\n` +
        `Use options to change values.`,
    });
    return;
  }

  ctx.step("update_config");
  const updates: Record<string, number> = {};
  const changes: string[] = [];

  if (cooldownMs !== null) {
    updates.flag_rate_limit_ms = cooldownMs;
    changes.push(`Cooldown: ${cooldownMs}ms`);
  }
  if (ttlMs !== null) {
    updates.flag_cooldown_ttl_ms = ttlMs;
    changes.push(`Cache TTL: ${ttlMs}ms`);
  }

  upsertConfig(interaction.guildId!, updates);

  logger.info(
    { evt: "config_set_flag_rate_limit", guildId: interaction.guildId, updates },
    "[config] flag rate limit updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `✅ Flag rate limit configuration updated:\n${changes.map(c => `• ${c}`).join("\n")}`,
  });
}

async function executeSetNotifyConfig(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Configures forum post notification settings.
   * Controls cooldown and rate limiting for notifications.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const cooldownSeconds = interaction.options.getInteger("cooldown_seconds");
  const maxPerHour = interaction.options.getInteger("max_per_hour");

  if (cooldownSeconds === null && maxPerHour === null) {
    // Show current config
    const cfg = getConfig(interaction.guildId!);
    await replyOrEdit(interaction, {
      content: `**Notify Configuration**\n` +
        `• Cooldown: ${cfg?.notify_cooldown_seconds ?? 5} seconds\n` +
        `• Max per hour: ${cfg?.notify_max_per_hour ?? 10}\n\n` +
        `Use options to change values.`,
    });
    return;
  }

  ctx.step("update_config");
  const updates: Record<string, number> = {};
  const changes: string[] = [];

  if (cooldownSeconds !== null) {
    updates.notify_cooldown_seconds = cooldownSeconds;
    changes.push(`Cooldown: ${cooldownSeconds}s`);
  }
  if (maxPerHour !== null) {
    updates.notify_max_per_hour = maxPerHour;
    changes.push(`Max per hour: ${maxPerHour}`);
  }

  upsertConfig(interaction.guildId!, updates);

  logger.info(
    { evt: "config_set_notify_config", guildId: interaction.guildId, updates },
    "[config] notify config updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `✅ Notify configuration updated:\n${changes.map(c => `• ${c}`).join("\n")}`,
  });
}

async function executeSetBannerSyncToggle(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Enables or disables banner sync feature.
   * Allows guilds to opt out of automatic banner synchronization.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const enabled = interaction.options.getBoolean("enabled", true);

  ctx.step("update_config");
  upsertConfig(interaction.guildId!, { banner_sync_enabled: enabled ? 1 : 0 });

  logger.info(
    { evt: "config_set_banner_sync_toggle", guildId: interaction.guildId, enabled },
    "[config] banner sync toggle updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `✅ Banner sync **${enabled ? "enabled" : "disabled"}**`,
  });
}

async function executePokeList(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executePokeList
   * WHAT: Lists current poke configuration (categories and excluded channels).
   * WHY: Allows guild admins to view current poke settings.
   * PARAMS: ctx - command context.
   * RETURNS: Promise<void> after displaying config.
   * DOCS: Issue #79 - docs/roadmap/079-move-poke-category-ids-to-config.md
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_config");
  const cfg = getConfig(interaction.guildId!);

  // Parse category IDs
  let categoryIds: string[] = [];
  let usingFallbackCategories = true;
  if (cfg?.poke_category_ids_json) {
    try {
      const parsed = JSON.parse(cfg.poke_category_ids_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        categoryIds = parsed;
        usingFallbackCategories = false;
      }
    } catch {
      // Invalid JSON
    }
  }

  // Parse excluded channel IDs
  let excludedIds: string[] = [];
  let usingFallbackExcluded = true;
  if (cfg?.poke_excluded_channel_ids_json) {
    try {
      const parsed = JSON.parse(cfg.poke_excluded_channel_ids_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        excludedIds = parsed;
        usingFallbackExcluded = false;
      }
    } catch {
      // Invalid JSON
    }
  }

  ctx.step("format_display");
  const { EmbedBuilder, Colors } = await import("discord.js");
  const embed = new EmbedBuilder()
    .setTitle("Poke Configuration")
    .setColor(Colors.Blue)
    .setTimestamp();

  // Categories field
  let categoriesValue: string;
  if (usingFallbackCategories) {
    categoriesValue = "*Using hardcoded defaults (10 categories)*\n\nUse `/config poke add-category` to set custom categories.";
  } else if (categoryIds.length === 0) {
    categoriesValue = "*None configured*\n\nUse `/config poke add-category` to add categories.";
  } else {
    categoriesValue = categoryIds.map((id) => `<#${id}>`).join("\n");
    if (categoriesValue.length > 1000) {
      categoriesValue = `${categoryIds.length} categories configured (too many to display)`;
    }
  }
  embed.addFields({ name: `Target Categories (${categoryIds.length})`, value: categoriesValue, inline: false });

  // Excluded channels field
  let excludedValue: string;
  if (usingFallbackExcluded) {
    excludedValue = "*Using hardcoded default (1 channel)*\n\nUse `/config poke exclude-channel` to set custom exclusions.";
  } else if (excludedIds.length === 0) {
    excludedValue = "*None excluded*";
  } else {
    excludedValue = excludedIds.map((id) => `<#${id}>`).join("\n");
    if (excludedValue.length > 1000) {
      excludedValue = `${excludedIds.length} channels excluded (too many to display)`;
    }
  }
  embed.addFields({ name: `Excluded Channels (${excludedIds.length})`, value: excludedValue, inline: false });

  // Usage hint
  embed.setFooter({ text: "Use /config poke add-category, remove-category, exclude-channel, include-channel" });

  ctx.step("reply");
  await replyOrEdit(interaction, { embeds: [embed] });
}

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * execute
   * WHAT: Main command handler for /config — routes to appropriate subcommand.
   * WHY: Provides centralized configuration management.
   * PARAMS: ctx — command context.
   * RETURNS: Promise<void> after executing appropriate subcommand.
   */
  const { interaction } = ctx;

  if (!interaction.guildId || !interaction.guild) {
    ctx.step("invalid_scope");
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Guild only." });
    return;
  }

  ctx.step("permission_check");
  if (!requireStaff(interaction)) return;

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === "set") {
    if (subcommand === "mod_roles") {
      await executeSetModRoles(ctx);
    } else if (subcommand === "gatekeeper") {
      await executeSetGatekeeper(ctx);
    } else if (subcommand === "modmail_log_channel") {
      await executeSetModmailLogChannel(ctx);
    } else if (subcommand === "review_roles") {
      await executeSetReviewRoles(ctx);
    } else if (subcommand === "logging") {
      await executeSetLogging(ctx);
    } else if (subcommand === "flags_channel") {
      await executeSetFlagsChannel(ctx);
    } else if (subcommand === "flags_threshold") {
      await executeSetFlagsThreshold(ctx);
    } else if (subcommand === "dadmode") {
      await executeSetDadMode(ctx);
    } else if (subcommand === "pingdevonapp") {
      await executeSetPingDevOnApp(ctx);
    } else if (subcommand === "movie_threshold") {
      await executeSetMovieThreshold(ctx);
    } else if (subcommand === "artist_rotation") {
      await executeSetArtistRotation(ctx);
    } else if (subcommand === "artist_ignored_users") {
      await executeSetArtistIgnoredUsers(ctx);
    } else if (subcommand === "backfill_channel") {
      await executeSetBackfillChannel(ctx);
    } else if (subcommand === "bot_dev_role") {
      await executeSetBotDevRole(ctx);
    } else if (subcommand === "gate_answer_length") {
      await executeSetGateAnswerLength(ctx);
    } else if (subcommand === "banner_sync_interval") {
      await executeSetBannerSyncInterval(ctx);
    } else if (subcommand === "modmail_forward_size") {
      await executeSetModmailForwardSize(ctx);
    } else if (subcommand === "retry_config") {
      await executeSetRetryConfig(ctx);
    } else if (subcommand === "circuit_breaker") {
      await executeSetCircuitBreaker(ctx);
    } else if (subcommand === "avatar_thresholds") {
      await executeSetAvatarThresholds(ctx);
    } else if (subcommand === "flag_rate_limit") {
      await executeSetFlagRateLimit(ctx);
    } else if (subcommand === "notify_config") {
      await executeSetNotifyConfig(ctx);
    } else if (subcommand === "banner_sync_toggle") {
      await executeSetBannerSyncToggle(ctx);
    }
  } else if (subcommandGroup === "get") {
    if (subcommand === "logging") {
      await executeGetLogging(ctx);
    } else if (subcommand === "flags") {
      await executeGetFlags(ctx);
    } else if (subcommand === "movie_config") {
      await executeGetMovieConfig(ctx);
    } else if (subcommand === "artist_rotation") {
      await executeGetArtistRotation(ctx);
    }
  } else if (subcommandGroup === "poke") {
    if (subcommand === "add-category") {
      await executePokeAddCategory(ctx);
    } else if (subcommand === "remove-category") {
      await executePokeRemoveCategory(ctx);
    } else if (subcommand === "exclude-channel") {
      await executePokeExcludeChannel(ctx);
    } else if (subcommand === "include-channel") {
      await executePokeIncludeChannel(ctx);
    } else if (subcommand === "list") {
      await executePokeList(ctx);
    }
  } else if (subcommand === "view") {
    await executeView(ctx);
  }
}
