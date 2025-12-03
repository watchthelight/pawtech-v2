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
import { ensureDeferred, replyOrEdit, withSql } from "../lib/cmdWrap.js";
import { logActionPretty } from "../logging/pretty.js";
import { getQuestions as getQuestionsShared } from "./gate/questions.js";
import { touchSyncMarker } from "../lib/syncMarker.js";
import { isPanicMode } from "./panicStore.js";

// Discord modal limits - these are API-enforced, not arbitrary.
// See: https://discord.com/developers/docs/interactions/message-components#text-inputs
const DEFAULT_ANSWER_MAX_LENGTH = 1000;
/*
 * GOTCHA: INPUT_MAX_LENGTH and LABEL_MAX_LENGTH are different things.
 * INPUT_MAX_LENGTH is how much text the user can type (1000 chars).
 * LABEL_MAX_LENGTH is how long the question label can be (45 chars).
 * Confuse these and Discord throws cryptic "Invalid Form Body" errors.
 */
const INPUT_MAX_LENGTH = 1000;

/**
 * getAnswerMaxLength
 * WHAT: Get the max character length for gate answers
 * WHY: Now configurable via /config set gate_answer_length (100-4000)
 */
function getAnswerMaxLength(guildId: string): number {
  const cfg = getConfig(guildId);
  return cfg?.gate_answer_max_length ?? DEFAULT_ANSWER_MAX_LENGTH;
}
const LABEL_MAX_LENGTH = 45;    // Discord enforces 45 chars max for labels
const PLACEHOLDER_MAX_LENGTH = 100;
// WHY teal? Because that's what the designer picked in 2022. Don't change it
// unless you want to hear about it in every staff meeting for six months.
const BRAND_COLOR = 0x22ccaa;
// Footer text doubles as a sentinel for identifying our gate messages when searching.
// Keep both legacy and current values so we can still find old gate entries after updates.
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

/**
 * Discord modals allow max 5 inputs per modal. When we have more than 5 questions,
 * we need to split them across multiple "pages". Each page becomes its own modal.
 * pageSize defaults to 5 (the Discord max) but is parameterized for testing.
 *
 * EDGE CASE: If a guild has 0 questions configured, this returns an empty array.
 * Callers must handle that - don't just blindly access pages[0].
 */
function paginate(questions: GateQuestion[], pageSize = 5): QuestionPage[] {
  if (pageSize <= 0) throw new Error("pageSize must be positive");
  const pages: QuestionPage[] = [];
  for (let i = 0; i < questions.length; i += pageSize) {
    const slice = questions.slice(i, i + pageSize);
    pages.push({ pageIndex: pages.length, questions: slice });
  }
  return pages;
}

/*
 * The customId format "v1:modal:{appId}:p{pageIndex}" is load-bearing.
 * The modal submit handler parses this to find the app and page.
 * If you change this format, update handleGateModalSubmit's regex too.
 */
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

/**
 * Idempotent draft retrieval - either finds existing draft or creates a new one.
 * Throws on: permanent rejection, already-submitted application.
 *
 * Order of checks matters:
 * 1. Permanent rejection - user is banned, hard stop
 * 2. Existing draft - reuse it (don't create duplicates)
 * 3. Active submission - prevent duplicate applications in review queue
 * 4. Create new draft
 *
 * Edge case: User with 'needs_info' status trying to start fresh. We block this
 * because 'needs_info' implies staff is waiting for a response on their existing app.
 */
function getOrCreateDraft(db: BetterSqliteDatabase, guildId: string, userId: string) {
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
  const code = shortCode(id);

  /*
   * Short code collision cleanup - yes, this is ugly, and yes, we need it.
   * shortCode() truncates UUIDs to 8 chars for readability. With enough apps,
   * collisions happen. We only delete TERMINAL apps (approved/rejected/kicked)
   * to free up the code for reuse. Active apps keep their codes.
   *
   * "But why not just use longer codes?" Because staff yells "ABC12345" over
   * voice chat during busy review sessions, and 8 chars is already pushing it.
   */
  // Delete any resolved application with the same shortCode to allow reuse
  // Only deletes terminal statuses (approved, rejected, kicked)
  // Active apps (draft, submitted, needs_info) are never deleted
  // Note: Permanently rejected apps have status='rejected' with permanently_rejected=1
  const resolvedApps = db.prepare(
    `SELECT id FROM application
     WHERE guild_id = ?
     AND status IN ('approved', 'rejected', 'kicked')`
  ).all(guildId) as Array<{ id: string }>;

  // Prepare statement once outside loop to avoid N+1 query pattern
  const deleteStmt = db.prepare(`DELETE FROM application WHERE id = ?`);
  for (const app of resolvedApps) {
    if (shortCode(app.id) === code) {
      deleteStmt.run(app.id);
      break; // Only one collision possible per code
    }
  }

  db.prepare(
    `
      INSERT INTO application (id, guild_id, user_id, status)
      VALUES (?, ?, ?, 'draft')
    `
  ).run(id, guildId, userId);
  touchSyncMarker("application_create");
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

/*
 * Why so many SQL lookups just to save one answer? Trust issues, mostly.
 * We verify the app exists, then verify the question exists for this guild,
 * THEN we write. Yes, it's 3 queries where 1 might work. But the debugging
 * time saved when something goes wrong is worth the extra roundtrips.
 */
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

  const answerMaxLength = getAnswerMaxLength(app.guild_id);
  const trimmed = value.length > answerMaxLength ? value.slice(0, answerMaxLength) : value;

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

/**
 * Persist avatar scan results. Uses UPSERT so re-scans (e.g., after avatar change)
 * update rather than duplicate. The application_id uniqueness constraint handles this.
 *
 * Evidence arrays are JSON-serialized - they contain label tags from the ML model
 * (e.g., ["explicit", "nsfw_cartoon"]) and need structured storage for later display.
 * We null-coalesce empty arrays to NULL to save DB space on clean avatars.
 */
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

/**
 * Polls for review card creation. This exists because avatar scan runs async
 * (via setImmediate) and needs to wait for the review card to exist before
 * it can refresh it with scan results.
 *
 * Why polling instead of event-driven: The review card is created by a different
 * code path (ensureReviewMessage) that may or may not have finished by the time
 * the avatar scan completes. Polling is simpler than adding cross-module eventing.
 *
 * 5s timeout is generous - review card creation typically takes <500ms. If we
 * timeout, we still try to refresh (it might exist by then anyway).
 */
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

/**
 * Fire-and-forget avatar scan. Uses setImmediate to yield back to the event loop
 * immediately so the user gets their "application submitted" confirmation without
 * waiting for ML inference (which can take 2-5s with cold model load).
 *
 * Why not a job queue? For single-instance bots, setImmediate is sufficient.
 * If we ever scale to multiple instances, this should move to a proper job queue
 * (BullMQ, etc.) to prevent duplicate scans.
 *
 * The scan result updates the review card asynchronously - staff see the avatar
 * score appear after initial card creation.
 *
 * GOTCHA: The nested try-catch here looks paranoid, but setImmediate swallows
 * unhandled rejections differently than you'd expect. The outer catch handles
 * sync errors in callback setup, inner handles async errors. Don't simplify.
 */
function queueAvatarScan(params: {
  appId: string;
  user: User;
  cfg: GuildConfig;
  client: Client;
  parentTraceId?: string | null;
}) {
  const { appId, user, cfg, client, parentTraceId } = params;
  // Pre-resolve avatar URL in case user changes avatar before scan runs
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
    // Outer try-catch for synchronous errors in callback setup
    try {
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
    } catch (err) {
      // Catch synchronous errors in setImmediate callback
      logger.error({ ...baseLog, phase: "sync_error", err }, "[avatarScan] synchronous error in job setup");
    }
  });
}

// Parses "v1:start:p2" -> 2, "v1:start" -> 0. Falls back to page 0 if parsing fails.
// The "v1:" prefix is for versioning - if we ever need to change the format,
// we can add v2: handlers without breaking existing button interactions.
function parsePage(customId: string): number {
  const match = customId.match(/^v1:start(?::p(\d+))?/);
  if (match && match[1]) return Number.parseInt(match[1], 10);
  return 0;
}

function toAnswerMap(responses: Array<{ q_index: number; answer: string }>) {
  return new Map(responses.map((row) => [row.q_index, row.answer] as const));
}

/**
 * Build navigation buttons for multi-page forms. Shows Back/Next as appropriate.
 * The "Retry" button appears only on single-page forms or the last page when
 * something goes wrong - gives users a way to try again without starting over.
 *
 * Button customIds encode the target page (v1:start:p0, v1:start:p1, etc.)
 * so the button handler knows which modal to show next.
 */
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

/*
 * These two functions (messageHasStartButton + messageHasGateFooter) together
 * identify "our" gate messages. We check both because:
 * 1. Other bots might have "v1:start" buttons (unlikely but possible)
 * 2. Our own non-gate messages might have similar structures
 * Belt and suspenders. The footer is the stronger signal.
 */
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

/**
 * Find existing gate entry message to edit rather than create duplicates.
 * Search order: pinned messages first (preferred location), then recent 50 messages.
 *
 * Why 50? It's a reasonable balance between finding orphaned gate entries and
 * API efficiency. If someone unpins the gate message but doesn't delete it,
 * we'll still find it in recent history.
 *
 * Returns null if no gate entry found - caller will create a new one.
 */
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
    traceId: ctx.traceId,
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
    // Fresh send - this happens on first setup or if the old message was deleted
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

/**
 * Entry point for gate verification flow. Triggered when user clicks "Verify" button.
 * This is HOT PATH - runs on every application start, needs to be fast.
 *
 * Key constraint: Must show modal within 3 seconds or Discord kills the interaction.
 * We do minimal validation before showModal, deferring heavy work to modal submit.
 *
 * PERFORMANCE NOTE: getOrCreateDraft does a few DB queries, but they're sync
 * (better-sqlite3) so they complete in <10ms typically. If this ever becomes
 * a bottleneck, the getQuestions call is the one to cache - it rarely changes.
 */
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

  // Panic mode check - block all new submissions during emergencies
  // This prevents the review queue from being flooded while staff handles an incident
  ctx.step("panic_check");
  if (isPanicMode(guildId)) {
    logger.warn({
      evt: "gate_submission_blocked_panic",
      guildId,
      userId,
    }, "[gate] Submission blocked - panic mode active");

    await replyOrEdit(interaction, {
      content: "Applications are temporarily paused. Please try again later.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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

  /*
   * Transaction wrapper here is critical. Without it, a crash mid-save could
   * leave the app in a weird partial state (some answers saved, some not).
   * Users would see "saved page 2" but only half their answers actually persisted.
   * Ask me how I know. (Actually don't, it was a bad week.)
   */
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
      parentTraceId: ctx.traceId ?? null,
    });
  }

  // Ensure review card is created (fire-and-forget)
  // GOTCHA: This is NOT fire-and-forget - we await it. The comment lies.
  // We need the review card to exist before we tell the user "submitted"
  // because staff might see the card before this function returns.
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

// The simplest handler in this file. User clicks Done, we remove the buttons.
// The fallback to deferUpdate is for edge cases where update() fails
// (interaction expired, message deleted, etc). Silently eating the error
// is fine here - the user got their confirmation, we're just cleaning up.
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
