/**
 * Pawtropolis Tech — src/lib/errorCard.ts
 * WHAT: Formats and posts an ephemeral "error card" to the invoking interaction with helpful diagnostics.
 * WHY: Interactions should never crash; surface context to users and breadcrumbs to logs.
 * Error cards: making failures look professional since 2024
 * FLOWS: hintFor() → build embed → replyOrEdit(ephemeral)
 * DOCS:
 *  - Interaction replies (flags): https://discord.js.org/#/docs/discord.js/main/typedef/InteractionReplyOptions
 *  - Interaction response rules (10062 timing): https://discord.com/developers/docs/interactions/receiving-and-responding
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
} from "discord.js";
import { logger, redact } from "./logger.js";
import { replyOrEdit } from "./cmdWrap.js";
import { ctx as reqCtx } from "./reqctx.js";

export function hintFor(err: unknown): string {
  const error = err as { name?: string; message?: string; code?: unknown };
  const name = typeof error?.name === "string" ? error.name : undefined;
  const message = typeof error?.message === "string" ? error.message : "";
  const code =
    typeof error?.code === "number" || typeof error?.code === "string" ? error.code : undefined;

  // don't resurrect __old. seriously
  if (name === "SqliteError" && /no such table/i.test(message)) {
    return "Schema mismatch; avoid legacy __old; use truncate-only reset.";
  }

  if (code === 10062) {
    return "Interaction expired; handler didn’t defer in time.";
  }

  if (code === 40060) {
    return "Already acknowledged; avoid double reply.";
  }

  if (code === 50013) {
    return "Missing Discord permission in this channel.";
  }

  if (/Unhandled modal/i.test(message)) {
    return "Form ID didn't match any handler. If your modal id includes a session segment (v1:modal:<uuid>:p0), make sure the router regex matches it.";
  }

  return "Unexpected error. Try again or contact staff.";
}

function truncateSql(sql: string | null | undefined): string {
  if (!sql) return "n/a";
  const cleaned = sql.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 140) return cleaned;
  return `${cleaned.slice(0, 140)}...`;
}

function truncateMessage(message: string | undefined): string {
  if (!message) return "No message provided";
  const safe = redact(message);
  if (safe.length <= 200) return safe;
  return `${safe.slice(0, 200)}...`;
}

type ReplyCapableInteraction =
  | ChatInputCommandInteraction
  | ModalSubmitInteraction
  | ButtonInteraction;

type ErrorCardDetails = {
  traceId: string;
  cmd: string;
  phase: string;
  err: {
    name?: string;
    code?: unknown;
    message?: string;
    stack?: string;
  };
  lastSql?: string | null;
};

// please work. please work.
/**
 * postErrorCard
 * WHAT: Sends an ephemeral embed with error details and a human hint.
 * WHY: Keeps users informed without leaking internals publicly.
 * PARAMS:
 *  - interaction: Any reply-capable interaction.
 *  - details: traceId/cmd/phase + err payload + optional lastSql.
 * RETURNS: Promise<void> — catches 10062/expired and logs instead of throwing.
 */
export async function postErrorCard(
  interaction: ReplyCapableInteraction,
  details: ErrorCardDetails
) {
  const meta = reqCtx();
  const commandLabel =
    meta.kind === "button"
      ? `button: ${details.cmd}`
      : meta.kind === "modal"
        ? `modal: ${details.cmd}`
        : `/${details.cmd}`;

  const codeDisplay =
    typeof details.err.code === "string"
      ? details.err.code
      : details.err.code
        ? String(details.err.code)
        : (details.err.name ?? "unknown");

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Command", value: commandLabel, inline: true },
    { name: "Phase", value: details.phase || "unknown", inline: true },
    { name: "Code", value: codeDisplay, inline: true },
    { name: "Message", value: truncateMessage(details.err.message) },
    {
      name: "Last SQL",
      value: details.lastSql ? truncateSql(details.lastSql) : "n/a",
    },
    { name: "Trace", value: details.traceId, inline: true },
    { name: "Hint", value: hintFor(details.err) },
  ];

  const embed = new EmbedBuilder()
    .setTitle("Command Error")
    .setColor(0xed4245)
    .addFields(fields)
    .setFooter({ text: new Date().toISOString() });

  try {
    // Ephemeral so only the actor sees it; avoids channel spam.
    await replyOrEdit(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (err) {
    const code = (err as { code?: unknown })?.code;
    if (code === 10062) {
      logger.warn(
        { err, traceId: details.traceId, evt: "error_card_expired" },
        "error card skipped; interaction expired"
      );
      return;
    }
    logger.error(
      { err, traceId: details.traceId, evt: "error_card_fail" },
      "failed to deliver error card"
    );
  }
}

/**
 * safeReply
 * WHAT: Fire-and-forget replyOrEdit; logs any failure (expired, etc) without throwing.
 */
export async function safeReply(
  interaction: ReplyCapableInteraction,
  payload: Parameters<typeof replyOrEdit>[1]
) {
  try {
    await replyOrEdit(interaction, payload);
  } catch (err) {
    logger.error({ err, traceId: reqCtx().traceId, evt: "safe_reply_fail" }, "safeReply failed");
  }
}
