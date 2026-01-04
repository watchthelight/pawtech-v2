/**
 * Pawtropolis Tech -- src/features/modmail/threadClose.ts
 * WHAT: Thread closing logic for modmail system.
 * WHY: Handles closing modmail threads, flushing transcripts, and cleanup.
 * DOCS:
 *  - Threads: https://discord.com/developers/docs/resources/channel#thread-modify
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  Client,
  EmbedBuilder,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type PrivateThreadChannel,
  type ThreadChannel,
  type Guild,
} from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { captureException } from "../../lib/sentry.js";
import { enrichEvent } from "../../lib/reqctx.js";
import { getConfig } from "../../lib/config.js";
import { logActionPretty } from "../../logging/pretty.js";
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";
import type { ModmailTicket } from "./types.js";
import {
  getOpenTicketByUser,
  getTicketByThread,
  getTicketById,
  closeTicket,
} from "./tickets.js";
import { flushTranscript } from "./transcript.js";
import { OPEN_MODMAIL_THREADS, removeOpenThread } from "./threadState.js";

// ===== Close Thread Helpers =====

/**
 * trySendClosingMessage
 * WHAT: Best-effort attempt to send a closing message to the modmail thread.
 * WHY: Informs staff that the thread is being closed before archiving/deleting.
 * HOW: Checks last 10 messages for duplicate "Modmail Closed" embeds to avoid spam.
 * RETURNS: 'ok' | 'skip' | 'err' to indicate outcome
 */
async function trySendClosingMessage(
  thread: ThreadChannel,
  reason: string
): Promise<"ok" | "skip" | "err"> {
  try {
    // Check last 10 messages for existing closing notice (idempotency)
    const recent = await thread.messages.fetch({ limit: 10 }).catch(() => null);
    if (recent) {
      const alreadyClosed = recent.some((m) => m.embeds?.[0]?.title?.includes("Modmail Closed"));
      if (alreadyClosed) {
        logger.debug({ threadId: thread.id }, "[modmail] close:closing_message skip (duplicate)");
        return "skip";
      }
    }

    // Build closing embed
    const closeEmbed = new EmbedBuilder()
      .setTitle("Modmail Closed")
      .setDescription(`This modmail thread has been closed.\n\n**Reason:** ${reason}`)
      .setColor(0x808080)
      .setTimestamp();

    await thread.send({ embeds: [closeEmbed], allowedMentions: SAFE_ALLOWED_MENTIONS });
    logger.debug({ threadId: thread.id }, "[modmail] close:closing_message ok");
    return "ok";
  } catch (err) {
    logger.debug({ err, threadId: thread.id }, "[modmail] close:closing_message err");
    return "err";
  }
}

/**
 * archiveOrDeleteThread
 * WHAT: Safe archive+lock or delete operation for public/private threads.
 * WHY: Public threads may lack manageable/editable permissions requiring fallback strategies.
 * RETURNS: { action: 'delete' | 'archive', ok: boolean, err?: any, code?: number }
 */
async function archiveOrDeleteThread(
  thread: ThreadChannel,
  deleteOnClose: boolean,
  client: Client
): Promise<{ action: "delete" | "archive"; ok: boolean; err?: any; code?: number }> {
  // Pre-check permissions
  const me = thread.guild?.members.me;
  const myPerms = me ? thread.permissionsFor(me.id) : null;
  const canManageThreads = myPerms?.has(PermissionFlagsBits.ManageThreads) ?? false;

  if (deleteOnClose) {
    // Check if we can delete
    if (!canManageThreads) {
      logger.info(
        { threadId: thread.id, canManageThreads },
        "[modmail] close:archive skipped delete (insufficient perms) -> falling back to archive"
      );
      // Fall through to archive+lock below
    } else {
      // Try to delete
      try {
        await thread.delete("Modmail closed - transcript flushed");
        logger.debug({ threadId: thread.id }, "[modmail] close:archive action=delete ok");
        return { action: "delete", ok: true };
      } catch (e: any) {
        const code = e?.code;
        logger.warn(
          { err: e, threadId: thread.id, code },
          "[modmail] close:archive action=delete failed -> falling back to archive"
        );

        // On permission errors (50013 Missing Permissions, 50001 Missing Access), fall back to archive
        if (code === 50013 || code === 50001) {
          logger.info(
            { threadId: thread.id, code },
            "[modmail] close:archive fallback due to permission error"
          );
          // Fall through to archive+lock below
        } else {
          // Other error - return failure
          return { action: "delete", ok: false, err: e, code };
        }
      }
    }
  }

  // Archive+lock strategy (either configured or delete fallback)
  try {
    await thread.edit({ archived: true, locked: true });
    logger.debug({ threadId: thread.id }, "[modmail] close:archive action=archive ok");
    return { action: "archive", ok: true };
  } catch (e: any) {
    const code = e?.code;
    logger.warn(
      { err: e, threadId: thread.id, code },
      "[modmail] close:archive action=archive failed"
    );

    // Best effort: remove bot from thread to hide it from sidebar
    try {
      if (client.user) {
        await thread.members.remove(client.user.id).catch((removeErr) => {
          logger.debug({ threadId: thread.id, removeErr }, "[modmail] failed to remove bot from thread (best effort)");
        });
        logger.info(
          { threadId: thread.id },
          "[modmail] close:archive final fallback: removed bot from thread"
        );
      }
    } catch (cleanupErr) {
      logger.debug({ threadId: thread.id, cleanupErr }, "[modmail] cleanup failed during archive fallback");
    }

    return { action: "archive", ok: false, err: e, code };
  }
}

/**
 * cleanupOpenModmail
 * WHAT: Remove ticket from open_modmail guard table and in-memory set.
 * WHY: Ensures subsequent interactions don't think the ticket is still open.
 * IDEMPOTENT: Safe to call multiple times (no-op if already removed).
 */
function cleanupOpenModmail(guildId: string, userId: string, threadId: string | null) {
  try {
    db.prepare(
      `
      DELETE FROM open_modmail
      WHERE guild_id = ? AND applicant_id = ?
    `
    ).run(guildId, userId);

    if (threadId) {
      OPEN_MODMAIL_THREADS.delete(threadId);
    }

    logger.debug(
      { guildId, userId, threadId },
      "[modmail] close:cleanup removed from guard table and in-memory set"
    );
  } catch (err) {
    logger.warn({ err, guildId, userId }, "[modmail] close:cleanup failed (non-fatal)");
  }
}

// ===== Close Thread =====

/**
 * closeModmailThread
 * WHAT: Close a modmail thread.
 * WHY: Ends the modmail conversation and archives/deletes the thread.
 * PARAMS:
 *  - interaction: The interaction that triggered this
 *  - ticketId: Optional ticket ID
 *  - threadId: Optional thread ID
 * RETURNS: Success status, message, and optional log URL
 */
export async function closeModmailThread(params: {
  interaction: ButtonInteraction | ChatInputCommandInteraction;
  ticketId?: number;
  threadId?: string;
}): Promise<{ success: boolean; message?: string; logUrl?: string | null }> {
  const { interaction, ticketId, threadId } = params;

  let ticket: ModmailTicket | null = null;

  if (ticketId) {
    ticket = getTicketById(ticketId);
  } else if (threadId) {
    ticket = getTicketByThread(threadId);
  } else {
    // Use current thread if command run in thread
    if (interaction.channel?.isThread()) {
      ticket = getTicketByThread(interaction.channel.id);
    }
  }

  if (!ticket) {
    return { success: false, message: "Modmail ticket not found." };
  }

  if (ticket.status === "closed") {
    return { success: false, message: "This ticket is already closed." };
  }

  try {
    // Close in DB and clean up guard table in single transaction
    db.transaction(() => {
      closeTicket(ticket.id);

      // Clean up from open_modmail guard table
      if (interaction.guildId && ticket.user_id) {
        db.prepare(
          `
          DELETE FROM open_modmail
          WHERE guild_id = ? AND applicant_id = ?
        `
        ).run(interaction.guildId, ticket.user_id);

        logger.info(
          { guildId: interaction.guildId, userId: ticket.user_id, threadId: ticket.thread_id },
          "[modmail] removed from open_modmail guard table"
        );
      }
    })();

    // Remove from open threads set
    if (ticket.thread_id) {
      removeOpenThread(ticket.thread_id);
    }

    // Store thread reference for later cleanup
    let threadForCleanup: any = null;

    // Lock and archive thread
    if (ticket.thread_id) {
      try {
        const thread = (await interaction.client.channels.fetch(
          ticket.thread_id
        )) as PrivateThreadChannel | null;
        if (thread) {
          await thread.setLocked(true);
          await thread.setArchived(true);
          threadForCleanup = thread;
        }
      } catch (err) {
        // Thread may have been manually deleted or bot lacks permissions
        logger.warn(
          { err, ticketId: ticket.id, threadId: ticket.thread_id },
          "[modmail] failed to archive thread (may already be deleted)"
        );
      }
    }

    // Notify applicant
    try {
      const user = await interaction.client.users.fetch(ticket.user_id);
      await user.send({
        content: `Your modmail thread for **${interaction.guild?.name ?? "the server"}** has been closed by staff.`,
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      });
    } catch (err) {
      logger.warn(
        { err, ticketId: ticket.id, userId: ticket.user_id },
        "[modmail] failed to DM applicant on close"
      );
    }

    // Flush transcript to log channel
    let logMessageId: string | null = null;
    let transcriptLines = 0;
    if (interaction.guildId) {
      const result = await flushTranscript({
        client: interaction.client,
        ticketId: ticket.id,
        guildId: interaction.guildId,
        userId: ticket.user_id,
        appCode: ticket.app_code,
      });
      logMessageId = result.messageId;
      transcriptLines = result.lineCount;
    }

    // Save log_channel_id and log_message_id to ticket
    let logUrl: string | null = null;
    if (logMessageId) {
      const cfg = getConfig(interaction.guildId!);
      const logChannelId = cfg?.modmail_log_channel_id ?? null;

      db.prepare(
        `
        UPDATE modmail_ticket
        SET log_channel_id = ?, log_message_id = ?
        WHERE id = ?
      `
      ).run(logChannelId, logMessageId, ticket.id);

      logger.info(
        { ticketId: ticket.id, logChannelId, logMessageId },
        "[modmail] stored transcript message pointer"
      );

      // Build log URL
      if (logChannelId && interaction.guildId) {
        logUrl = `https://discord.com/channels/${interaction.guildId}/${logChannelId}/${logMessageId}`;
      }
    }

    // Refresh review card after close
    try {
      const { ensureReviewMessage } = await import("../review.js");
      const { findAppByShortCode } = await import("../appLookup.js");
      const app =
        interaction.guildId && ticket.app_code
          ? (findAppByShortCode(interaction.guildId, ticket.app_code) as { id: string } | null)
          : null;
      if (app) {
        await ensureReviewMessage(interaction.client, app.id);
        logger.info({ code: ticket.app_code, appId: app.id }, "[review] card refreshed");
      }
    } catch (err) {
      logger.warn({ err, ticketId: ticket.id }, "[review] failed to refresh card after close");
    }

    // Track in wide event
    enrichEvent((e) => {
      e.setFeature("modmail", "close_thread");
      e.addEntity({ type: "ticket", id: String(ticket.id) });
      e.addEntity({ type: "user", id: ticket.user_id });
      e.addAttr("transcriptLines", transcriptLines);
      if (ticket.app_code) e.addAttr("appCode", ticket.app_code);
    });

    // Log modmail close action (before auto-delete so we know which action was taken)
    let archiveAction: "delete" | "archive" = "archive";

    // Auto-delete or leave thread based on config (after transcript is flushed)
    if (threadForCleanup && interaction.guildId) {
      const cfg = getConfig(interaction.guildId);
      const preferDelete = cfg?.modmail_delete_on_close !== false; // default true

      try {
        if (preferDelete) {
          archiveAction = "delete";
          await threadForCleanup.delete("Closed by decision - transcript flushed");
          logger.info({ threadId: threadForCleanup.id }, "[modmail] thread deleted after close");
        } else {
          archiveAction = "archive";
          // Fall back: hide it by leaving the thread
          try {
            await threadForCleanup.members.remove(interaction.client.user!.id);
          } catch (leaveErr) {
            logger.debug(
              { err: leaveErr, threadId: threadForCleanup.id },
              "[modmail] bot already not in thread"
            );
          }
          logger.info(
            { threadId: threadForCleanup.id },
            "[modmail] thread archived/locked; bot removed"
          );
        }
      } catch (cleanupErr) {
        logger.warn(
          { err: cleanupErr, threadId: threadForCleanup.id },
          "[modmail] cleanup failed after close (non-fatal)"
        );
      }
    }

    // Log modmail close action with transcript metadata
    if (interaction.guild) {
      await logActionPretty(interaction.guild, {
        appId: undefined,
        appCode: ticket.app_code || undefined,
        actorId: interaction.user.id,
        subjectId: ticket.user_id,
        action: "modmail_close",
        meta: {
          transcriptLines,
          archive: archiveAction,
        },
      }).catch((err) => {
        logger.warn({ err, ticketId: ticket.id }, "[modmail] failed to log modmail_close");
      });
    }

    return {
      success: true,
      message: logUrl ? `Modmail closed. Logs: ${logUrl}` : "Modmail thread closed.",
      logUrl,
    };
  } catch (err) {
    logger.error({ err, ticketId: ticket.id }, "[modmail] failed to close thread");
    captureException(err, { area: "modmail:closeThread", ticketId: ticket.id });
    return { success: false, message: "Failed to close modmail thread. Check logs." };
  }
}

// ===== Auto-close for Application Decisions =====

/**
 * closeModmailForApplication
 * WHAT: Auto-close modmail for an application when a decision is made.
 * WHY: Ensures audit trail and cleanup on approve/reject decisions.
 * HOW: Ordered sequence - close message -> transcript flush -> archive/delete -> cleanup.
 * SAFETY: Resilient to permission errors; never blocks decision flow.
 * PARAMS:
 *  - guildId: Guild ID
 *  - userId: User ID
 *  - appCode: Application code
 *  - options: Reason, client, and guild
 */
export async function closeModmailForApplication(
  guildId: string,
  userId: string,
  appCode: string,
  options: {
    reason: "approved" | "rejected" | "permanently rejected" | "kicked";
    client: Client;
    guild: Guild;
  }
): Promise<void> {
  const { reason, client, guild } = options;

  logger.info({ guildId, userId, appCode, reason }, "[modmail] close:start auto-close on decision");

  // Guard: if already closed or doesn't exist, nothing to do
  const ticket = getOpenTicketByUser(guildId, userId);
  if (!ticket || ticket.status !== "open") {
    logger.debug({ guildId, userId }, "[modmail] close:start no open ticket (idempotent)");
    return;
  }

  const ticketId = ticket.id;
  const threadId = ticket.thread_id;

  try {
    const reasonText =
      reason === "approved"
        ? "Your application has been approved."
        : reason === "rejected"
          ? "Your application has been rejected."
          : reason === "permanently rejected"
            ? "Your application has been permanently rejected and you cannot apply again."
            : "You have been removed from the server.";

    // ===== PHASE A: Send closing message (best effort, before archive) =====
    let closingMessageResult: "ok" | "skip" | "err" = "skip";
    let thread: ThreadChannel | null = null;

    if (threadId) {
      try {
        const ch = await client.channels.fetch(threadId);
        if (ch?.isThread()) {
          thread = ch as ThreadChannel;
          closingMessageResult = await trySendClosingMessage(thread, reasonText);
        }
      } catch (err) {
        logger.debug({ err, threadId }, "[modmail] close:closing_message fetch failed");
        closingMessageResult = "err";
      }
    }

    logger.info(
      { ticketId, threadId, result: closingMessageResult },
      "[modmail] close:closing_message"
    );

    // ===== PHASE B: Flush transcript to log channel =====
    const { messageId: logMessageId, lineCount: transcriptLines } = await flushTranscript({
      client,
      ticketId,
      guildId,
      userId,
      appCode: ticket.app_code ?? appCode,
    });

    logger.info(
      {
        ticketId,
        threadId,
        lines: transcriptLines,
        logMessageId: logMessageId ?? null,
        ok: !!logMessageId,
      },
      "[modmail] close:transcript"
    );

    // Save log message pointer to DB
    if (logMessageId) {
      const cfg = getConfig(guildId);
      const logChannelId = cfg?.modmail_log_channel_id ?? null;

      db.prepare(
        `
        UPDATE modmail_ticket
        SET log_channel_id = ?, log_message_id = ?
        WHERE id = ?
      `
      ).run(logChannelId, logMessageId, ticketId);
    }

    // ===== PHASE C: Archive/lock or delete thread =====
    let archiveResult: { action: string; ok: boolean; code?: number } = {
      action: "none",
      ok: true,
    };

    if (thread) {
      const cfg = getConfig(guildId);
      const deleteOnClose = cfg?.modmail_delete_on_close !== false; // default true

      archiveResult = await archiveOrDeleteThread(thread, deleteOnClose, client);
      logger.info(
        {
          ticketId,
          threadId,
          action: archiveResult.action,
          ok: archiveResult.ok,
          code: archiveResult.code,
        },
        "[modmail] close:archive"
      );
    }

    // ===== PHASE D: Cleanup guard table and DB status =====
    db.transaction(() => {
      closeTicket(ticketId);
      cleanupOpenModmail(guildId, userId, threadId);
    })();

    logger.info({ ticketId, threadId, guildId, userId }, "[modmail] close:cleanup ok");

    // ===== Best-effort: DM applicant about closure =====
    try {
      const user = await client.users.fetch(userId);
      const closeEmbed = new EmbedBuilder()
        .setTitle("Modmail Closed")
        .setDescription(
          `Your modmail thread for **${guild.name}** has been closed.\n\n**Reason:** ${reasonText}`
        )
        .setColor(0x808080)
        .setTimestamp();

      await user.send({ embeds: [closeEmbed], allowedMentions: SAFE_ALLOWED_MENTIONS });
      logger.debug({ ticketId, userId }, "[modmail] close:dm_user ok");
    } catch (err) {
      logger.debug({ err, ticketId, userId }, "[modmail] close:dm_user err (non-fatal)");
    }

    // ===== Refresh review card =====
    try {
      const { ensureReviewMessage } = await import("../review.js");
      const { findAppByShortCode } = await import("../appLookup.js");
      const app = ticket.app_code
        ? (findAppByShortCode(guildId, ticket.app_code) as { id: string } | null)
        : null;
      if (app) {
        await ensureReviewMessage(client, app.id);
        logger.debug(
          { code: ticket.app_code, appId: app.id },
          "[modmail] close:review_card refreshed"
        );
      }
    } catch (err) {
      logger.debug({ err, ticketId }, "[modmail] close:review_card err (non-fatal)");
    }

    // Track in wide event
    enrichEvent((e) => {
      e.setFeature("modmail", "auto_close");
      e.addEntity({ type: "ticket", id: String(ticketId) });
      e.addEntity({ type: "user", id: userId });
      e.addAttr("reason", reason);
      e.addAttr("transcriptLines", transcriptLines);
      e.addAttr("archiveAction", archiveResult.action);
      if (ticket.app_code) e.addAttr("appCode", ticket.app_code);
    });
  } catch (err) {
    logger.error({ err, ticketId, threadId, reason }, "[modmail] close:fatal unexpected error");
    captureException(err, { area: "modmail:autoClose", ticketId });

    // Best effort: mark closed in DB even if other steps failed
    try {
      db.transaction(() => {
        closeTicket(ticketId);
        cleanupOpenModmail(guildId, userId, threadId);
      })();
      logger.warn({ ticketId }, "[modmail] close:cleanup forced after error");
    } catch (cleanupErr) {
      logger.error({ err: cleanupErr, ticketId }, "[modmail] close:cleanup failed");
    }
  }
}
