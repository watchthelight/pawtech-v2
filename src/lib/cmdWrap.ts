/**
 * Pawtropolis Tech — src/lib/cmdWrap.ts
 * WHAT: Small helpers to standardize interaction lifecycle: tracing, step logging, error cards, safe defers/replies.
 * WHY: Discord has a strict 3‑second SLA for first responses; wrapping commands ensures consistency and fewer 10062s.
 * FLOWS:
 *  - wrapCommand(): enter → step(...) → try/catch → postErrorCard on failure
 *  - ensureDeferred(): deferReply if not already replied/deferred (ephemeral by default)
 *  - replyOrEdit(): choose reply/editReply/followUp based on state; ephemeral by default
 * DOCS:
 *  - discord.js v14 (interactions): https://discord.js.org/#/docs/discord.js/main/class/Interaction
 *  - CommandInteractions: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction
 *  - Interaction replies (options/flags): https://discord.js.org/#/docs/discord.js/main/typedef/InteractionReplyOptions
 *  - Interaction response rules (3‑second window): https://discord.com/developers/docs/interactions/receiving-and-responding
 *  - Node ESM modules: https://nodejs.org/api/esm.html
 *  - Sentry Node SDK: https://docs.sentry.io/platforms/javascript/guides/node/
 *
 * NOTE: comments here are intentionally noisy. I like future-me to have breadcrumbs.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  MessageFlags,
  DiscordAPIError,
  type InteractionReplyOptions,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type Interaction,
} from "discord.js";
import { logger, redact } from "./logger.js";
import { addBreadcrumb, captureException, setContext, setTag } from "./sentry.js";
import { ctx as reqCtx, newTraceId } from "./reqctx.js";

type Phase = string;

export type InstrumentedInteraction =
  | ChatInputCommandInteraction
  | ModalSubmitInteraction
  | ButtonInteraction;

export type CommandContext<I extends InstrumentedInteraction = ChatInputCommandInteraction> = {
  interaction: I;
  step: (phase: Phase) => void;
  currentPhase: () => Phase;
  setLastSql: (sql: string | null) => void;
  getTraceId: () => string;
  readonly traceId: string;
};

export type CmdCtx<I extends InstrumentedInteraction = InstrumentedInteraction> = CommandContext<I>;
export type SqlTrackingCtx = { setLastSql: (sql: string | null) => void };

type CommandExecutor<I extends InstrumentedInteraction> = (ctx: CommandContext<I>) => Promise<void>;

const WATCHDOG_MS = 2500;

function inferKind(
  interaction: Interaction | InstrumentedInteraction
): "slash" | "button" | "modal" {
  if ("commandName" in interaction) return "slash";
  if ("fields" in interaction) return "modal";
  return "button";
}

function discordRestMeta(err: unknown) {
  if (!(err instanceof DiscordAPIError)) return null;
  let bodySnippet: string | undefined;
  try {
    const body = err.requestBody;
    if (body?.json) {
      bodySnippet = redact(JSON.stringify(body.json));
    } else if (body?.files?.length) {
      bodySnippet = `[files:${body.files.length}]`;
    } else if ((body as { body?: unknown })?.body) {
      bodySnippet = redact(String((body as { body?: unknown }).body));
    }
  } catch {
    bodySnippet = "[unserializable]";
  }
  if (bodySnippet && bodySnippet.length > 120) {
    bodySnippet = `${bodySnippet.slice(0, 120)}...`;
  }
  return {
    status: err.status,
    code: err.code,
    method: err.method,
    url: (err as { url?: string; path?: string }).url ?? (err as { path?: string }).path,
    bodySnippet,
  };
}

export function armWatchdog(interaction: Interaction) {
  /**
   * armWatchdog
   * WHAT: Sets a timer to auto-defer modal submissions nearing the 3s deadline.
   * WHY: Modals can involve heavier work; this covers us against Discord 10062 Unknown interaction.
   * PARAMS:
   *  - interaction: Any Interaction; only acts if it’s a ModalSubmitInteraction and not yet acknowledged.
   * RETURNS: A cleanup function that clears the timer.
   * THROWS: Never throws; internal errors are logged and swallowed.
   * LINKS:
   *  - Interaction response rules: https://discord.com/developers/docs/interactions/receiving-and-responding
   * PITFALLS:
   *  - Only defers modals; slash/button defers are handled by higher-level wrappers.
   */
  const timer = setTimeout(async () => {
    const isModal =
      typeof (interaction as ModalSubmitInteraction).isModalSubmit === "function" &&
      (interaction as ModalSubmitInteraction).isModalSubmit();
    if (!isModal) return;
    const modalInteraction = interaction as ModalSubmitInteraction;
    if (modalInteraction.deferred || modalInteraction.replied) return;
    const meta = reqCtx();
    try {
      // respond fast or Discord returns 10062: Unknown interaction (3s SLA).
      // Use deferReply with MessageFlags.Ephemeral to keep responses private to the actor.
      await (interaction as ModalSubmitInteraction).deferReply({ flags: MessageFlags.Ephemeral });
      logger.warn(
        {
          evt: "watchdog_autodefer",
          kind: "modal",
          id: (interaction as { customId?: string }).customId,
          traceId: meta.traceId,
        },
        "auto-deferred to avoid 10062"
      );
    } catch (err) {
      const code = (err as { code?: unknown })?.code;
      logger.warn(
        {
          evt: "watchdog_autodefer_fail",
          code,
          traceId: meta.traceId,
          err,
        },
        "auto-defer failed"
      );
    }
  }, WATCHDOG_MS);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearTimeout(timer);
}

export function wrapCommand<I extends InstrumentedInteraction>(
  name: string,
  fn: CommandExecutor<I>
) {
  /**
   * wrapCommand
   * WHAT: Decorates a command handler with tracing, step logging, and error-card handling.
   * WHY: Centralizes brittle interaction handling and error reporting so individual commands stay focused.
   * PARAMS:
   *  - name: Stable label for logs/Sentry.
   *  - fn: The actual async handler; receives a structured CommandContext.
   * RETURNS: An Interaction handler compatible with discord.js.
   * THROWS: Never to caller; errors inside are caught, logged, and surfaced via postErrorCard.
   * LINKS:
   *  - Error cards: src/lib/errorCard.ts#postErrorCard
   *  - Sentry capture: https://docs.sentry.io/platforms/javascript/guides/node/
   * PITFALLS:
   *  - Ensure any DB call sets ctx.setLastSql to populate diagnostics on failures.
   */
  return async (interaction: I) => {
    const store = reqCtx();
    const traceId = store.traceId ?? newTraceId();
    const cmdName = store.cmd ?? name;
    const kind = store.kind ?? inferKind(interaction);
    const startedAt = Date.now();
    let phase: Phase = "enter";
    let lastSql: string | null = null;

    const commandCtx: CommandContext<I> = {
      interaction,
      step: (newPhase: Phase) => {
        phase = newPhase;
        logger.info({ evt: "cmd_step", traceId, cmd: cmdName, phase });
        addBreadcrumb({
          category: "cmd",
          message: cmdName,
          data: { phase, traceId },
          level: "info",
        });
        setTag("phase", phase);
      },
      currentPhase: () => phase,
      setLastSql: (sql: string | null) => {
        lastSql = sql;
      },
      getTraceId: () => traceId,
      traceId,
    };

    logger.info(
      {
        evt: "cmd_start",
        traceId,
        cmd: cmdName,
        kind,
        userId: interaction.user.id,
        guildId: interaction.guildId ?? "dm",
      },
      "command start"
    );

    setTag("cmd", cmdName);
    setTag("traceId", traceId);
    setTag("phase", phase);
    setContext("discord", {
      userId: interaction.user.id,
      guildId: interaction.guildId ?? "dm",
      channelId: interaction.channelId ?? null,
    });

    try {
      await fn(commandCtx);
      const duration = Date.now() - startedAt;
      logger.info({ evt: "cmd_ok", traceId, cmd: cmdName, ms: duration }, "command ok");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const errCode = (error as { code?: unknown })?.code;
      const errPayload = {
        name: err.name,
        code: errCode,
        message: err.message,
        stack: err.stack,
      };
      const interactionMeta = {
        commandName: "commandName" in interaction ? interaction.commandName : undefined,
        customId: "customId" in interaction ? interaction.customId : undefined,
        modalId: "fields" in interaction ? interaction.customId : undefined,
      };
      logger.error(
        {
          evt: "cmd_error",
          traceId,
          cmd: cmdName,
          kind,
          phase,
          lastSql,
          interaction: interactionMeta,
          err: errPayload,
        },
        "command error"
      );
      setTag("phase", phase);
      setTag("cmd", cmdName);
      setTag("traceId", traceId);
      captureException(err, { cmd: cmdName, phase, traceId, lastSql });

      try {
        const { postErrorCard } = await import("./errorCard.js");
        await postErrorCard(interaction, {
          traceId,
          cmd: cmdName,
          phase,
          err: errPayload,
          lastSql,
        });
      } catch (cardErr) {
        logger.error(
          { err: cardErr, traceId, evt: "cmd_error_card_fail" },
          "Failed to post error card"
        );
      }
    }
  };
}

export async function withStep<T>(
  ctx: CommandContext,
  phase: Phase,
  fn: () => Promise<T> | T
): Promise<T> {
  /**
   * withStep
   * WHAT: Convenience to mark a phase and run some work under it.
   * WHY: Ensures logs and Sentry breadcrumbs reflect the right phase without boilerplate.
   * PARAMS:
   *  - ctx: CommandContext for the current interaction.
   *  - phase: Short label (e.g., "db_begin", "render", "reply").
   *  - fn: Unit of work, sync or async.
   * RETURNS: The function result.
   * THROWS: Propagates exceptions from fn (caught by wrapCommand upstream).
   */
  ctx.step(phase);
  return await fn();
}

// logging everything because past me didn't
export function withSql<T>(ctx: SqlTrackingCtx, sql: string, run: () => T): T {
  // DB trace: we stash the current SQL to surface in error cards on failure.
  // better-sqlite3 is synchronous — no await here by design:
  // https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
  ctx.setLastSql(sql);
  try {
    return run();
  } finally {
    ctx.setLastSql(null);
  }
}

export function currentTraceId(ctx: CommandContext<InstrumentedInteraction>): string {
  return ctx.traceId;
}

type ReplyableInteraction =
  | ChatInputCommandInteraction
  | ModalSubmitInteraction
  | ButtonInteraction;

export async function ensureDeferred(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction | ButtonInteraction
) {
  /**
   * ensureDeferred
   * WHAT: First-time acknowledgement with deferReply if we haven’t replied yet.
   * WHY: Discord requires an initial response within ~3 seconds; deferring buys time.
   * PARAMS:
   *  - interaction: Slash, modal, or button interaction.
   * RETURNS: Promise<void> after successful defer or if already acknowledged.
   * THROWS: Re-throws non-10062 errors; 10062 (expired) is logged and swallowed.
   * LINKS:
   *  - Interaction timing: https://discord.com/developers/docs/interactions/receiving-and-responding
   *  - Reply options/flags: https://discord.js.org/#/docs/discord.js/main/typedef/InteractionReplyOptions
   */
  if (interaction.deferred || interaction.replied) {
    return;
  }
  try {
    // we prefer Ephemeral to avoid leaking troubleshooting output into channels
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    logger.info(
      { evt: "cmd_deferred", traceId: reqCtx().traceId },
      "[cmd] deferred reply (ephemeral)"
    );
  } catch (err) {
    const meta = discordRestMeta(err);
    const code = (err as { code?: unknown })?.code;
    const logPayload = {
      evt: "cmd_defer_fail",
      traceId: reqCtx().traceId,
      code,
      ...(meta ?? {}),
      err,
    };
    if (code === 10062) {
      // Interaction expired: first response not received within ~3s window
      // docs: https://discord.com/developers/docs/interactions/receiving-and-responding
      logger.warn(logPayload, "defer failed (interaction expired)");
      return;
    }
    logger.warn(logPayload, "defer failed");
    throw err;
  }
}

// zero or once. never twice.
export async function replyOrEdit(
  interaction: ReplyableInteraction,
  payload: InteractionReplyOptions
) {
  /**
   * replyOrEdit
   * WHAT: Sends a response with the right API based on interaction state.
   * WHY: Avoids double-acknowledge (40060) and handles ephemeral defaults consistently.
   * PARAMS:
   *  - interaction: Slash/Button/Modal interaction.
   *  - payload: InteractionReplyOptions; flags default to Ephemeral if not provided.
   * RETURNS: The underlying Message or API result from discord.js.
   * THROWS: Re-throws non-10062/40060 errors after logging.
   * LINKS:
   *  - Reply vs edit vs followUp: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction
   *  - Interaction timing: https://discord.com/developers/docs/interactions/receiving-and-responding
   * PITFALLS:
   *  - If you set files in the first response, followUp/edit semantics differ; keep payloads small here.
   */
  const withFlags = { ...payload, flags: payload.flags ?? MessageFlags.Ephemeral };
  try {
    if (interaction.deferred) {
      const { flags, ...editPayload } = withFlags;
      return await interaction.editReply(editPayload);
    }
    if (interaction.replied) {
      return await interaction.followUp(withFlags);
    }
    return await interaction.reply(withFlags);
  } catch (err) {
    const meta = discordRestMeta(err);
    const code = (err as { code?: unknown })?.code;
    const logPayload = {
      evt: "cmd_reply_fail",
      traceId: reqCtx().traceId,
      code,
      ...(meta ?? {}),
      err,
    };
    if (code === 10062) {
      // Interaction expired — late replies are ignored by Discord
      // docs: https://discord.com/developers/docs/interactions/receiving-and-responding
      logger.warn(logPayload, "reply/edit skipped; interaction expired");
      return;
    }
    if (code === 40060) {
      logger.warn(logPayload, "reply/edit skipped; already acknowledged");
      return;
    }
    logger.error(logPayload, "reply/edit failed");
    throw err;
  }
}
