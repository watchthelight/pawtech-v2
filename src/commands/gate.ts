/**
 * Pawtropolis Tech — src/commands/gate.ts
 * WHAT: Slash commands for gate management (/gate and helpers) — setup, reset, status, config, accept/reject/kick/unclaim.
 * WHY: Keeps command definitions and handlers close; execution wraps via cmdWrap for consistent behavior.
 * FLOWS:
 *  - /gate setup|reset|status|config|welcome set|welcome preview
 *  - /accept|/reject|/kick|/unclaim by short code (HEX6 human-friendly)
 * DOCS:
 *  - Slash commands (Discord dev docs): https://discord.com/developers/docs/interactions/application-commands
 *  - CommandInteraction: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction
 *  - Interaction replies (flags): https://discord.js.org/#/docs/discord.js/main/typedef/InteractionReplyOptions
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *
 * NOTE: No behavior changes here; comments explain timing/DB bits and HEX6 choices.
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
} from "../lib/config.js";
import { ensureGateEntry } from "../features/gate.js";
import { findAppByShortCode } from "../features/appLookup.js";
import {
  findPendingAppByUserId,
  ensureReviewMessage,
  approveTx,
  approveFlow,
  deliverApprovalDm,
  updateReviewActionMeta,
  renderWelcomeTemplate,
  kickTx,
  kickFlow,
  rejectTx,
  type ApplicationRow,
  rejectFlow,
  getClaim,
  clearClaim,
  CLAIMED_MESSAGE,
  claimGuard,
} from "../features/review.js";
import { postWelcomeCard } from "../features/welcome.js";
import { seedDefaultQuestionsIfEmpty, getQuestions, upsertQuestion } from "../features/gate/questions.js";
import { postGateConfigCard } from "../lib/configCard.js";
import {
  wrapCommand,
  type CommandContext,
  ensureDeferred,
  replyOrEdit,
  withSql,
} from "../lib/cmdWrap.js";
import { db } from "../db/db.js";
import { timingSafeEqual } from "node:crypto";
import { logger } from "../lib/logger.js";
import { env } from "../lib/env.js";

/*
 * Gate Command Architecture Notes:
 * --------------------------------
 * This module is the entry point for guild gating functionality. The actual
 * review workflow lives in features/review.ts - this file just defines slash
 * commands and routes to the appropriate handlers.
 *
 * PERMISSION MODEL:
 * - /gate setup/reset/config: Requires ManageGuild or reviewer_role
 * - /accept /reject /kick: Requires staff (reviewer_role or ManageGuild)
 * - /gate set-questions: Requires gate admin (owner, bot owners, admin roles, or ManageGuild)
 *
 * SHORT CODES (HEX6):
 * Application IDs are UUIDs internally, but we expose 6-char hex codes (e.g., "A1B2C3")
 * to staff for easier verbal communication. The shortCode() function in lib/ids.ts
 * derives these deterministically from the UUID.
 *
 * CLAIM SYSTEM:
 * To prevent two moderators from working on the same app simultaneously, we use
 * a claim system. When a mod starts reviewing, they claim the app. Other mods
 * see "claimed by X" and are blocked from taking action. Claims are released
 * on decision or via /unclaim.
 */
import { closeModmailForApplication } from "../features/modmail.js";
import { shortCode } from "../lib/ids.js";
import type { GuildMember } from "discord.js";

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

/**
 * Constant-time string comparison to prevent timing attacks on password validation.
 *
 * SECURITY: Standard === comparison leaks information via timing differences.
 * An attacker can measure response time to guess characters one by one.
 * timingSafeEqual always takes the same time regardless of where strings differ.
 *
 * The length check happens first (leaking only length info, not content), then
 * the actual byte comparison runs in constant time.
 */
function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function executeSetup(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetup
   * WHAT: Writes initial guild config and posts a config card.
   * WHY: Provides a guided setup path for staff; ephemeral progress via ensureDeferred.
   * PARAMS: ctx — command context; uses ctx.step to label phases.
   * RETURNS: Promise<void> after editReply.
   * THROWS: Exceptions propagate to wrapCommand which posts error cards.
   */
  const { interaction } = ctx;

  // defer early — 3s SLA for first response, keeps UX snappy
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
  const member = interaction.member as GuildMember | null;
  // Check canRunAllCommands first (owner + mod roles), then fall back to hasManageGuild/isReviewer
  // DOCS:
  //  - canRunAllCommands: checks OWNER_IDS and mod_role_ids from guild config
  //  - hasManageGuild: checks ManageGuild permission
  //  - isReviewer: checks reviewer_role_id or review channel visibility
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

  if (!safeEq(password, env.RESET_PASSWORD)) {
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

  /*
   * RESET TRANSACTION:
   * All tables are wiped in a single transaction for atomicity. If any delete
   * fails (except optional tables), the entire reset is rolled back.
   *
   * Optional tables (review_card, avatar_scan, review_claim) may not exist in
   * older schema versions - we silently skip those rather than failing the reset.
   *
   * NOTE: guild_question is wiped separately (outside transaction) because it's
   * scoped to guild_id, while the tables below are global. This is intentional -
   * questions are guild-specific config, not application data.
   */
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

    // one transaction, zero drama
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fakeCtx: CommandContext<ChatInputCommandInteraction> = {
        interaction: interaction as any,
        step: ctx.step,
        currentPhase: ctx.currentPhase,
        setLastSql: ctx.setLastSql,
        getTraceId: ctx.getTraceId,
        traceId: ctx.traceId,
      };
      await ensureGateEntry(fakeCtx, guildId!);
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
    // Aggregates application status counts for this guild; used in /gate status
    .prepare(
      `SELECT status, COUNT(*) as count
       FROM application
       WHERE guild_id = ?
       GROUP BY status`
    )
    .all(guildId) as Array<{ status: string; count: number }>;

  const claimedCount = db
    // Count active claims; useful to see workload
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
  /**
   * executeSetQuestions
   * WHAT: Updates gate questions (q1-q5) via upsert; only provided values change.
   * WHY: Lets admins customize application questions without resetting all data.
   * PARAMS: ctx — command context with interaction containing optional q1..q5 strings.
   * RETURNS: Promise<void> after ephemeral reply showing updated questions.
   * THROWS: Exceptions propagate to wrapCommand which posts error cards.
   */
  const { interaction } = ctx;

  ctx.step("defer");
  await ensureDeferred(interaction);

  ctx.step("validate_permission");
  // Check if user has gate admin permissions (owner, bot owners, admin roles, or ManageGuild)
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
  // Collect provided question updates (q1..q5)
  const updates: Array<{ index: number; prompt: string }> = [];
  for (let i = 1; i <= 5; i++) {
    const val = interaction.options.getString(`q${i}`, false);
    if (val && val.trim()) {
      updates.push({ index: i - 1, prompt: val.trim() });
    }
  }

  // If no options provided, show current questions as helpful hint
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
  // Use transaction for atomicity
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

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  if (!interaction.guildId || !interaction.guild) {
    ctx.step("invalid_scope");
    // Ephemeral reply since this is a permission/scope problem; reply within 3s.
    // docs: https://discord.com/developers/docs/interactions/receiving-and-responding
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

/*
 * ACCEPT/REJECT/KICK COMMANDS
 * ---------------------------
 * These are registered as separate top-level slash commands (not /gate subcommands)
 * for ergonomics - moderators use them frequently and /accept is faster to type
 * than /gate accept.
 *
 * Both support lookup by:
 *   - app: 6-char hex short code (verbal-friendly, e.g., "A1B2C3")
 *   - uid: Discord user ID (18-digit snowflake)
 *
 * The uid option exists because sometimes you need to find someone's app by their
 * Discord profile, especially when they DM asking about their application status.
 */
export const acceptData = new SlashCommandBuilder()
  .setName("accept")
  .setDescription("Approve an application by short code or Discord user ID")
  .addStringOption((option) =>
    option.setName("app").setDescription("Application short code (e.g., A1B2C3)").setRequired(false)
  )
  .addStringOption((option) =>
    option.setName("uid").setDescription("Discord User ID to accept").setRequired(false)
  )
  .setDMPermission(false);

export async function executeAccept(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeAccept
   * WHAT: Staff approves an application by HEX6 short code or Discord UID.
   * WHY: Faster than navigating the review card in some cases.
   * RETURNS: Ephemeral confirmation and optional welcome posting result.
   * LINKS: Modal/Buttons are handled in features/review.ts; this is slash-only.
   */
  const { interaction } = ctx;
  if (!interaction.guildId || !interaction.guild) {
    await replyOrEdit(interaction, { content: "Guild only." });
    return;
  }
  if (!requireStaff(interaction)) return;

  ctx.step("defer");
  await ensureDeferred(interaction);

  const codeRaw = interaction.options.getString("app", false);
  const uidRaw = interaction.options.getString("uid", false);

  // Validate: exactly one must be provided
  if (!codeRaw && !uidRaw) {
    await replyOrEdit(interaction, {
      content: "Please provide either `app` (short code) or `uid` (Discord User ID).",
    });
    return;
  }
  if (codeRaw && uidRaw) {
    await replyOrEdit(interaction, {
      content: "Please provide only one: either `app` or `uid`, not both.",
    });
    return;
  }

  ctx.step("lookup_app");
  let app: ApplicationRow | null = null;
  if (codeRaw) {
    const code = codeRaw.trim().toUpperCase();
    app = findAppByShortCode(interaction.guildId, code);
    if (!app) {
      await replyOrEdit(interaction, { content: `No application with code ${code}.` });
      return;
    }
  } else if (uidRaw) {
    const uid = uidRaw.trim();
    // Validate UID format
    if (!/^[0-9]{5,20}$/.test(uid)) {
      await replyOrEdit(interaction, { content: "Invalid user ID. Must be 5-20 digits." });
      return;
    }
    app = findPendingAppByUserId(interaction.guildId, uid);
    if (!app) {
      await replyOrEdit(interaction, {
        content: `No pending application found for user ID ${uid}.`,
      });
      return;
    }
  }

  // At this point app is guaranteed to be non-null due to early return above
  const resolvedApp = app!;

  ctx.step("claim_check");
  // deny politely; chaos later is worse
  const claim = getClaim(resolvedApp.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError });
    return;
  }

  ctx.step("approve_tx");
  const result = approveTx(resolvedApp.id, interaction.user.id);
  if (result.kind === "already") {
    await replyOrEdit(interaction, { content: "Already approved." });
    return;
  }
  if (result.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${result.status}).` });
    return;
  }
  if (result.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application is not ready for approval." });
    return;
  }

  ctx.step("approve_flow");
  const cfg = getConfig(interaction.guildId);
  let approvedMember: GuildMember | null = null;
  let roleApplied = false;
  let roleError: { code?: number; message?: string } | null = null;
  if (cfg) {
    /*
     * approveFlow handles the Discord side: fetching the member and applying
     * the accepted_role. It returns roleError if the bot lacks permissions
     * (error code 50013) or the role is higher in hierarchy than the bot's role.
     *
     * We proceed even if role assignment fails - the app is marked approved in
     * the database, and we report the failure to the reviewer so they can fix
     * permissions or assign the role manually.
     */
    const flow = await approveFlow(interaction.guild, resolvedApp.user_id, cfg);
    approvedMember = flow.member;
    roleApplied = flow.roleApplied;
    roleError = flow.roleError ?? null;
  }
  clearClaim(resolvedApp.id);

  ctx.step("close_modmail");
  const code = shortCode(resolvedApp.id);
  try {
    await closeModmailForApplication(interaction.guildId, resolvedApp.user_id, code, {
      reason: "approved",
      client: interaction.client,
      guild: interaction.guild,
    });
  } catch (mmErr) {
    logger.warn({ err: mmErr, appId: resolvedApp.id }, "[accept] Failed to close modmail (non-fatal)");
  }

  ctx.step("refresh_review");
  try {
    await ensureReviewMessage(interaction.client, resolvedApp.id);
  } catch (err) {
    logger.warn({ err, appId: resolvedApp.id }, "Failed to refresh review card after /accept");
  }

  ctx.step("dm_and_welcome");
  let dmDelivered = false;
  if (approvedMember) {
    dmDelivered = await deliverApprovalDm(approvedMember, interaction.guild.name);
  }

  let welcomeNote: string | null = null;
  let roleNote: string | null = null;
  if (cfg && approvedMember && (cfg.accepted_role_id ? roleApplied : true)) {
    try {
      await postWelcomeCard({
        guild: interaction.guild,
        user: approvedMember,
        config: cfg,
        memberCount: interaction.guild.memberCount,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "unknown error";
      logger.warn(
        { err, guildId: interaction.guildId, userId: approvedMember.id },
        "[accept] failed to post welcome card"
      );
      if (errorMessage.includes("not configured")) {
        welcomeNote = "Welcome message failed: general channel not configured.";
      } else if (errorMessage.includes("missing permissions")) {
        const channelMention = cfg.general_channel_id
          ? `<#${cfg.general_channel_id}>`
          : "the channel";
        welcomeNote = `Welcome message failed: missing permissions in ${channelMention}.`;
      } else {
        welcomeNote = `Welcome message failed: ${errorMessage}`;
      }
    }
  } else if (!cfg?.general_channel_id) {
    welcomeNote = "Welcome message not posted: general channel not configured.";
  }

  updateReviewActionMeta(result.reviewActionId, {
    roleApplied,
    dmDelivered,
    source: "slash",
    via: uidRaw ? "uid" : "code",
  });

  ctx.step("reply");
  const messages = ["Application approved."];
  if (cfg?.accepted_role_id && roleError) {
    const roleMention = `<@&${cfg.accepted_role_id}>`;
    if (roleError.code === 50013) {
      roleNote = `Failed to grant verification role ${roleMention} (missing permissions).`;
    } else {
      const reason = roleError.message ?? "unknown error";
      roleNote = `Failed to grant verification role ${roleMention}: ${reason}.`;
    }
  }
  if (roleNote) messages.push(roleNote);
  if (welcomeNote) messages.push(welcomeNote);
  await replyOrEdit(interaction, { content: messages.join("\n") });
}

export const rejectData = new SlashCommandBuilder()
  .setName("reject")
  .setDescription("Reject an application by short code or Discord user ID")
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Reason for rejection (max 500 chars)")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option.setName("app").setDescription("Application short code (e.g., A1B2C3)").setRequired(false)
  )
  .addStringOption((option) =>
    option.setName("uid").setDescription("Discord User ID to reject").setRequired(false)
  )
  .addBooleanOption((option) =>
    option.setName("perm").setDescription("Permanently reject (can't re-apply)").setRequired(false)
  )
  .setDMPermission(false);

export async function executeReject(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeReject
   * WHAT: Staff rejects an application by HEX6 short code or Discord UID with a reason.
   * WHY: Supports both workflow types; optional permanent rejection.
   * PITFALLS: DMs can fail; we annotate the review action meta accordingly.
   */
  const { interaction } = ctx;
  if (!interaction.guildId || !interaction.guild) {
    await replyOrEdit(interaction, { content: "Guild only." });
    return;
  }
  if (!requireStaff(interaction)) return;

  ctx.step("defer");
  await ensureDeferred(interaction);

  const codeRaw = interaction.options.getString("app", false);
  const uidRaw = interaction.options.getString("uid", false);
  const reasonRaw = interaction.options.getString("reason", true);
  const permanent = interaction.options.getBoolean("perm", false) ?? false;

  // Validate: exactly one of app or uid must be provided
  if (!codeRaw && !uidRaw) {
    await replyOrEdit(interaction, {
      content: "Please provide either `app` (short code) or `uid` (Discord User ID).",
    });
    return;
  }
  if (codeRaw && uidRaw) {
    await replyOrEdit(interaction, {
      content: "Please provide only one: either `app` or `uid`, not both.",
    });
    return;
  }

  const reason = reasonRaw.trim().slice(0, 500);
  if (reason.length === 0) {
    await replyOrEdit(interaction, { content: "Reason is required." });
    return;
  }

  ctx.step("lookup_app");
  let app: ApplicationRow | null = null;
  if (codeRaw) {
    const code = codeRaw.trim().toUpperCase();
    app = findAppByShortCode(interaction.guildId, code);
    if (!app) {
      await replyOrEdit(interaction, { content: `No application with code ${code}.` });
      return;
    }
  } else if (uidRaw) {
    const uid = uidRaw.trim();
    // Validate UID format
    if (!/^[0-9]{5,20}$/.test(uid)) {
      await replyOrEdit(interaction, { content: "Invalid user ID. Must be 5-20 digits." });
      return;
    }
    app = findPendingAppByUserId(interaction.guildId, uid);
    if (!app) {
      await replyOrEdit(interaction, {
        content: `No pending application found for user ID ${uid}.`,
      });
      return;
    }
  }

  // At this point app is guaranteed to be non-null due to early return above
  const resolvedApp = app!;

  ctx.step("claim_check");
  const claim = getClaim(resolvedApp.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError });
    return;
  }

  ctx.step("reject_tx");
  const tx = rejectTx(resolvedApp.id, interaction.user.id, reason, permanent);
  if (tx.kind === "already") {
    await replyOrEdit(interaction, { content: "Already rejected." });
    return;
  }
  if (tx.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${tx.status}).` });
    return;
  }
  if (tx.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application not submitted yet." });
    return;
  }

  ctx.step("reject_flow");
  const user = await interaction.client.users.fetch(resolvedApp.user_id).catch(() => null);
  let dmDelivered = false;
  if (user) {
    const dmResult = await rejectFlow(user, {
      guildName: interaction.guild.name,
      reason,
      permanent,
    });
    dmDelivered = dmResult.dmDelivered;
    updateReviewActionMeta(tx.reviewActionId, {
      ...dmResult,
      source: "slash",
      via: uidRaw ? "uid" : "code",
    });
  } else {
    logger.warn({ userId: resolvedApp.user_id }, "Failed to fetch user for rejection DM");
    updateReviewActionMeta(tx.reviewActionId, {
      dmDelivered,
      source: "slash",
      via: uidRaw ? "uid" : "code",
    });
  }

  clearClaim(resolvedApp.id);

  ctx.step("close_modmail");
  const code = shortCode(resolvedApp.id);
  try {
    await closeModmailForApplication(interaction.guildId, resolvedApp.user_id, code, {
      reason: permanent ? "permanently rejected" : "rejected",
      client: interaction.client,
      guild: interaction.guild,
    });
  } catch (mmErr) {
    logger.warn({ err: mmErr, appId: resolvedApp.id }, "[reject] Failed to close modmail (non-fatal)");
  }

  ctx.step("refresh_review");
  try {
    await ensureReviewMessage(interaction.client, resolvedApp.id);
  } catch (err) {
    logger.warn({ err, appId: resolvedApp.id }, "Failed to refresh review card after /reject");
  }

  ctx.step("reply");
  const rejectType = permanent ? "permanently rejected" : "rejected";
  await replyOrEdit(interaction, {
    content: dmDelivered
      ? `Application ${rejectType}.`
      : `Application ${rejectType}. (DM delivery failed)`,
  });
}

export const kickData = new SlashCommandBuilder()
  .setName("kick")
  .setDescription("Kick an applicant by short code")
  .addStringOption((option) =>
    option.setName("app").setDescription("Application short code (e.g., A1B2C3)").setRequired(true)
  )
  .addStringOption((option) =>
    option.setName("reason").setDescription("Reason for kick").setRequired(true)
  )
  .setDMPermission(false);

export async function executeKick(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeKick
   * WHAT: Staff kicks a user by short code with a reason (records review_action and attempts DM + kick).
   * PITFALLS: Role/permission hierarchy may block kicks (50013); we fail-soft and log.
   */
  const { interaction } = ctx;
  if (!interaction.guildId || !interaction.guild) {
    await replyOrEdit(interaction, { content: "Guild only." });
    return;
  }
  if (!requireStaff(interaction)) return;

  ctx.step("defer");
  await ensureDeferred(interaction);

  const code = interaction.options.getString("app", true).trim().toUpperCase();
  const reason = interaction.options.getString("reason", true).trim();

  ctx.step("lookup_app");
  const app = findAppByShortCode(interaction.guildId, code);
  if (!app) {
    await replyOrEdit(interaction, { content: `No application with code ${code}.` });
    return;
  }

  ctx.step("claim_check");
  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError });
    return;
  }

  ctx.step("kick_tx");
  const tx = kickTx(app.id, interaction.user.id, reason.length > 0 ? reason : null);
  if (tx.kind === "already") {
    await replyOrEdit(interaction, { content: "Already kicked." });
    return;
  }
  if (tx.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${tx.status}).` });
    return;
  }
  if (tx.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application not in a kickable state." });
    return;
  }

  ctx.step("kick_flow");
  const flow = await kickFlow(interaction.guild, app.user_id, reason.length > 0 ? reason : null);
  updateReviewActionMeta(tx.reviewActionId, flow);

  clearClaim(app.id);

  ctx.step("refresh_review");
  try {
    await ensureReviewMessage(interaction.client, app.id);
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after /kick");
  }

  // Build user-friendly response based on kick result
  let message: string;
  if (flow.kickSucceeded) {
    message = flow.dmDelivered
      ? "Member kicked and notified via DM."
      : "Member kicked (DM delivery failed, user may have DMs disabled).";
  } else if (flow.error) {
    // Provide specific error context to staff
    message = `Kick failed: ${flow.error}`;
  } else {
    message = "Kick attempted; check logs for details.";
  }

  ctx.step("reply");
  await replyOrEdit(interaction, { content: message });
}

export const unclaimData = new SlashCommandBuilder()
  .setName("unclaim")
  .setDescription("Release a claim on an application")
  .addStringOption((option) =>
    option.setName("app").setDescription("Application short code (e.g., A1B2C3)").setRequired(true)
  )
  .setDMPermission(false);

export async function executeUnclaim(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeUnclaim
   * WHAT: Releases a claim on an application, if the caller is the claimer.
   * WHY: Prevents stalemates; enforced via claimGuard.
   */
  const { interaction } = ctx;
  if (!interaction.guildId || !interaction.guild) {
    await replyOrEdit(interaction, { content: "Guild only." });
    return;
  }
  if (!requireStaff(interaction)) return;

  ctx.step("defer");
  await ensureDeferred(interaction);

  const code = interaction.options.getString("app", true).trim().toUpperCase();

  ctx.step("lookup_app");
  const app = findAppByShortCode(interaction.guildId, code);
  if (!app) {
    await replyOrEdit(interaction, { content: `No application with code ${code}.` });
    return;
  }

  ctx.step("claim_fetch");
  const claim = getClaim(app.id);
  if (!claim) {
    await replyOrEdit(interaction, { content: "This application is not currently claimed." });
    return;
  }

  // claim ≠ forever. use /unclaim like an adult
  if (claim.reviewer_id !== interaction.user.id) {
    await replyOrEdit(interaction, { content: CLAIMED_MESSAGE(claim.reviewer_id) });
    return;
  }

  ctx.step("clear_claim");
  clearClaim(app.id);

  ctx.step("refresh_review");
  try {
    await ensureReviewMessage(interaction.client, app.id);
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after /unclaim");
  }

  ctx.step("reply");
  await replyOrEdit(interaction, { content: "Claim removed." });
}
