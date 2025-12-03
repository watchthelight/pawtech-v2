/**
 * Pawtropolis Tech -- src/features/modmail/tickets.ts
 * WHAT: Ticket CRUD operations for the modmail system.
 * WHY: Centralize database operations for modmail tickets.
 * DOCS:
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - SQLite INSERT: https://sqlite.org/lang_insert.html
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../../db/db.js";
import type { ModmailTicket, ModmailMessageMap } from "./types.js";
import { touchSyncMarker } from "../../lib/syncMarker.js";

// ===== Ticket CRUD =====

/**
 * createTicket
 * WHAT: Create a new modmail ticket.
 * WHY: Initializes a modmail conversation with tracking.
 * @returns The ticket ID
 */
// GOTCHA: Returns the numeric ticket ID, not the ticket object itself.
// If you need the full ticket after creation, call getTicketById separately.
export function createTicket(params: {
  guildId: string;
  userId: string;
  appCode?: string;
  reviewMessageId?: string;
  threadId?: string;
}): number {
  const result = db
    .prepare(
      `
    INSERT INTO modmail_ticket (guild_id, user_id, app_code, review_message_id, thread_id)
    VALUES (?, ?, ?, ?, ?)
  `
    )
    .run(
      params.guildId,
      params.userId,
      params.appCode ?? null,
      params.reviewMessageId ?? null,
      params.threadId ?? null
    );
  touchSyncMarker("modmail_ticket_create");
  // WHY Number()? SQLite returns BigInt for lastInsertRowid, but our schema
  // uses INTEGER PRIMARY KEY which fits in a JS number. This cast is safe
  // unless you somehow create 9 quadrillion tickets, at which point you
  // have bigger problems.
  return Number(result.lastInsertRowid);
}

/**
 * getOpenTicketByUser
 * WHAT: Find the most recent open ticket for a user in a guild.
 * WHY: Check if user already has an active modmail before opening new one.
 */
export function getOpenTicketByUser(guildId: string, userId: string): ModmailTicket | null {
  /*
   * GOTCHA: "Most recent" means most recent by created_at, not ID.
   * In theory these should be the same, but if someone ever imports
   * tickets or messes with the DB directly, you could get weird results.
   * ORDER BY id DESC would be more reliable, but this is what we have.
   */
  const row = db
    .prepare(
      `
    SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, thread_channel_id, status, created_at, closed_at
    FROM modmail_ticket
    WHERE guild_id = ? AND user_id = ? AND status = 'open'
    ORDER BY created_at DESC
    LIMIT 1
  `
    )
    .get(guildId, userId) as ModmailTicket | undefined;
  return row ?? null;
}

/**
 * getTicketByThread
 * WHAT: Find a ticket by its thread ID.
 * WHY: Look up ticket when routing messages from a modmail thread.
 */
export function getTicketByThread(threadId: string): ModmailTicket | null {
  // This returns both open AND closed tickets. Callers need to check
  // status themselves if they only want open ones. Ask me how I know.
  const row = db
    .prepare(
      `
    SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, thread_channel_id, status, created_at, closed_at
    FROM modmail_ticket
    WHERE thread_id = ?
  `
    )
    .get(threadId) as ModmailTicket | undefined;
  return row ?? null;
}

/**
 * getTicketById
 * WHAT: Fetch a ticket by its ID.
 * WHY: Used for ticket operations that already have the ticket ID.
 */
export function getTicketById(ticketId: number): ModmailTicket | null {
  const row = db
    .prepare(
      `
    SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, thread_channel_id, status, created_at, closed_at
    FROM modmail_ticket
    WHERE id = ?
  `
    )
    .get(ticketId) as ModmailTicket | undefined;
  return row ?? null;
}

/**
 * findModmailTicketForApplication
 * WHAT: Finds the most recent modmail ticket for a given application code.
 * WHY: Prevents duplicate modmail threads for the same application.
 */
export function findModmailTicketForApplication(
  guildId: string,
  appCode: string
): ModmailTicket | null {
  /*
   * Note: This orders by id DESC, not created_at like getOpenTicketByUser.
   * The inconsistency is intentional (or maybe it isn't, who remembers).
   * For application lookups we want the absolute latest ticket regardless
   * of any clock drift shenanigans.
   */
  const row = db
    .prepare(
      `
    SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, thread_channel_id, status, created_at, closed_at
    FROM modmail_ticket
    WHERE guild_id = ? AND app_code = ?
    ORDER BY id DESC
    LIMIT 1
  `
    )
    .get(guildId, appCode) as ModmailTicket | undefined;
  return row ?? null;
}

/**
 * updateTicketThread
 * WHAT: Associate a thread with a ticket.
 * WHY: Link the Discord thread to the ticket after creation.
 */
export function updateTicketThread(ticketId: number, threadId: string) {
  db.prepare(`UPDATE modmail_ticket SET thread_id = ? WHERE id = ?`).run(threadId, ticketId);
}

/**
 * closeTicket
 * WHAT: Mark a ticket as closed.
 * WHY: End the modmail conversation and record close time.
 */
export function closeTicket(ticketId: number) {
  // No-op if the ticket doesn't exist. We don't throw because racing
  // close requests happen more often than you'd think (button mashing).
  db.prepare(
    `UPDATE modmail_ticket SET status = 'closed', closed_at = datetime('now') WHERE id = ?`
  ).run(ticketId);
}

/**
 * reopenTicket
 * WHAT: Reopen a closed ticket.
 * WHY: Allow continuing a conversation after closure.
 */
export function reopenTicket(ticketId: number) {
  // Clears closed_at so the ticket looks like it was never closed.
  // Original creation time is preserved though, for the historians.
  db.prepare(`UPDATE modmail_ticket SET status = 'open', closed_at = NULL WHERE id = ?`).run(
    ticketId
  );
}

// ===== Message Mapping =====

/**
 * Internal type for the message mapping insert (different from exported type)
 */
type ModmailMessageInsert = {
  ticketId: number;
  direction: "to_user" | "to_staff";
  threadMessageId?: string;
  dmMessageId?: string;
  replyToThreadMessageId?: string;
  replyToDmMessageId?: string;
  content?: string;
};

/**
 * insertModmailMessage
 * WHAT: Record a message mapping between thread and DM.
 * WHY: Enable reply chains and transcript reconstruction.
 * NOTE: Uses ON CONFLICT for idempotent inserts (handles retries).
 */
export function insertModmailMessage(map: ModmailMessageInsert) {
  /*
   * This query uses named parameters (@ticketId, etc.) instead of positional (?).
   * Cleaner for complex inserts, but you have to pass an object with matching keys.
   *
   * The ON CONFLICT clause makes this idempotent - you can call it twice with the
   * same thread_message_id and it'll just merge in any new data. Saved us during
   * that one retry storm incident.
   */
  const stmt = db.prepare(`
    INSERT INTO modmail_message
      (ticket_id, direction, thread_message_id, dm_message_id, reply_to_thread_message_id, reply_to_dm_message_id, content)
    VALUES (@ticketId, @direction, @threadMessageId, @dmMessageId, @replyToThreadMessageId, @replyToDmMessageId, @content)
    ON CONFLICT(thread_message_id) DO UPDATE SET
      dm_message_id = COALESCE(excluded.dm_message_id, dm_message_id),
      reply_to_thread_message_id = COALESCE(excluded.reply_to_thread_message_id, reply_to_thread_message_id),
      reply_to_dm_message_id = COALESCE(excluded.reply_to_dm_message_id, reply_to_dm_message_id),
      content = COALESCE(excluded.content, content)
  `);
  stmt.run(map);
}

/**
 * getThreadIdForDmReply
 * WHAT: Find the thread message ID for a given DM message.
 * WHY: Create reply chains when user replies to a specific DM.
 */
export function getThreadIdForDmReply(dmMessageId: string): string | null {
  // Returns null if the message wasn't found OR if thread_message_id was
  // never set. Callers can't distinguish between these cases, which is
  // usually fine because the result is the same: don't try to reply.
  const row = db
    .prepare(
      `
    SELECT thread_message_id
    FROM modmail_message
    WHERE dm_message_id = ?
  `
    )
    .get(dmMessageId) as { thread_message_id: string | null } | undefined;
  return row?.thread_message_id ?? null;
}

/**
 * getDmIdForThreadReply
 * WHAT: Find the DM message ID for a given thread message.
 * WHY: Create reply chains when staff replies to a specific thread message.
 */
export function getDmIdForThreadReply(threadMessageId: string): string | null {
  const row = db
    .prepare(
      `
    SELECT dm_message_id
    FROM modmail_message
    WHERE thread_message_id = ?
  `
    )
    .get(threadMessageId) as { dm_message_id: string | null } | undefined;
  return row?.dm_message_id ?? null;
}
