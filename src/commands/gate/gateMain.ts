/**
 * Pawtropolis Tech -- src/commands/gate/gateMain.ts
 * WHAT: /gate command for guild gate management.
 * WHY: Setup, reset, status, config, welcome, and question management.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from "discord.js";
import {
  requireStaff,
  upsertConfig,
  getConfig,
  hasManageGuild,
  isReviewer,
  canRunAllCommands,
  hasGateAdmin,
  type GuildConfig,
} from "../../lib/config.js";
import { ensureGateEntry } from "../../features/gate.js";
import { renderWelcomeTemplate } from "../../features/review.js";
import { postWelcomeCard } from "../../features/welcome.js";
import { seedDefaultQuestionsIfEmpty, getQuestions, upsertQuestion } from "../../features/gate/questions.js";
import { postGateConfigCard } from "../../lib/configCard.js";
import {
  wrapCommand,
  type CommandContext,
  ensureDeferred,
  replyOrEdit,
  withSql,
} from "../../lib/cmdWrap.js";
import { db } from "../../db/db.js";
import { secureCompare } from "../../lib/secureCompare.js";
import { logger } from "../../lib/logger.js";
import { env } from "../../lib/env.js";
import type { GuildMember } from "discord.js";
import { isGuildMember } from "../../utils/typeGuards.js";

export const data = new SlashCommandBuilder()
  .setName("gate")
  .setDescription("Guild gate management (v2)")
  .addSubcommand((sc) =>
    sc
      .setName("setup")
      .setDescription("Initialize config for this guild")
      .addChannelOption((o) =>
        o.setName("review_channel").setDescription("Staff review channel").setRequired(true)
      )
      .addChannelOption((o) =>
        o.setName("gate_channel").setDescription("Public gate/apply channel").setRequired(true)
      )
      .addChannelOption((o) =>
        o.setName("general_channel").setDescription("General/welcome channel").setRequired(true)
      )
      .addRoleOption((o) =>
        o.setName("accepted_role").setDescription("Role to grant when accepted").setRequired(true)
      )
      .addChannelOption((o) =>
        o
          .setName("unverified_channel")
          .setDescription("Unverified channel for pings (optional)")
          .setRequired(false)
      )
      .addRoleOption((o) =>
        o
          .setName("reviewer_role")
          .setDescription("Role that can review (optional)")
          .setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc.setName("reset").setDescription("Reset all application data (fresh invite) - staff only")
  )
  .addSubcommand((sc) => sc.setName("status").setDescription("Show application stats"))
  .addSubcommand((sc) => sc.setName("config").setDescription("View current gate configuration"))
  .addSubcommandGroup((group) =>
    group
      .setName("welcome")
      .setDescription("Manage the welcome message")
      .addSubcommand((sc) =>
        sc
          .setName("set")
          .setDescription("Update the welcome message template")
          .addStringOption((option) =>
            option
              .setName("content")
              .setDescription("Template content (supports {applicant.*} tokens)")
              .setRequired(true)
              .setMinLength(1)
              .setMaxLength(2000)
          )
      )
      .addSubcommand((sc) =>
        sc.setName("preview").setDescription("Preview the welcome message for yourself")
      )
      .addSubcommand((sc) =>
        sc
          .setName("channels")
          .setDescription("Configure welcome channels and ping role")
          .addChannelOption((o) =>
            o
              .setName("info_channel")
              .setDescription("Info channel to mention in welcome")
              .setRequired(false)
          )
          .addChannelOption((o) =>
            o
              .setName("rules_channel")
              .setDescription("Rules channel to mention in welcome")
              .setRequired(false)
          )
          .addRoleOption((o) =>
            o
              .setName("ping_role")
              .setDescription("Role to ping in welcome message")
              .setRequired(false)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("role")
          .setDescription("Set the extra ping role for welcome messages")
          .addRoleOption((o) =>
            o.setName("role").setDescription("Role to ping in welcome message").setRequired(true)
          )
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-questions")
      .setDescription("Set (update) gate questions q1..q5. Omit any to leave unchanged.")
      .addStringOption((o) => o.setName("q1").setDescription("Question 1").setRequired(false).setMaxLength(500))
      .addStringOption((o) => o.setName("q2").setDescription("Question 2").setRequired(false).setMaxLength(500))
      .addStringOption((o) => o.setName("q3").setDescription("Question 3").setRequired(false).setMaxLength(500))
      .addStringOption((o) => o.setName("q4").setDescription("Question 4").setRequired(false).setMaxLength(500))
      .addStringOption((o) => o.setName("q5").setDescription("Question 5").setRequired(false).setMaxLength(500))
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

async function executeSetup(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await ensureDeferred(interaction);

  ctx.step("validate_input");
  const reviewerRole = interaction.options.getRole("reviewer_role");
  const unverifiedChannel = interaction.options.getChannel("unverified_channel");
  const channels = {
    review: interaction.options.getChannel("review_channel", true).id,
    gate: interaction.options.getChannel("gate_channel", true).id,
    general: interaction.options.getChannel("general_channel", true).id,
    unverified: unverifiedChannel?.id ?? null,
    accepted: interaction.options.getRole("accepted_role", true).id,
    reviewer: reviewerRole?.id ?? null,
  };

  ctx.step("db_write");
  upsertConfig(interaction.guildId!, {
    review_channel_id: channels.review,
    gate_channel_id: channels.gate,
    general_channel_id: channels.general,
    unverified_channel_id: channels.unverified,
    accepted_role_id: channels.accepted,
    reviewer_role_id: channels.reviewer,
  });

  ctx.step("seed_questions");
  const { inserted, total } = seedDefaultQuestionsIfEmpty(interaction.guildId!, ctx);
  logger.info(
    { evt: "gate_questions_seed", guildId: interaction.guildId!, inserted, total },
    "[gate] questions seeded (if empty)"
  );

  ctx.step("ensure_entry");
  await ensureGateEntry(ctx, interaction.guildId!);

  ctx.step("count_questions");
  const questionCount = total;

  ctx.step("post_config_card");
  await postGateConfigCard(
    interaction,
    interaction.guild!,
    {
      reviewChannelId: channels.review,
      gateChannelId: channels.gate,
      generalChannelId: channels.general,
      unverifiedChannelId: channels.unverified,
      acceptedRoleId: channels.accepted,
      reviewerRoleId: channels.reviewer,
    },
    questionCount
  );
}

async function executeReset(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  ctx.step("check_config");
  const cfg = getConfig(interaction.guildId!);
  if (!cfg) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "No configuration found. Run /gate setup first.",
    });
    return;
  }

  ctx.step("show_confirmation_modal");
  const modal = new ModalBuilder()
    .setCustomId(`v1:gate:reset:${interaction.guildId}`)
    .setTitle("⚠️ Reset Guild Data");

  const confirmInput = new TextInputBuilder()
    .setCustomId("v1:gate:reset:confirm")
    .setLabel('Type "RESET" to confirm')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("RESET");

  const passwordInput = new TextInputBuilder()
    .setCustomId("v1:gate:reset:password")
    .setLabel("Enter reset password (from env)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(confirmInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(passwordInput)
  );

  await interaction.showModal(modal);
}

export const handleResetModal = wrapCommand<ModalSubmitInteraction>("gate:reset", async (ctx) => {
  const { interaction } = ctx;

  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Guild only." });
    return;
  }

  ctx.step("permission_check");
  const member = isGuildMember(interaction.member) ? interaction.member : null;
  const hasPermission =
    canRunAllCommands(member, interaction.guildId) ||
    hasManageGuild(member) ||
    isReviewer(interaction.guildId, member);
  if (!hasPermission) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "You don't have permission for this.",
    });
    return;
  }

  ctx.step("validate_confirm");
  const confirmText = interaction.fields.getTextInputValue("v1:gate:reset:confirm").trim();
  if (confirmText !== "RESET") {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "Confirmation word incorrect.",
    });
    return;
  }

  ctx.step("validate_password");
  const password = interaction.fields.getTextInputValue("v1:gate:reset:password").trim();

  if (!env.RESET_PASSWORD) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "RESET_PASSWORD not configured.",
    });
    return;
  }

  if (!secureCompare(password, env.RESET_PASSWORD)) {
    logger.warn(
      {
        evt: "gate_reset_denied",
        guildId: interaction.guildId,
        userId: interaction.user.id,
      },
      "[gate] Reset denied: invalid password"
    );
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "Password incorrect.",
    });
    return;
  }

  ctx.step("defer_reply");
  await ensureDeferred(interaction);

  const guildId = interaction.guildId;

  ctx.step("permission_recheck");
  const memberRecheck = isGuildMember(interaction.member) ? interaction.member : null;
  const stillHasPermission =
    canRunAllCommands(memberRecheck, guildId) ||
    hasManageGuild(memberRecheck) ||
    isReviewer(guildId, memberRecheck);
  if (!stillHasPermission) {
    logger.warn(
      { evt: "gate_reset_permission_revoked", guildId, userId: interaction.user.id },
      "[gate] Permission revoked between modal open and submit"
    );
    await interaction.editReply({ content: "Your permissions were revoked. Reset cancelled." });
    return;
  }

  const resetAll = db.transaction(() => {
    const runDelete = (phase: string, sql: string, optional = false) => {
      ctx.step(phase);
      try {
        withSql(ctx, sql, () => db.prepare(sql).run());
      } catch (err) {
        if (optional && err instanceof Error && /no such table/i.test(err.message ?? "")) {
          logger.warn(
            { evt: "gate_reset_optional_missing", sql, err },
            "[gate] optional table missing during reset"
          );
          return;
        }
        throw err;
      }
    };

    runDelete("wipe_application", "DELETE FROM application");
    runDelete("wipe_application_response", "DELETE FROM application_response");
    runDelete("wipe_review_action", "DELETE FROM review_action");
    runDelete("wipe_modmail_bridge", "DELETE FROM modmail_bridge");
    runDelete("wipe_review_card", "DELETE FROM review_card", true);
    runDelete("wipe_avatar_scan", "DELETE FROM avatar_scan", true);
    runDelete("wipe_review_claim", "DELETE FROM review_claim", true);
  });

  resetAll();

  const wipeQuestionsSql = "DELETE FROM guild_question WHERE guild_id = ?";
  ctx.step("wipe_guild_question");
  try {
    withSql(ctx, wipeQuestionsSql, () => db.prepare(wipeQuestionsSql).run(guildId));
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message ?? "")) {
      logger.warn(
        { evt: "gate_reset_optional_missing", sql: wipeQuestionsSql, err },
        "[gate] questions table missing during reset"
      );
    } else {
      throw err;
    }
  }

  ctx.step("reseed_questions");
  const { inserted, total } = seedDefaultQuestionsIfEmpty(guildId, ctx);
  logger.info(
    { evt: "gate_questions_seed", guildId, inserted, total },
    "[gate] questions seeded (if empty)"
  );

  logger.info(
    {
      evt: "gate_reset_completed",
      guildId,
      userId: interaction.user.id,
    },
    `[gate] Reset completed for guild=${guildId}`
  );

  ctx.step("ensure_entry");
  const cfg = getConfig(guildId);
  if (cfg && cfg.gate_channel_id) {
    try {
      await ensureGateEntry(ctx, guildId!);
    } catch (err) {
      logger.warn({ err, guildId }, "Failed to ensure gate entry after reset");
    }
  }

  await interaction.editReply({
    content: `Guild data reset. Questions seeded: ${total}. Gate Entry ensured.`,
  });
});

async function executeStatus(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("query_stats");
  const guildId = interaction.guildId!;

  const statusCounts = db
    .prepare(
      `SELECT status, COUNT(*) as count
       FROM application
       WHERE guild_id = ?
       GROUP BY status`
    )
    .all(guildId) as Array<{ status: string; count: number }>;

  const claimedCount = db
    .prepare(`SELECT COUNT(DISTINCT app_id) as count FROM review_claim`)
    .get() as { count: number };

  const lines = ["**Application Statistics**", ""];
  for (const row of statusCounts) {
    lines.push(`${row.status}: ${row.count}`);
  }
  lines.push("", `Claimed: ${claimedCount.count}`);

  await replyOrEdit(interaction, { content: lines.join("\n") });
}

async function executeConfigView(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("load_config");
  const cfg = getConfig(interaction.guildId!);
  if (!cfg) {
    await replyOrEdit(interaction, { content: "No configuration found. Run /gate setup first." });
    return;
  }

  const lines = [
    "**Gate Configuration**",
    "",
    `Review channel: ${cfg.review_channel_id ? `<#${cfg.review_channel_id}>` : "not set"}`,
    `Gate channel: ${cfg.gate_channel_id ? `<#${cfg.gate_channel_id}>` : "not set"}`,
    `General channel: ${cfg.general_channel_id ? `<#${cfg.general_channel_id}>` : "not set"}`,
    `Unverified channel: ${cfg.unverified_channel_id ? `<#${cfg.unverified_channel_id}>` : "not set"}`,
    `Accepted role: ${cfg.accepted_role_id ? `<@&${cfg.accepted_role_id}>` : "not set"}`,
    `Reviewer role: ${cfg.reviewer_role_id ? `<@&${cfg.reviewer_role_id}>` : "not set (uses channel perms)"}`,
    "",
    `Avatar scan enabled: ${cfg.avatar_scan_enabled ? "yes" : "no"}`,
  ];

  await replyOrEdit(interaction, { content: lines.join("\n") });
}

async function executeSetQuestions(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  ctx.step("defer");
  await ensureDeferred(interaction);

  ctx.step("validate_permission");
  if (!(await hasGateAdmin(interaction))) {
    await replyOrEdit(interaction, {
      flags: MessageFlags.Ephemeral,
      content:
        "You need owner/admin privileges to modify gate questions (guild owner, bot owners, configured admin roles, or Manage Server permission).",
    });
    return;
  }

  const guildId = interaction.guildId!;

  ctx.step("parse_input");
  const updates: Array<{ index: number; prompt: string }> = [];
  for (let i = 1; i <= 5; i++) {
    const val = interaction.options.getString(`q${i}`, false);
    if (val && val.trim()) {
      updates.push({ index: i - 1, prompt: val.trim() });
    }
  }

  if (updates.length === 0) {
    ctx.step("load_current");
    const current = getQuestions(guildId).filter(q => q.q_index >= 0 && q.q_index <= 4);
    const preview = current.length > 0
      ? current.map((q, i) => `${i + 1}) ${q.prompt}`).join("\n")
      : "(No questions set)";
    await replyOrEdit(interaction, {
      flags: MessageFlags.Ephemeral,
      content: `No changes provided.\n\n**Current questions:**\n${preview}\n\nTo update, use: \`/gate set-questions q1:"Your question here"\``,
    });
    return;
  }

  ctx.step("upsert_questions");
  const tx = db.transaction(() => {
    for (const u of updates) {
      upsertQuestion(guildId, u.index, u.prompt, 1, ctx);
    }
  });
  tx();

  ctx.step("load_updated");
  const current = getQuestions(guildId).filter(q => q.q_index >= 0 && q.q_index <= 4);
  const updated = updates.map((u) => `q${u.index + 1}`).join(", ");
  const preview = current.length > 0
    ? current.map((q, i) => `${i + 1}) ${q.prompt}`).join("\n")
    : "(No questions)";

  ctx.step("reply");
  await replyOrEdit(interaction, {
    flags: MessageFlags.Ephemeral,
    content: `✅ Updated: **${updated}**\n\n**Current questions:**\n${preview}`,
  });
}

async function executeWelcomeSet(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  ctx.step("defer");
  await ensureDeferred(interaction);

  ctx.step("validate_template");
  const raw = interaction.options.getString("content", true);
  const content = raw.trim();
  if (content.length === 0) {
    await replyOrEdit(interaction, { content: "Template must include some text." });
    return;
  }
  if (content.length > 2000) {
    await replyOrEdit(interaction, { content: "Template is too long (limit 2000 characters)." });
    return;
  }

  ctx.step("persist_template");
  upsertConfig(interaction.guildId!, { welcome_template: content });

  ctx.step("reply");
  await replyOrEdit(interaction, { content: "Welcome template updated." });
}

async function executeWelcomePreview(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  ctx.step("defer");
  await ensureDeferred(interaction);

  const member = interaction.member as GuildMember | null;
  if (!member) {
    await replyOrEdit(interaction, { content: "Preview unavailable (member not resolved)." });
    return;
  }

  ctx.step("load_config");
  const cfg = getConfig(interaction.guildId!);

  ctx.step("render_preview");
  const content = renderWelcomeTemplate({
    template: cfg?.welcome_template ?? null,
    guildName: interaction.guild!.name,
    applicant: {
      id: member.id,
      tag: member.user?.tag ?? member.user.username,
      display: member.displayName,
    },
  });

  ctx.step("reply");
  await replyOrEdit(interaction, { content });
}

async function executeWelcomeChannels(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const infoChannel = interaction.options.getChannel("info_channel");
  const rulesChannel = interaction.options.getChannel("rules_channel");
  const pingRole = interaction.options.getRole("ping_role");

  const updates: Partial<GuildConfig> = {};
  if (infoChannel) updates.info_channel_id = infoChannel.id;
  if (rulesChannel) updates.rules_channel_id = rulesChannel.id;
  if (pingRole) updates.welcome_ping_role_id = pingRole.id;

  if (Object.keys(updates).length === 0) {
    await replyOrEdit(interaction, { content: "No changes specified." });
    return;
  }

  upsertConfig(interaction.guildId!, updates);
  await replyOrEdit(interaction, { content: "Welcome channels updated." });
}

async function executeWelcomeRole(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const role = interaction.options.getRole("role", true);

  upsertConfig(interaction.guildId!, { welcome_ping_role_id: role.id });
  await replyOrEdit(interaction, { content: "Welcome ping role updated." });
}

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  if (!interaction.guildId || !interaction.guild) {
    ctx.step("invalid_scope");
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Guild only." });
    return;
  }

  ctx.step("permission_check");
  if (!requireStaff(interaction)) return;

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  if (!subcommandGroup) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "setup") {
      await executeSetup(ctx);
    } else if (subcommand === "reset") {
      await executeReset(ctx);
    } else if (subcommand === "status") {
      await executeStatus(ctx);
    } else if (subcommand === "config") {
      await executeConfigView(ctx);
    } else if (subcommand === "set-questions") {
      await executeSetQuestions(ctx);
    }
    return;
  }

  if (subcommandGroup === "welcome") {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "set") {
      await executeWelcomeSet(ctx);
    } else if (subcommand === "preview") {
      await executeWelcomePreview(ctx);
    } else if (subcommand === "channels") {
      await executeWelcomeChannels(ctx);
    } else if (subcommand === "role") {
      await executeWelcomeRole(ctx);
    }
  }
}
