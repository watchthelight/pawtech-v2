1; /**
 * Pawtropolis Tech — src/features/gate.ts
 * WHAT: Gate entry UX (Start button + modal pages), draft persistence, submission, and optional avatar scan queueing.
 * WHY: Keeps applicant-facing interactions and staff review linkage in one module.
 * FLOWS:
 *  - Start button: find/create draft → open modal for requested page
 *  - Modal submit: defer → validate → persist answers → maybe submit → refresh review card → reply
 *  - Submission: enqueue avatar scan (non-blocking) → notify user
 * DOCS:
 *  - CommandInteractions: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction
 *  - Interaction response rules: https://discord.com/developers/docs/interactions/receiving-and-responding
 *  - Interaction reply options/flags: https://discord.js.org/#/docs/discord.js/main/typedef/InteractionReplyOptions
 *  - better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - SQLite UPSERT: https://sqlite.org/lang_UPSERT.html
 *
 * NOTE: Ephemeral replies keep channels clean; we only post public content where intentional.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type GuildTextBasedChannel,
  type User,
  type Message,
} from "discord.js";
import type { Database as BetterSqliteDatabase } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { captureException, addBreadcrumb } from "../lib/sentry.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { shortCode } from "../lib/ids.js";
import { getConfig, type GuildConfig } from "../lib/config.js";
import { ensureReviewMessage } from "./review.js";
import { scanAvatar, type ScanResult } from "./avatarScan.js";
import type { CmdCtx } from "../lib/cmdWrap.js";
import { currentTraceId, ensureDeferred, replyOrEdit, withSql } from "../lib/cmdWrap.js";
import { logActionPretty } from "../logging/pretty.js";
import { getQuestions as getQuestionsShared } from "./gate/questions.js";

const ANSWER_MAX_LENGTH = 1000;
const INPUT_MAX_LENGTH = 1000;
const LABEL_MAX_LENGTH = 45;
const PLACEHOLDER_MAX_LENGTH = 100;
const BRAND_COLOR = 0x22ccaa;
const GATE_ENTRY_FOOTER = "If you're having issues DM an online moderator.";
const GATE_ENTRY_FOOTER_MATCHES = new Set([GATE_ENTRY_FOOTER, "GateEntry v1"]);

// schema is now application_id, edge_score (no legacy columns)

type GateQuestion = {
  q_index: number;
  prompt: string;
  required: boolean;
};

type QuestionPage = {
  pageIndex: number;
  questions: GateQuestion[];
};

export type EnsureGateEntryResult = {
  created: boolean;
  edited: boolean;
  pinned: boolean;
  channelId?: string;
  messageId?: string;
  reason?: string;
};

function getQuestions(guildId: string): GateQuestion[] {
  const rows = getQuestionsShared(guildId);

  if (rows.length === 0) {
    logger.info(
      {
        evt: "gate_questions_empty",
        guildId,
      },
      `[gate] 0 questions for guild=${guildId}. Insert rows into guild_question for this guild.`
    );
  }

  return rows.map((row) => ({
    q_index: row.q_index,
    prompt: row.prompt,
    required: row.required === 1,
  }));
}

function paginate(questions: GateQuestion[], pageSize = 5): QuestionPage[] {
  if (pageSize <= 0) throw new Error("pageSize must be positive");
  const pages: QuestionPage[] = [];
  for (let i = 0; i < questions.length; i += pageSize) {
    const slice = questions.slice(i, i + pageSize);
    pages.push({ pageIndex: pages.length, questions: slice });
  }
  return pages;
}

function buildModalForPage(
  page: QuestionPage,
  draftAnswersMap: Map<number, string>,
  appId: string
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:${appId}:p${page.pageIndex}`)
    .setTitle(`Gate Entry - Page ${page.pageIndex + 1}`);

  const rows = page.questions.map((question) => {
    const label =
      question.prompt.length > LABEL_MAX_LENGTH
        ? `${question.prompt.slice(0, LABEL_MAX_LENGTH - 3)}...`
        : question.prompt || `Question ${question.q_index + 1}`;
    const placeholder =
      question.prompt.length > PLACEHOLDER_MAX_LENGTH
        ? question.prompt.slice(0, PLACEHOLDER_MAX_LENGTH)
        : question.prompt;
    const input = new TextInputBuilder()
      .setCustomId(`v1:q:${question.q_index}`)
      .setLabel(label)
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(INPUT_MAX_LENGTH)
      .setRequired(question.required);
    if (placeholder) {
      input.setPlaceholder(placeholder);
    }
    const existing = draftAnswersMap.get(question.q_index);
    if (existing) {
      input.setValue(existing.slice(0, INPUT_MAX_LENGTH));
    }
    return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  });
  if (rows.length === 0) {
    throw new Error("Cannot build modal without inputs");
  }
  modal.addComponents(...rows);
  return modal;
}

function getOrCreateDraft(db: BetterSqliteDatabase, guildId: string, userId: string) {
  // Check if user is permanently rejected
  const permReject = db
    .prepare(
      `SELECT permanently_rejected FROM application WHERE guild_id = ? AND user_id = ? AND permanently_rejected = 1 LIMIT 1`
    )
    .get(guildId, userId) as { permanently_rejected: number } | undefined;
  if (permReject) {
    throw new Error("User is permanently rejected");
  }

  const existing = db
    .prepare(`SELECT id FROM application WHERE guild_id = ? AND user_id = ? AND status = 'draft'`)
    .get(guildId, userId) as { id: string } | undefined;
  if (existing) return { application_id: existing.id };

  const active = db
    .prepare(
      `SELECT id, status FROM application WHERE guild_id = ? AND user_id = ? AND status IN ('submitted','needs_info')`
    )
    .get(guildId, userId) as { id: string; status: string } | undefined;
  if (active) {
    throw new Error("Active application already submitted");
  }

  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO application (id, guild_id, user_id, status)
      VALUES (?, ?, ?, 'draft')
    `
  ).run(id, guildId, userId);
  return { application_id: id };
}

function getDraft(db: BetterSqliteDatabase, appId: string, ctx?: CmdCtx) {
  const selectAppSql = `SELECT id, guild_id, user_id, status FROM application WHERE id = ?`;
  const app = (
    ctx
      ? withSql(ctx, selectAppSql, () => db.prepare(selectAppSql).get(appId))
      : db.prepare(selectAppSql).get(appId)
  ) as { id: string; guild_id: string; user_id: string; status: string } | undefined;
  if (!app) return undefined;
  const selectResponsesSql = `
        SELECT q_index, answer
        FROM application_response
        WHERE app_id = ?
      `;
  const responses = (
    ctx
      ? withSql(ctx, selectResponsesSql, () => db.prepare(selectResponsesSql).all(appId))
      : db.prepare(selectResponsesSql).all(appId)
  ) as Array<{ q_index: number; answer: string }>;
  return { application: app, responses };
}

function upsertAnswer(
  db: BetterSqliteDatabase,
  appId: string,
  q_index: number,
  value: string,
  ctx?: CmdCtx
) {
  const selectGuildSql = `SELECT guild_id FROM application WHERE id = ?`;
  const app = (
    ctx
      ? withSql(ctx, selectGuildSql, () => db.prepare(selectGuildSql).get(appId))
      : db.prepare(selectGuildSql).get(appId)
  ) as { guild_id: string } | undefined;
  if (!app) throw new Error("Draft not found");

  const selectQuestionSql = `
        SELECT prompt
        FROM guild_question
        WHERE guild_id = ? AND q_index = ?
      `;
  const question = (
    ctx
      ? withSql(ctx, selectQuestionSql, () =>
          db.prepare(selectQuestionSql).get(app.guild_id, q_index)
        )
      : db.prepare(selectQuestionSql).get(app.guild_id, q_index)
  ) as { prompt: string } | undefined;
  if (!question) throw new Error("Question not found");

  const trimmed = value.length > ANSWER_MAX_LENGTH ? value.slice(0, ANSWER_MAX_LENGTH) : value;

  const upsertSql = `
      INSERT INTO application_response (app_id, q_index, question, answer, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(app_id, q_index) DO UPDATE SET
        question = excluded.question,
        answer = excluded.answer,
        created_at = datetime('now')
    `;
  if (ctx) {
    withSql(ctx, upsertSql, () =>
      db.prepare(upsertSql).run(appId, q_index, question.prompt, trimmed)
    );
  } else {
    db.prepare(upsertSql).run(appId, q_index, question.prompt, trimmed);
  }
}

function submitApplication(db: BetterSqliteDatabase, appId: string, ctx?: CmdCtx) {
  const submitSql = `
      UPDATE application
      SET status = 'submitted',
          submitted_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ? AND status = 'draft'
    `;
  const result = ctx
    ? withSql(ctx, submitSql, () => db.prepare(submitSql).run(appId))
    : db.prepare(submitSql).run(appId);
  if (result.changes === 0) {
    throw new Error("No draft to submit");
  }
}

function upsertScan(
  applicationId: string,
  data: {
    avatarUrl: string;
    nsfwScore: number | null;
    edgeScore: number;
    finalPct: number;
    furryScore: number;
    scalieScore: number;
    reason: ScanResult["reason"];
    evidence: ScanResult["evidence"];
  }
) {
  const evidenceHard = data.evidence.hard.length ? JSON.stringify(data.evidence.hard) : null;
  const evidenceSoft = data.evidence.soft.length ? JSON.stringify(data.evidence.soft) : null;
  const evidenceSafe = data.evidence.safe.length ? JSON.stringify(data.evidence.safe) : null;

  // upsert avatar_scan keyed by application_id (UNIQUE index ux_avatar_scan_application):
  // ON CONFLICT updates scores + timestamps; synchronous better-sqlite3 call.
  // sqlite docs: https://sqlite.org/lang_UPSERT.html
  db.prepare(
    `
    INSERT INTO avatar_scan (application_id, avatar_url, nsfw_score, edge_score, final_pct, furry_score, scalie_score, reason, evidence_hard, evidence_soft, evidence_safe, scanned_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), unixepoch())
    ON CONFLICT(application_id) DO UPDATE SET
      avatar_url = excluded.avatar_url,
      nsfw_score = excluded.nsfw_score,
      edge_score = excluded.edge_score,
      final_pct = excluded.final_pct,
      furry_score = excluded.furry_score,
      scalie_score = excluded.scalie_score,
      reason = excluded.reason,
      evidence_hard = excluded.evidence_hard,
      evidence_soft = excluded.evidence_soft,
      evidence_safe = excluded.evidence_safe,
      scanned_at = excluded.scanned_at,
      updated_at = excluded.updated_at
  `
  ).run(
    applicationId,
    data.avatarUrl,
    data.nsfwScore,
    data.edgeScore,
    data.finalPct,
    data.furryScore,
    data.scalieScore,
    data.reason,
    evidenceHard,
    evidenceSoft,
    evidenceSafe
  );
}

async function waitForReviewCardMapping(
  appId: string,
  timeoutMs = 5000,
  pollMs = 200
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = db
      .prepare(
        `
        SELECT message_id
        FROM review_card
        WHERE app_id = ?
      `
      )
      .get(appId) as { message_id: string | null } | undefined;

    if (row && typeof row.message_id === "string" && row.message_id.length > 0) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

function queueAvatarScan(params: {
  appId: string;
  user: User;
  cfg: GuildConfig;
  client: Client;
  parentTraceId?: string | null;
}) {
  const { appId, user, cfg, client, parentTraceId } = params;
  const fallbackAvatarUrl = user.displayAvatarURL({
    extension: "png",
    forceStatic: true,
    size: 512,
  });
  const baseLog = {
    evt: "avatar_scan_job",
    appId,
    userId: user.id,
    parentTraceId: parentTraceId ?? null,
  };

  setImmediate(() => {
    (async () => {
      logger.info({ ...baseLog, phase: "start" }, "[avatarScan] job queued");

      let result: ScanResult | null = null;
      try {
        result = await scanAvatar(user, {
          nsfwThreshold: cfg.avatar_scan_nsfw_threshold ?? 0.6,
          edgeThreshold: cfg.avatar_scan_skin_edge_threshold ?? 0.18,
          wModel: cfg.avatar_scan_weight_model ?? 0.7,
          wEdge: cfg.avatar_scan_weight_edge ?? 0.3,
          traceId: parentTraceId ?? null,
        });
      } catch (err) {
        logger.warn({ ...baseLog, phase: "scan_failed", err }, "[avatarScan] scan threw");
      }

      const avatarUrl = result?.avatarUrl ?? fallbackAvatarUrl;
      if (!avatarUrl) {
        logger.warn(
          { ...baseLog, phase: "no_avatar_url" },
          "[avatarScan] unable to resolve avatar URL"
        );
        return;
      }

      const nsfwScore = result?.nsfwScore ?? null;
      const edgeScore = result?.edgeScore ?? 0;
      const finalPct = result?.finalPct ?? 0;
      const reason = result?.reason ?? "none";
      const furryScore = result?.furryScore ?? 0;
      const scalieScore = result?.scalieScore ?? 0;
      const evidence = result?.evidence ?? { hard: [], soft: [], safe: [] };

      try {
        upsertScan(appId, {
          avatarUrl,
          nsfwScore,
          edgeScore,
          finalPct,
          furryScore,
          scalieScore,
          reason,
          evidence,
        });
        logger.info(
          {
            ...baseLog,
            phase: "stored",
            finalPct,
            reason,
            nsfwScore,
            edgeScore,
            furryScore,
            scalieScore,
          },
          "[avatarScan] job stored result"
        );
      } catch (err) {
        logger.warn(
          { ...baseLog, phase: "store_failed", err },
          "[avatarScan] failed to persist scan result"
        );
        return;
      }

      try {
        const cardReady = await waitForReviewCardMapping(appId, 5000);
        if (!cardReady) {
          logger.info(
            { ...baseLog, phase: "card_pending" },
            "[avatarScan] review card not yet available; proceeding to refresh"
          );
        }
        await ensureReviewMessage(client, appId);
        logger.info({ ...baseLog, phase: "card_refreshed" }, "[avatarScan] review card refreshed");
      } catch (err) {
        logger.warn(
          { ...baseLog, phase: "card_refresh_failed", err },
          "[avatarScan] failed to refresh review card"
        );
      }
    })().catch((err) => {
      logger.error({ ...baseLog, phase: "crash", err }, "[avatarScan] job crashed");
    });
  });
}

function parsePage(customId: string): number {
  const match = customId.match(/^v1:start(?::p(\d+))?/);
  if (match && match[1]) return Number.parseInt(match[1], 10);
  return 0;
}

function toAnswerMap(responses: Array<{ q_index: number; answer: string }>) {
  return new Map(responses.map((row) => [row.q_index, row.answer] as const));
}

function buildNavRow(pageIndex: number, pageCount: number) {
  const buttons: ButtonBuilder[] = [];
  if (pageCount > 1 && pageIndex > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`v1:start:p${pageIndex - 1}`)
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (pageIndex < pageCount - 1) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`v1:start:p${pageIndex + 1}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (buttons.length === 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`v1:start:p${pageIndex}`)
        .setLabel("Retry")
        .setStyle(ButtonStyle.Primary)
    );
  }
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
}

function buildFixRow(pageIndex: number) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`v1:start:p${pageIndex}`)
        .setLabel(`Go to page ${pageIndex + 1}`)
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

function buildDoneRow() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("v1:done").setLabel("Done").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

type GateEntryPayload = {
  embeds: Array<EmbedBuilder>;
  components: Array<ActionRowBuilder<ButtonBuilder>>;
  files: Array<AttachmentBuilder>;
};

type GateEntryContent = {
  title: string;
  description: string;
  buttonLabel: string;
  bannerPath: string;
  bannerName: string;
};

type GateEntryContentOptions = {
  guildName: string;
  config?: GuildConfig | null;
};

function resolveGateEntryContent(options: GateEntryContentOptions): GateEntryContent {
  const { guildName } = options;
  return {
    title: `Welcome to ${guildName}`,
    description:
      "Before you enjoy your stay, you must go through our verification system which you can start by clicking **Verify** and answering 5 simple questions.",
    buttonLabel: "Verify",
    bannerPath: "./assets/banner.webp",
    bannerName: "banner.webp",
  };
}

export function buildGateEntryPayload(options: {
  guild: Guild;
  config?: GuildConfig | null;
}): GateEntryPayload {
  const { guild } = options;
  const content = resolveGateEntryContent({ guildName: guild.name, config: options.config });
  const banner = new AttachmentBuilder(path.resolve(content.bannerPath)).setName(
    content.bannerName
  );

  const embed = new EmbedBuilder()
    .setTitle(content.title)
    .setDescription(content.description)
    .setColor(BRAND_COLOR)
    .setImage(`attachment://${content.bannerName}`)
    .setFooter({ text: GATE_ENTRY_FOOTER });

  const iconUrl = typeof guild.iconURL === "function" ? guild.iconURL({ size: 128 }) : null;
  if (iconUrl) {
    embed.setThumbnail(iconUrl);
  }

  const components = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("v1:start")
        .setLabel(content.buttonLabel)
        .setStyle(ButtonStyle.Success)
    ),
  ];

  return { embeds: [embed], components, files: [banner] };
}

function messageHasStartButton(message: Message) {
  return message.components.some((row) => {
    if (!("components" in row)) return false;
    return row.components?.some(
      (component: any) =>
        component.type === ComponentType.Button && component.customId === "v1:start"
    );
  });
}

function messageHasGateFooter(message: Message) {
  return message.embeds.some((embed) => {
    const footer = embed.footer?.text ?? null;
    return footer ? GATE_ENTRY_FOOTER_MATCHES.has(footer) : false;
  });
}

function isGateEntryCandidate(message: Message, botId: string | null) {
  if (botId && message.author?.id !== botId) return false;
  return messageHasStartButton(message) && messageHasGateFooter(message);
}

async function findExistingGateEntry(channel: GuildTextBasedChannel, botId: string | null) {
  const pinned = await channel.messages.fetchPinned().catch(() => null);
  if (pinned) {
    for (const pinnedMessage of pinned.values()) {
      if (isGateEntryCandidate(pinnedMessage, botId)) return pinnedMessage;
    }
  }

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (recent) {
    for (const candidate of recent.values()) {
      if (isGateEntryCandidate(candidate, botId)) return candidate;
    }
  }

  return null;
}

function logPhase(ctx: CmdCtx, phase: string, extras: Record<string, unknown> = {}) {
  logger.info({
    evt: "gate_entry_step",
    traceId: currentTraceId(ctx),
    phase,
    ...extras,
  });
}

function markSkippedPhase(ctx: CmdCtx, phase: string, extras: Record<string, unknown> = {}) {
  ctx.step(phase);
  logPhase(ctx, phase, { skipped: true, ...extras });
}

/**
 * ensureGateEntry
 * WHAT: Ensures there is a pinned Gate Entry message with a Start button in the configured gate channel.
 * WHY: Applicants need a stable entry point; we refresh/edit/pin instead of duplicating.
 * PARAMS:
 *  - ctx: CommandContext for logging/tracing.
 *  - guildId: Target guild id.
 * RETURNS: EnsureGateEntryResult describing what happened (created/edited/pinned).
 * THROWS: Propagates errors; callers typically log and continue.
 * LINKS:
 *  - Guild text channels API: https://discord.js.org/#/docs/discord.js/main/class/GuildTextBasedChannel
 * PITFALLS:
 *  - Requires SendMessages/ManageMessages to pin; fail-soft when missing permissions.
 */
export async function ensureGateEntry(
  ctx: CmdCtx,
  guildId: string
): Promise<EnsureGateEntryResult> {
  const result: EnsureGateEntryResult = { created: false, edited: false, pinned: false };

  ctx.step("load_config");
  const cfg = getConfig(guildId);
  logPhase(ctx, "load_config", { guildId, hasGateChannel: Boolean(cfg?.gate_channel_id) });
  if (!cfg?.gate_channel_id) {
    markSkippedPhase(ctx, "open_channel", { guildId, reason: "gate channel not configured" });
    markSkippedPhase(ctx, "find_existing", { reason: "gate channel not configured" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "gate channel not configured" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "gate channel not configured" });
    result.reason = "gate channel not configured";
    return result;
  }

  let channel: GuildTextBasedChannel | null = null;
  ctx.step("open_channel");
  try {
    const fetched = await ctx.interaction.client.channels.fetch(cfg.gate_channel_id);
    if (fetched && fetched.isTextBased() && !fetched.isDMBased()) {
      channel = fetched as GuildTextBasedChannel;
    }
  } catch (err) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: cfg.gate_channel_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (!channel) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: cfg.gate_channel_id,
      reason: "channel unavailable",
    });
    markSkippedPhase(ctx, "find_existing", { reason: "channel unavailable" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "channel unavailable" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "channel unavailable" });
    result.reason = "gate channel unavailable";
    return result;
  }

  result.channelId = channel.id;

  const botId = ctx.interaction.client.user?.id ?? null;
  const me =
    channel.guild.members.me ??
    (botId ? await channel.guild.members.fetch(botId).catch(() => null) : null);
  if (!me) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: channel.id,
      reason: "bot member missing",
    });
    markSkippedPhase(ctx, "find_existing", { reason: "bot member missing" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "bot member missing" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "bot member missing" });
    result.reason = "bot member missing";
    return result;
  }

  const perms = channel.permissionsFor(me);
  if (!perms) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: channel.id,
      reason: "permissions unavailable",
    });
    markSkippedPhase(ctx, "find_existing", { reason: "permissions unavailable" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "permissions unavailable" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "permissions unavailable" });
    result.reason = "unable to resolve permissions";
    return result;
  }

  const hasView = perms.has(PermissionsBitField.Flags.ViewChannel);
  const hasSend = perms.has(PermissionsBitField.Flags.SendMessages);
  const hasManage = perms.has(PermissionsBitField.Flags.ManageMessages);
  // Permissions check philosophy: fail-soft and explain what’s missing.
  // Docs: https://discord.com/developers/docs/topics/permissions

  logPhase(ctx, "open_channel", {
    guildId,
    channelId: channel.id,
    hasView,
    hasSend,
    hasManageMessages: hasManage,
  });

  if (!hasView) {
    markSkippedPhase(ctx, "find_existing", { reason: "missing ViewChannel" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "missing ViewChannel" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "missing ViewChannel" });
    result.reason = "missing ViewChannel";
    return result;
  }

  ctx.step("find_existing");
  const existing = await findExistingGateEntry(channel, botId);
  if (existing) {
    result.messageId = existing.id;
  }
  logPhase(ctx, "find_existing", {
    channelId: channel.id,
    messageId: existing?.id ?? null,
  });

  if (!hasSend) {
    markSkippedPhase(ctx, "send_or_edit", {
      channelId: channel.id,
      messageId: existing?.id ?? null,
      reason: `missing SendMessages in #${channel.name}`,
    });
    markSkippedPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: existing?.id ?? null,
      hasManageMessages: hasManage,
      reason: `missing SendMessages in #${channel.name}`,
    });
    result.reason = `missing SendMessages in #${channel.name}`;
    return result;
  }

  ctx.step("send_or_edit");
  let message: Message | null = existing ?? null;
  let created = false;
  let edited = false;

  if (message) {
    const editPayload = buildGateEntryPayload({ guild: channel.guild, config: cfg ?? null });
    try {
      await message.edit({
        embeds: editPayload.embeds,
        components: editPayload.components,
        files: editPayload.files,
        attachments: [],
      });
      edited = true;
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === 10008) {
        message = null;
      } else {
        throw err;
      }
    }
  }

  if (!message) {
    const createPayload = buildGateEntryPayload({ guild: channel.guild, config: cfg ?? null });
    const sent = await channel.send(createPayload);
    message = sent;
    created = true;
  }

  result.messageId = message.id;
  result.created = created;
  result.edited = edited;
  logger.info(
    {
      channelId: channel.id,
      messageId: message.id,
      created,
      edited,
    },
    "[gate] entry posted"
  );
  logPhase(ctx, "send_or_edit", {
    channelId: channel.id,
    messageId: message.id,
    created,
    edited,
  });

  ctx.step("maybe_pin");
  if (!hasManage) {
    logPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: message.id,
      hasManageMessages: false,
      reason: "missing ManageMessages",
    });
    result.reason = "missing ManageMessages";
    return result;
  }

  try {
    if (!message.pinned) {
      await message.pin();
    }
    const pinnedMessages = await channel.messages.fetchPinned();
    const pinnedMatch = pinnedMessages.has(message.id);
    result.pinned = pinnedMatch;
    if (!pinnedMatch) {
      result.reason = "pin verification failed";
    }
    logPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: message.id,
      hasManageMessages: true,
      pinned: pinnedMatch,
    });
    return result;
  } catch (err) {
    logPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: message.id,
      hasManageMessages: true,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function handleStartButton(interaction: ButtonInteraction) {
  try {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Guild only." });
      return;
    }
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const questions = getQuestions(guildId);
    if (questions.length === 0) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: "No questions configured for this guild.",
        });
      }
      return;
    }
    const pages = paginate(questions);
    const requestedPage = parsePage(interaction.customId);
    const page = pages[requestedPage];
    if (!page) {
      // respond fast or Discord returns 10062: Unknown interaction (3s SLA)
      // We use an ephemeral reply to keep the channel tidy.
      // docs: https://discord.com/developers/docs/interactions/receiving-and-responding
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "That page is unavailable. Start over.",
      });
      return;
    }
    let draft;
    try {
      draft = getOrCreateDraft(db, guildId, userId);
    } catch (err) {
      if (err instanceof Error && err.message === "User is permanently rejected") {
        // Ephemeral reply for permanent rejection
        const guildName = interaction.guild?.name ?? "this server";
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: `You have been permanently rejected from **${guildName}**.`,
        });
        logger.info(
          { userId, guildId },
          "[gate] Application start blocked - user permanently rejected"
        );
        return;
      }
      if (err instanceof Error && err.message === "Active application already submitted") {
        // ephemeral + quick reply under 3 seconds
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: "You already have a submitted application.",
        });
        return;
      }
      throw err;
    }
    const draftData = getDraft(db, draft.application_id);
    const answerMap = draftData ? toAnswerMap(draftData.responses) : new Map();
    const modal = buildModalForPage(page, answerMap, draft.application_id);

    addBreadcrumb({
      message: "Gate entry modal opened",
      category: "gate",
      data: { guildId, userId, pageIndex: page.pageIndex },
      level: "info",
    });

    // showModal acknowledges the interaction with a modal UI; no reply yet needed
    await interaction.showModal(modal);
  } catch (err) {
    captureException(err, {
      guildId: interaction.guildId ?? "unknown",
      userId: interaction.user.id,
      area: "handleStartButton",
    });
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ flags: MessageFlags.Ephemeral, content: "Something broke. Try again." })
        .catch(() => undefined);
    }
  }
}

export async function handleGateModalSubmit(
  interaction: ModalSubmitInteraction,
  ctx: CmdCtx,
  pageIndex: number
) {
  /**
   * handleGateModalSubmit
   * WHAT: Processes one modal page of answers; validates required fields; submits when last page.
   * WHY: Acknowledges within 3s (defer), then performs synchronous DB writes without blocking UX.
   * PARAMS:
   *  - interaction: ModalSubmitInteraction for the page.
   *  - ctx: Command context for logging/SQL trace.
   *  - pageIndex: Which page (0-based) we’re handling.
   * RETURNS: Promise<void> after replying ephemerally with next step/results.
   * LINKS:
   *  - Interaction timing: https://discord.com/developers/docs/interactions/receiving-and-responding
   */
  ctx.step("defer");
  await ensureDeferred(interaction);

  if (!interaction.inGuild() || !interaction.guildId) {
    ctx.step("validate_fail");
    await replyOrEdit(interaction, { content: "Guild only.", flags: MessageFlags.Ephemeral });
    return;
  }

  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const appIdMatch = interaction.customId.match(/^v1:modal:([^:]+):p/);
  const appId = appIdMatch ? appIdMatch[1] : null;

  ctx.step("read_fields");

  const questions = getQuestions(guildId);
  if (questions.length === 0) {
    ctx.step("validate_fail");
    // handshake: defer → validate → write DB → render → reply (don’t break this order)
    // we use flags: MessageFlags.Ephemeral (v14 style), not ephemeral:true
    await replyOrEdit(interaction, {
      content: "No questions configured for this guild.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const pages = paginate(questions);
  const page = pages[pageIndex];
  if (!page) {
    ctx.step("validate_fail");
    await replyOrEdit(interaction, {
      content: "This page is out of date. Press Start to reload.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const draftByIdSql = `SELECT id, guild_id, user_id, status FROM application WHERE id = ?`;
  const draftByUserSql = `SELECT id, guild_id, user_id, status FROM application WHERE guild_id = ? AND user_id = ? AND status = 'draft'`;
  type DraftRow = { id: string; guild_id: string; user_id: string; status: string };
  let draftRow: DraftRow | undefined;
  if (appId) {
    draftRow = withSql(ctx, draftByIdSql, () => db.prepare(draftByIdSql).get(appId)) as
      | DraftRow
      | undefined;
    if (draftRow && (draftRow.guild_id !== guildId || draftRow.user_id !== userId)) {
      draftRow = undefined;
    }
  } else {
    draftRow = withSql(ctx, draftByUserSql, () =>
      db.prepare(draftByUserSql).get(guildId, userId)
    ) as DraftRow | undefined;
  }

  if (!draftRow) {
    ctx.step("validate_fail");
    await replyOrEdit(interaction, {
      content: "No active draft found. Press Start to begin again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (draftRow.status === "submitted") {
    ctx.step("already_submitted");
    await replyOrEdit(interaction, {
      content: "Application submitted. Review will happen in the staff channel.",
      components: buildDoneRow(),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (draftRow.status !== "draft") {
    ctx.step("validate_fail");
    await replyOrEdit(interaction, {
      content: "This application was already submitted or closed. Press Start to begin again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ctx.step("validate_input");
  const answersOnPage = page.questions.map((question) => {
    const raw = interaction.fields.getTextInputValue(`v1:q:${question.q_index}`) ?? "";
    const value = raw.slice(0, 1000);
    return { question, value };
  });
  const missing = answersOnPage.filter(
    ({ question, value }) => question.required && value.trim().length === 0
  );
  if (missing.length > 0) {
    ctx.step("validate_fail");
    const list = missing.map(({ question }) => question.q_index + 1).join(", ");
    await replyOrEdit(interaction, {
      content: `Fill required question(s): ${list}.`,
      components: buildNavRow(pageIndex, pages.length),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ctx.step("persist_page");
  const save = db.transaction((rows: typeof answersOnPage) => {
    for (const row of rows) {
      upsertAnswer(db, draftRow!.id, row.question.q_index, row.value, ctx);
    }
  });
  save(answersOnPage);

  const hasNext = pageIndex < pages.length - 1;
  if (hasNext) {
    ctx.step("render_next_prompt");
    // Persist answers before rendering the next step; keep it ephemeral
    await replyOrEdit(interaction, {
      content: `Saved page ${pageIndex + 1}.`,
      components: buildNavRow(pageIndex, pages.length),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ctx.step("validate_final");
  const draftData = getDraft(db, draftRow.id, ctx);
  const answerMap = draftData ? toAnswerMap(draftData.responses) : new Map<number, string>();
  const missingRequired = questions.filter((q) => q.required && !answerMap.get(q.q_index)?.trim());
  if (missingRequired.length > 0) {
    ctx.step("validate_fail");
    const list = missingRequired.map((q) => q.q_index + 1).join(", ");
    const firstMissing = missingRequired[0];
    const targetPage = pages.find((p) =>
      p.questions.some((q) => q.q_index === firstMissing.q_index)
    );
    const targetIndex = targetPage?.pageIndex ?? 0;
    await replyOrEdit(interaction, {
      content: `Required question(s) missing: ${list}.`,
      components: buildFixRow(targetIndex),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  addBreadcrumb({
    message: "Submitting gate application",
    category: "gate",
    data: { guildId, userId, appId: draftRow.id },
    level: "info",
  });

  ctx.step("db_begin");
  submitApplication(db, draftRow.id, ctx);
  ctx.step("db_commit");

  ctx.step("post_commit");

  // Log application submission to action_log for analytics
  // NOTE: .catch() prevents logging failures from crashing the interaction
  // This is non-blocking - user experience is unchanged if logging fails
  if (interaction.guild) {
    await logActionPretty(interaction.guild, {
      appId: draftRow.id,
      appCode: shortCode(draftRow.id),
      actorId: interaction.user.id,
      subjectId: interaction.user.id,
      action: "app_submitted",
    }).catch((err) => {
      logger.warn({ err, appId: draftRow.id }, "[gate] failed to log app_submitted");
    });
  }

  const cfg = getConfig(guildId);
  if (cfg?.avatar_scan_enabled) {
    queueAvatarScan({
      appId: draftRow.id,
      user: interaction.user,
      cfg,
      client: interaction.client as Client,
      parentTraceId: currentTraceId(ctx) ?? null,
    });
  }

  // Ensure review card is created (fire-and-forget)
  try {
    await ensureReviewMessage(interaction.client, draftRow.id);
  } catch (err) {
    logger.warn({ err, appId: draftRow.id }, "Failed to ensure review card after submission");
  }

  // Gatekeeper ping now handled by review.ts on card create (one-time)
  ctx.step("gatekeeper_ping");
  logger.debug(
    { guildId, appId: draftRow.id },
    "[gate] skipping separate ping; review card handles one-time ping on create"
  );

  ctx.step("render_card");
  // final ack to the applicant — ephemeral to avoid channel noise
  await replyOrEdit(interaction, {
    content: "Application submitted. Review will happen in the staff channel.",
    components: buildDoneRow(),
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleDoneButton(interaction: ButtonInteraction) {
  try {
    await interaction.update({ components: [] });
  } catch (err) {
    captureException(err, { area: "handleDoneButton" });
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate().catch(() => undefined);
    }
  }
}
