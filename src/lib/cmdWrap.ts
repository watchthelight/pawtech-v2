/**
 * Pawtropolis Tech — src/lib/cmdWrap.ts
 * WHAT: Command lifecycle wrapper with wide event telemetry.
 * WHY: Discord has a strict 3-second SLA; wrapping commands ensures consistency and rich observability.
 * FLOWS:
 *  - wrapCommand(): create WideEvent → execute → emit on completion
 *  - withStep(): mark execution phases for tracing
 *  - withSql(): track database queries with timing
 *  - ensureDeferred()/replyOrEdit(): safe interaction responses
 * DOCS:
 *  - discord.js v14: https://discord.js.org
 *  - Wide Events: https://loggingsucks.com
 *  - Sentry Node SDK: https://docs.sentry.io/platforms/javascript/guides/node/
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
  type GuildMember,
} from "discord.js";
import { logger, redact } from "./logger.js";
import { addBreadcrumb, captureException, setContext, setTag } from "./sentry.js";
import { ctx as reqCtx, newTraceId, runWithCtx, enrichEvent } from "./reqctx.js";
import { classifyError, errorContext, shouldReportToSentry } from "./errors.js";
import { WideEventBuilder } from "./wideEvent.js";
import { emitWideEvent } from "./wideEventEmitter.js";

/**
 * A "phase" is just a label for where we are in command execution.
 * Useful for debugging: "it crashed in phase 'db_write'" is much more
 * actionable than "it crashed somewhere in handleApprove".
 */
type Phase = string;

/**
 * Union of interaction types we support wrapping.
 *
 * Notably missing: SelectMenuInteraction, AutocompleteInteraction.
 * Add them if/when needed, but keep the union tight - generic handlers
 * are harder to type correctly.
 */
export type InstrumentedInteraction =
  | ChatInputCommandInteraction
  | ModalSubmitInteraction
  | ButtonInteraction;

/**
 * Context object passed to wrapped command handlers.
 *
 * This is the main interface between your command logic and the wrapper's
 * instrumentation. Call step() to mark progress, setLastSql() before DB
 * calls, and access traceId for any custom logging.
 */
export type CommandContext<I extends InstrumentedInteraction = ChatInputCommandInteraction> = {
  interaction: I;
  /** Mark the current execution phase (e.g., "validate", "db_write", "reply") */
  step: (phase: Phase) => void;
  /** Get the current phase name */
  currentPhase: () => Phase;
  /** Track the last SQL query for error diagnostics - call before DB operations */
  setLastSql: (sql: string | null) => void;
  /** Get the trace ID for this command invocation */
  getTraceId: () => string;
  /** The trace ID (read-only alias for getTraceId()) */
  readonly traceId: string;
};

export type CmdCtx<I extends InstrumentedInteraction = InstrumentedInteraction> = CommandContext<I>;
export type SqlTrackingCtx = { setLastSql: (sql: string | null) => void };

type CommandExecutor<I extends InstrumentedInteraction> = (ctx: CommandContext<I>) => Promise<void>;

/**
 * How long to wait before auto-deferring modals.
 *
 * Discord gives us 3000ms to respond. We set the watchdog at 2500ms to
 * leave a 500ms buffer for network latency. If your modal handlers are
 * consistently hitting this, they're too slow.
 */
// GOTCHA: If you're seeing watchdog auto-defers frequently, your handlers are
// too slow. Profile them - don't just bump this number.
const WATCHDOG_MS = 2500;

/**
 * Infer the interaction type for logging purposes.
 *
 * We use duck typing (check for commandName, fields) rather than instanceof
 * because discord.js interaction types are complex and this is just for logs.
 */
function inferKind(
  interaction: Interaction | InstrumentedInteraction
): "slash" | "button" | "modal" {
  if ("commandName" in interaction) return "slash";
  if ("fields" in interaction) return "modal";
  return "button";
}

/**
 * Extract REST API metadata from a DiscordAPIError for logging.
 *
 * Discord.js errors contain useful debugging info (HTTP method, path, request
 * body) that we want in our logs. We redact the body to avoid logging tokens
 * or user content, and truncate it because some payloads are huge.
 *
 * Returns null for non-Discord errors so callers can spread safely.
 */
function discordRestMeta(err: unknown) {
  if (!(err instanceof DiscordAPIError)) return null;
  let bodySnippet: string | undefined;
  try {
    const body = err.requestBody;
    if (body?.json) {
      bodySnippet = redact(JSON.stringify(body.json));
    } else if (body?.files?.length) {
      // Don't log file contents, just count
      bodySnippet = `[files:${body.files.length}]`;
    } else if ((body as { body?: unknown })?.body) {
      bodySnippet = redact(String((body as { body?: unknown }).body));
    }
  } catch {
    bodySnippet = "[unserializable]";
  }
  // Truncate long bodies - we just want a hint, not the full payload
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
  // unref() prevents this timer from keeping the Node.js process alive.
  // Without it, a pending timer could block graceful shutdown. This is a common
  // footgun - if your bot hangs on shutdown, check for un-unref'd timers.
  if (typeof timer.unref === "function") timer.unref();
  return () => clearTimeout(timer);
}

export function wrapCommand<I extends InstrumentedInteraction>(
  name: string,
  fn: CommandExecutor<I>
) {
  /**
   * wrapCommand
   * WHAT: Decorates a command handler with wide event telemetry and error handling.
   * WHY: Centralizes command lifecycle, builds comprehensive wide events, handles errors gracefully.
   * PARAMS:
   *  - name: Stable label for logs/Sentry.
   *  - fn: The actual async handler; receives a structured CommandContext.
   * RETURNS: An Interaction handler compatible with discord.js.
   * THROWS: Never to caller; errors are caught and surfaced via error cards.
   * WIDE EVENTS:
   *  - One comprehensive event per command execution
   *  - Includes all phases, queries, user context, and error details
   */
  return async (interaction: I) => {
    const store = reqCtx();
    const traceId = store.traceId ?? newTraceId();
    const cmdName = store.cmd ?? name;
    const kind = store.kind ?? inferKind(interaction);
    let phase: Phase = "enter";
    let lastSql: string | null = null;

    // Create wide event builder for this request
    const wideEvent = new WideEventBuilder(traceId);

    // Set interaction context
    wideEvent.setInteraction({
      kind: kind as "slash" | "button" | "modal",
      command: cmdName,
      customId: "customId" in interaction ? (interaction.customId as string) : null,
      guildId: interaction.guildId ?? null,
      channelId: interaction.channelId ?? null,
      userId: interaction.user.id,
    });

    // Enrich with user context
    const member = interaction.member as GuildMember | null;
    const { isOwner } = await import("./owner.js");
    const { hasStaffPermissions, hasManageGuild } = await import("./config.js");

    // Extract role IDs defensively - test mocks may not have a proper Collection
    let roleIds: string[] = [];
    try {
      if (member?.roles?.cache?.map) {
        roleIds = member.roles.cache.map((r) => r.id);
      }
    } catch {
      // Ignore - role extraction is best-effort
    }

    wideEvent.setUser({
      username: interaction.user.username,
      roles: roleIds,
      isStaff: member && interaction.guildId ? hasStaffPermissions(member, interaction.guildId) : false,
      isAdmin: member ? hasManageGuild(member) : false,
      isOwner: isOwner(interaction.user.id),
    });

    // Mark entering phase
    wideEvent.enterPhase("enter");

    const commandCtx: CommandContext<I> = {
      interaction,
      step: (newPhase: Phase) => {
        phase = newPhase;
        wideEvent.enterPhase(newPhase);
        // Keep Sentry breadcrumbs for debugging
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

    // Set Sentry context
    setTag("cmd", cmdName);
    setTag("traceId", traceId);
    setTag("phase", phase);
    setContext("discord", {
      userId: interaction.user.id,
      guildId: interaction.guildId ?? "dm",
      channelId: interaction.channelId ?? null,
    });

    // Run the command within context that carries the wide event
    try {
      await runWithCtx({ traceId, cmd: cmdName, kind, userId: interaction.user.id, wideEvent }, async () => {
        await fn(commandCtx);
      });

      // Success - emit wide event
      wideEvent.setOutcome("success");
      emitWideEvent(wideEvent.finalize());
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const classified = classifyError(error);

      // Set error on wide event
      let sentryEventId: string | null = null;

      // Report to Sentry if it's worth tracking
      if (shouldReportToSentry(classified)) {
        sentryEventId = captureException(err, {
          cmd: cmdName,
          phase,
          traceId,
          lastSql,
          errorKind: classified.kind,
          errorContext: errorContext(classified),
        });
      }

      // Build error context for wide event
      wideEvent.setError(classified, { phase, lastSql, sentryEventId });

      // Emit the wide event (errors are always kept, no sampling)
      const finalEvent = wideEvent.finalize();
      emitWideEvent(finalEvent);

      // Update Sentry tags
      setTag("phase", phase);
      setTag("cmd", cmdName);
      setTag("traceId", traceId);
      setTag("errorKind", classified.kind);

      // Show the user the redesigned error card
      try {
        const { postErrorCardV2 } = await import("./errorCardV2.js");
        await postErrorCardV2(interaction, {
          wideEvent: finalEvent,
          classified,
          sentryEventId,
        });
      } catch (cardErr) {
        logger.error(
          { err: cardErr, traceId, evt: "error_card_fail" },
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

/**
 * Wrap a synchronous database operation with SQL tracking and timing.
 *
 * Call this around any DB query so that:
 * 1. If it fails, the error card will show the failing SQL
 * 2. Query timing is recorded in the wide event for observability
 *
 * NOTE: better-sqlite3 is synchronous, so there's no await here. If you're
 * using an async DB driver, you'd need an async variant of this function.
 */
export function withSql<T>(ctx: SqlTrackingCtx, sql: string, run: () => T): T {
  const startTime = performance.now();

  // Track the SQL so error cards show what query failed
  ctx.setLastSql(sql);

  try {
    const result = run();
    const durationMs = performance.now() - startTime;

    // Record query in wide event for observability
    enrichEvent((e) => e.recordQuery(sql, durationMs));

    // Only clear on success
    ctx.setLastSql(null);
    return result;
  } catch (err) {
    const durationMs = performance.now() - startTime;

    // Still record the query even if it failed
    enrichEvent((e) => e.recordQuery(sql, durationMs));

    // Don't clear SQL on error - leave it for error handling
    throw err;
  }
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
   * WHAT: First-time acknowledgement with deferReply if we haven't replied yet.
   * WHY: Discord requires an initial response within ~3 seconds; deferring buys time.
   * PARAMS:
   *  - interaction: Slash, modal, or button interaction.
   * RETURNS: Promise<void> after successful defer or if already acknowledged.
   * THROWS: Re-throws non-10062 errors; 10062 (expired) is logged and swallowed.
   */
  if (interaction.deferred || interaction.replied) {
    return;
  }
  try {
    // We prefer Ephemeral to avoid leaking troubleshooting output into channels
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Mark deferred in wide event
    enrichEvent((e) => e.markDeferred());
  } catch (err) {
    const meta = discordRestMeta(err);
    const code = (err as { code?: unknown })?.code;

    if (code === 10062) {
      // Interaction expired: first response not received within ~3s window
      enrichEvent((e) => e.setOutcome("timeout"));
      return;
    }

    logger.warn(
      { evt: "defer_fail", traceId: reqCtx().traceId, code, ...(meta ?? {}), err },
      "defer failed"
    );
    throw err;
  }
}

/**
 * Reply to an interaction, handling the deferred/replied state correctly.
 *
 * Discord interactions have complex state: you can reply once, or defer
 * then edit, or follow up after replying. Getting this wrong causes 40060
 * (already acknowledged) errors. This function handles all the cases.
 *
 * IMPORTANT: All replies default to public (visible to everyone in the channel).
 * Commands that need privacy (like /isitreal) should explicitly set ephemeral.
 */
export async function replyOrEdit(
  interaction: ReplyableInteraction,
  payload: InteractionReplyOptions
) {
  /**
   * replyOrEdit
   * WHAT: Sends a response with the right API based on interaction state.
   * WHY: Avoids double-acknowledge (40060) and handles flags consistently.
   * PARAMS:
   *  - interaction: Slash/Button/Modal interaction.
   *  - payload: InteractionReplyOptions; flags default to 0 (public) if not provided.
   * RETURNS: The underlying Message or API result from discord.js.
   * THROWS: Re-throws non-10062/40060 errors after logging.
   */
  const withFlags = { ...payload, flags: payload.flags ?? 0 };
  try {
    let result;
    if (interaction.deferred) {
      // Deferred = we've acknowledged but not sent content yet. editReply is the only valid option.
      const { flags, ...editPayload } = withFlags;
      result = await interaction.editReply(editPayload);
    } else if (interaction.replied) {
      // Already replied = we need followUp to send additional messages
      result = await interaction.followUp(withFlags);
    } else {
      // Fresh interaction = use reply
      result = await interaction.reply(withFlags);
    }

    // Mark replied in wide event
    enrichEvent((e) => e.markReplied());
    return result;
  } catch (err) {
    const meta = discordRestMeta(err);
    const code = (err as { code?: unknown })?.code;

    if (code === 10062) {
      // Interaction expired
      enrichEvent((e) => e.setOutcome("timeout"));
      return;
    }
    if (code === 40060) {
      // Already acknowledged - not a real error
      return;
    }

    logger.warn(
      { evt: "reply_fail", traceId: reqCtx().traceId, code, ...(meta ?? {}), err },
      "reply/edit failed"
    );
    throw err;
  }
}
