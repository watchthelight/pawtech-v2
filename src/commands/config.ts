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
import { wrapCommand, type CommandContext, ensureDeferred, replyOrEdit } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
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
  )
  .addSubcommand((sc) => sc.setName("view").setDescription("View current guild configuration"));

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

  // Retrofit modmail parent permissions after mod roles change
  // WHAT: Updates parent channel permissions for existing modmail threads
  // WHY: New mod roles need SendMessagesInThreads on parent channels to speak in threads
  // HOW: Discovers all parents hosting modmail threads and grants permissions
  // DOCS: See retrofitModmailParentsForGuild in src/features/modmail.ts
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
    // Don't fail the command if retrofit fails; it's a nice-to-have
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
   * executeSetReviewRoles
   * WHAT: Sets the role display mode for review cards.
   * WHY: Controls clutter in review cards by hiding or filtering roles.
   * MODES:
   *  - none: Hide all roles (minimal card)
   *  - level_only: Show only highest "level" role (e.g., "Level 2", "Level 3")
   *  - all: Show all roles (current behavior, can be cluttered)
   * PARAMS: ctx — command context; extracts mode option from interaction.
   * RETURNS: Promise<void> after confirming update.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_mode");
  const mode = interaction.options.getString("mode", true);

  // Validate mode
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
   * executeGetLogging
   * WHAT: Shows current logging channel configuration with fallback info.
   * WHY: Allows staff to verify where actions are being logged.
   * PARAMS: ctx — command context.
   * RETURNS: Promise<void> after displaying logging configuration.
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
  if (!channel.isTextBased()) {
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
   * executeGetFlags
   * WHAT: Shows current flags configuration with fallback info.
   * WHY: Allows staff to verify flags channel and threshold settings.
   * PARAMS: ctx — command context.
   * RETURNS: Promise<void> after displaying flags configuration.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_flags_config");
  const config = getFlaggerConfig(interaction.guildId!);

  const lines = ["**Silent-Since-Join Flagger Configuration (PR8)**", ""];

  // Channel configuration
  if (config.channelId) {
    const channel = await interaction.guild!.channels.fetch(config.channelId).catch(() => null);
    if (channel) {
      // Channel exists, verify permissions
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
   * WHAT: Displays current guild configuration including new mod role settings.
   * WHY: Allows staff to verify current configuration.
   * PARAMS: ctx — command context.
   * RETURNS: Promise<void> after displaying config.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("load_config");
  const cfg = getConfig(interaction.guildId!);
  if (!cfg) {
    await replyOrEdit(interaction, { content: "No configuration found. Run /gate setup first." });
    return;
  }

  ctx.step("format_display");
  const lines = ["**Guild Configuration**", "", "**Permission Settings:**"];

  // Show mod roles
  if (cfg.mod_role_ids && cfg.mod_role_ids.trim().length > 0) {
    const roleIds = cfg.mod_role_ids
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    const roleList = roleIds.map((id) => `<@&${id}>`).join(", ");
    lines.push(`Moderator roles: ${roleList}`);
  } else {
    lines.push("Moderator roles: not set");
  }

  if (cfg.gatekeeper_role_id) {
    lines.push(`Gatekeeper role: <@&${cfg.gatekeeper_role_id}>`);
  } else {
    lines.push("Gatekeeper role: not set");
  }

  lines.push("");
  lines.push("**Channel Settings:**");

  if (cfg.modmail_log_channel_id) {
    lines.push(`Modmail log channel: <#${cfg.modmail_log_channel_id}>`);
  } else {
    lines.push("Modmail log channel: not set");
  }

  lines.push(
    `Review channel: ${cfg.review_channel_id ? `<#${cfg.review_channel_id}>` : "not set"}`,
    `Gate channel: ${cfg.gate_channel_id ? `<#${cfg.gate_channel_id}>` : "not set"}`,
    `General channel: ${cfg.general_channel_id ? `<#${cfg.general_channel_id}>` : "not set"}`,
    `Unverified channel: ${cfg.unverified_channel_id ? `<#${cfg.unverified_channel_id}>` : "not set"}`
  );

  lines.push("");
  lines.push("**Role Settings:**");
  lines.push(
    `Accepted role: ${cfg.accepted_role_id ? `<@&${cfg.accepted_role_id}>` : "not set"}`,
    `Reviewer role: ${cfg.reviewer_role_id ? `<@&${cfg.reviewer_role_id}>` : "not set (uses channel perms)"}`
  );

  // Show logging channel
  const loggingChannelId = getLoggingChannelId(interaction.guildId!);
  if (loggingChannelId) {
    lines.push(`Action logging channel: <#${loggingChannelId}>`);
  } else {
    lines.push("Action logging channel: not set (using env default)");
  }

  lines.push("");
  lines.push("**Feature Settings:**");
  lines.push(`Avatar scan enabled: ${cfg.avatar_scan_enabled ? "yes" : "no"}`);
  lines.push(
    `Dad Mode: ${cfg.dadmode_enabled ? `ON (1 in ${cfg.dadmode_odds ?? 1000})` : "OFF"}`
  );

  ctx.step("reply");
  await replyOrEdit(interaction, { content: lines.join("\n") });
}

async function executeSetDadMode(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetDadMode
   * WHAT: Toggle Dad Mode (playful "Hi <name>, I'm dad" responses).
   * WHY: Provides lighthearted engagement; configurable per-guild with adjustable odds.
   * PARAMS: ctx — command context; extracts state and optional chance.
   * RETURNS: Promise<void> after confirming update.
   * DOCS:
   *  - Dad Mode responds to messages like "I'm tired" with "Hi tired, I'm dad"
   *  - Odds default to 1 in 1000 (adjustable 2-100000)
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const state = interaction.options.getString("state", true); // "on" | "off"
  const chance = interaction.options.getInteger("chance");

  ctx.step("update_config");
  const cfg = getConfig(interaction.guildId!) ?? { guild_id: interaction.guildId! };

  if (state === "off") {
    cfg.dadmode_enabled = false;
    upsertConfig(interaction.guildId!, { dadmode_enabled: false });
  } else {
    cfg.dadmode_enabled = true;
    if (chance !== null) {
      // Validate and clamp (redundant with Discord's validation, but safe)
      const validChance = Math.min(100000, Math.max(2, chance));
      cfg.dadmode_odds = validChance;
      upsertConfig(interaction.guildId!, { dadmode_enabled: true, dadmode_odds: validChance });
    } else {
      // Use existing or default to 1000
      if (!cfg.dadmode_odds) {
        cfg.dadmode_odds = 1000;
      }
      upsertConfig(interaction.guildId!, {
        dadmode_enabled: true,
        dadmode_odds: cfg.dadmode_odds,
      });
    }
  }

  ctx.step("reply");
  const statusText = cfg.dadmode_enabled
    ? `**ON** (1 in **${cfg.dadmode_odds ?? 1000}**)`
    : "**OFF**";
  await replyOrEdit(interaction, {
    content: `Dad Mode: ${statusText}`,
  });

  logger.info(
    {
      guildId: interaction.guildId,
      enabled: cfg.dadmode_enabled,
      odds: cfg.dadmode_odds,
      moderatorId: interaction.user.id,
    },
    "[config] dadmode updated"
  );
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
    }
  } else if (subcommandGroup === "get") {
    if (subcommand === "logging") {
      await executeGetLogging(ctx);
    } else if (subcommand === "flags") {
      await executeGetFlags(ctx);
    }
  } else if (subcommand === "view") {
    await executeView(ctx);
  }
}
