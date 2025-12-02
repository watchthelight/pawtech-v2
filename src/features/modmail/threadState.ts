/**
 * Pawtropolis Tech -- src/features/modmail/threadState.ts
 * WHAT: In-memory tracking of open modmail threads.
 * WHY: Enables fast routing checks without DB queries per message.
 * DOCS:
 *  - Set: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Client } from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";

/**
 * In-memory set to track open modmail threads for efficient routing.
 *
 * Without this, we'd need a DB query on EVERY message to check if it's in a
 * modmail thread. That's expensive at scale. Instead, we keep thread IDs in
 * memory and only query DB when the set says "yes, this is a modmail thread".
 *
 * IMPORTANT: This must stay in sync with the database. We add on thread open,
 * remove on thread close, and hydrate from DB on startup. If the bot crashes
 * mid-operation, startup hydration will fix any inconsistencies.
 */
export const OPEN_MODMAIL_THREADS = new Set<string>();

/**
 * hydrateOpenModmailThreadsOnStartup
 * WHAT: Load all open modmail thread IDs into memory on startup.
 * WHY: Enables fast routing checks without DB queries per message.
 */
export async function hydrateOpenModmailThreadsOnStartup(client: Client) {
  const rows = db
    .prepare(`SELECT thread_id FROM modmail_ticket WHERE status = 'open' AND thread_id IS NOT NULL`)
    .all() as { thread_id: string }[];
  for (const row of rows) {
    OPEN_MODMAIL_THREADS.add(row.thread_id);
  }
  logger.info({ count: OPEN_MODMAIL_THREADS.size }, "[modmail] hydrated open threads");
}

/**
 * addOpenThread
 * WHAT: Add a thread ID to the open set.
 * WHY: Called when opening a new modmail thread.
 */
export function addOpenThread(threadId: string) {
  OPEN_MODMAIL_THREADS.add(threadId);
}

/**
 * removeOpenThread
 * WHAT: Remove a thread ID from the open set.
 * WHY: Called when closing a modmail thread.
 */
export function removeOpenThread(threadId: string) {
  OPEN_MODMAIL_THREADS.delete(threadId);
}

/**
 * isOpenModmailThread
 * WHAT: Check if a thread ID is in the open modmail set.
 * WHY: Fast check for message routing without DB query.
 */
export function isOpenModmailThread(threadId: string): boolean {
  return OPEN_MODMAIL_THREADS.has(threadId);
}
