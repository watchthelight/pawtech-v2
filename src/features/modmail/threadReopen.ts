/**
 * Pawtropolis Tech -- src/features/modmail/threadReopen.ts
 * WHAT: Thread reopening logic for modmail system.
 * WHY: Allows continuing closed modmail conversations within 7 days.
 * DOCS:
 *  - Threads: https://discord.com/developers/docs/resources/channel#thread-modify
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type ChatInputCommandInteraction,
  type PrivateThreadChannel,
} from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { captureException } from "../../lib/sentry.js";
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";
import type { ModmailTicket } from "./types.js";
import { getTicketByThread, reopenTicket } from "./tickets.js";
import { addOpenThread } from "./threadState.js";
import { openPublicModmailThreadFor } from "./threadOpen.js";

// ===== Reopen Thread =====

/**
 * reopenModmailThread
 * WHAT: Reopen a closed modmail thread.
 * WHY: Allows continuing a conversation after closure (within 7 days).
 * PARAMS:
 *  - interaction: The interaction that triggered this
 *  - userId: Optional user ID
 *  - threadId: Optional thread ID
 * RETURNS: Success status and message
 */
export async function reopenModmailThread(params: {
  interaction: ChatInputCommandInteraction;
  userId?: string;
  threadId?: string;
}): Promise<{ success: boolean; message?: string }> {
  const { interaction, userId, threadId } = params;

  let ticket: ModmailTicket | null = null;

  if (userId && interaction.guildId) {
    // Find most recent closed ticket for this user
    const row = db
      .prepare(
        `
      SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, thread_channel_id, status, created_at, closed_at
      FROM modmail_ticket
      WHERE guild_id = ? AND user_id = ? AND status = 'closed'
      ORDER BY closed_at DESC
      LIMIT 1
    `
      )
      .get(interaction.guildId, userId) as ModmailTicket | undefined;
    ticket = row ?? null;
  } else if (threadId) {
    ticket = getTicketByThread(threadId);
  } else if (interaction.channel?.isThread()) {
    ticket = getTicketByThread(interaction.channel.id);
  }

  if (!ticket) {
    return { success: false, message: "No closed modmail ticket found." };
  }

  if (ticket.status === "open") {
    return { success: false, message: "This ticket is already open." };
  }

  // Check if closed within 7 days
  const closedAt = ticket.closed_at ? new Date(ticket.closed_at).getTime() : 0;
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  if (now - closedAt > sevenDays) {
    // Create new thread instead
    return await openPublicModmailThreadFor({
      interaction,
      userId: ticket.user_id,
      appCode: ticket.app_code ?? undefined,
      reviewMessageId: ticket.review_message_id ?? undefined,
    });
  }

  try {
    // Reopen in DB and restore guard table in single transaction
    db.transaction(() => {
      reopenTicket(ticket.id);

      // Restore open_modmail guard table entry
      // CRITICAL: Without this, the guard table will think no ticket is open,
      // allowing duplicate threads to be created for this user
      if (interaction.guildId && ticket.user_id && ticket.thread_id) {
        db.prepare(
          `
          INSERT INTO open_modmail (guild_id, applicant_id, thread_id, created_at)
          VALUES (?, ?, ?, strftime('%s','now'))
          ON CONFLICT(guild_id, applicant_id) DO UPDATE SET thread_id=excluded.thread_id
        `
        ).run(interaction.guildId, ticket.user_id, ticket.thread_id);

        logger.debug(
          { guildId: interaction.guildId, userId: ticket.user_id, threadId: ticket.thread_id },
          "[modmail] restored open_modmail guard table entry on reopen"
        );
      }
    })();

    // Restore in-memory set for efficient routing
    // CRITICAL: Without this, messageCreate won't recognize the thread as a modmail thread
    if (ticket.thread_id) {
      addOpenThread(ticket.thread_id);
      logger.debug({ threadId: ticket.thread_id }, "[modmail] restored OPEN_MODMAIL_THREADS entry on reopen");
    }

    // Unlock and unarchive thread
    if (ticket.thread_id) {
      const thread = (await interaction.client.channels.fetch(
        ticket.thread_id
      )) as PrivateThreadChannel | null;
      if (thread) {
        await thread.setArchived(false);
        await thread.setLocked(false);
      }
    }

    // Notify applicant
    try {
      const user = await interaction.client.users.fetch(ticket.user_id);
      await user.send({
        content: `Your modmail thread for **${interaction.guild?.name ?? "the server"}** has been reopened by staff.`,
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      });
    } catch (err) {
      logger.warn(
        { err, ticketId: ticket.id, userId: ticket.user_id },
        "[modmail] failed to DM applicant on reopen"
      );
    }

    logger.info({ ticketId: ticket.id, threadId: ticket.thread_id }, "[modmail] thread reopened");

    return {
      success: true,
      message: `Modmail thread reopened: <#${ticket.thread_id}>`,
    };
  } catch (err) {
    logger.error({ err, ticketId: ticket.id }, "[modmail] failed to reopen thread");
    captureException(err, { area: "modmail:reopenThread", ticketId: ticket.id });
    return { success: false, message: "Failed to reopen modmail thread. Check logs." };
  }
}
