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
      if (!/^\d{17,20}$/.test(role.id)) {
        await replyOrEdit(interaction, {
          content: `❌ Invalid role ID format for ${role.name}. Please try again.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
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

  if (!/^\d{17,20}$/.test(role.id)) {
    await replyOrEdit(interaction, {
      content: '❌ Invalid role ID format. Please try again.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

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

  if (!/^\d{17,20}$/.test(channel.id)) {
    await replyOrEdit(interaction, {
      content: '❌ Invalid channel ID format. Please try again.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

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

  if (!/^\d{17,20}$/.test(channel.id)) {
    await replyOrEdit(interaction, {
      content: '❌ Invalid channel ID format. Please try again.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

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

  if (!/^\d{17,20}$/.test(channel.id)) {
    await replyOrEdit(interaction, {
      content: '❌ Invalid channel ID format. Please try again.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

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
   * WHAT: Displays current guild configuration including new mod role settings.
   * WHY: Allows staff to verify current configuration.
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
  const embed = new EmbedBuilder()
    .setTitle("Guild Configuration")
    .setColor(Colors.Blue)
    .setTimestamp();

  // Permission Settings
  let permValue = "";
  if (cfg.mod_role_ids && cfg.mod_role_ids.trim().length > 0) {
    const roleIds = cfg.mod_role_ids
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    const roleList = roleIds.map((id) => `<@&${id}>`).join(", ");
    permValue += `**Moderator roles:** ${roleList}\n`;
  } else {
    permValue += "**Moderator roles:** not set\n";
  }

  if (cfg.gatekeeper_role_id) {
    permValue += `**Gatekeeper role:** <@&${cfg.gatekeeper_role_id}>`;
  } else {
    permValue += "**Gatekeeper role:** not set";
  }

  embed.addFields({ name: "Permission Settings", value: permValue, inline: false });

  // Channel Settings
  let channelValue = "";
  if (cfg.modmail_log_channel_id) {
    channelValue += `**Modmail log channel:** <#${cfg.modmail_log_channel_id}>\n`;
  } else {
    channelValue += "**Modmail log channel:** not set\n";
  }

  channelValue += `**Review channel:** ${cfg.review_channel_id ? `<#${cfg.review_channel_id}>` : "not set"}\n`;
  channelValue += `**Gate channel:** ${cfg.gate_channel_id ? `<#${cfg.gate_channel_id}>` : "not set"}\n`;
  channelValue += `**General channel:** ${cfg.general_channel_id ? `<#${cfg.general_channel_id}>` : "not set"}\n`;
  channelValue += `**Unverified channel:** ${cfg.unverified_channel_id ? `<#${cfg.unverified_channel_id}>` : "not set"}`;

  embed.addFields({ name: "Channel Settings", value: channelValue, inline: false });

  // Role Settings
  let roleValue = "";
  roleValue += `**Accepted role:** ${cfg.accepted_role_id ? `<@&${cfg.accepted_role_id}>` : "not set"}\n`;
  roleValue += `**Reviewer role:** ${cfg.reviewer_role_id ? `<@&${cfg.reviewer_role_id}>` : "not set (uses channel perms)"}`;

  const loggingChannelId = getLoggingChannelId(interaction.guildId!);
  if (loggingChannelId) {
    roleValue += `\n**Action logging channel:** <#${loggingChannelId}>`;
  } else {
    roleValue += "\n**Action logging channel:** not set (using env default)";
  }

  embed.addFields({ name: "Role Settings", value: roleValue, inline: false });

  // Feature Settings
  let featureValue = "";
  featureValue += `**Avatar scan enabled:** ${cfg.avatar_scan_enabled ? "yes" : "no"}\n`;
  featureValue += `**Dad Mode:** ${cfg.dadmode_enabled ? `ON (1 in ${cfg.dadmode_odds ?? 1000})` : "OFF"}`;

  embed.addFields({ name: "Feature Settings", value: featureValue, inline: false });

  ctx.step("reply");
  await replyOrEdit(interaction, { embeds: [embed] });
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
   * DOCS:
   *  - Bot Dev role: 1120074045883420753
   *  - Gatekeeper role: 896070888762535969
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
    content: `Bot Dev role ping on new applications: ${statusText}\n\nBot Dev role (<@&1120074045883420753>) will ${enabled ? "now be" : "no longer be"} pinged when new applications are submitted.`,
  });
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
