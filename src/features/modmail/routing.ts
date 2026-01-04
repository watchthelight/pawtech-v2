/**
 * Pawtropolis Tech -- src/features/modmail/routing.ts
 * WHAT: DM-thread message routing for modmail system.
 * WHY: Routes messages between applicant DMs and modmail threads bidirectionally.
 * DOCS:
 *  - DM channels: https://discord.com/developers/docs/resources/channel#channel-object
 *  - Thread channels: https://discord.com/developers/docs/resources/channel#thread-object
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  Client,
  EmbedBuilder,
  type Message,
  type ThreadChannel,
} from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { captureException } from "../../lib/sentry.js";
import { enrichEvent } from "../../lib/reqctx.js";
import type { ModmailTicket } from "./types.js";
import {
  insertModmailMessage,
  getThreadIdForDmReply,
  getDmIdForThreadReply,
  getTicketByThread,
} from "./tickets.js";
import { appendTranscript, formatContentWithAttachments } from "./transcript.js";
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";

// ===== Embed Builders =====

/**
 * buildStaffToUserEmbed
 * WHAT: Builds an embed for messages sent from staff to users via modmail.
 * WHY: Hides staff identity (name/avatar) to prevent targeted harassment or doxxing.
 * PRIVACY: Footer shows only server name/icon instead of individual staff member.
 * DOCS:
 *  - EmbedBuilder: https://discord.js.org/#/docs/discord.js/main/class/EmbedBuilder
 *  - setImage: https://discord.js.org/#/docs/discord.js/main/class/EmbedBuilder?scrollTo=setImage
 */
export function buildStaffToUserEmbed(args: {
  staffDisplayName: string;
  staffAvatarUrl?: string | null;
  content: string;
  imageUrl?: string | null;
  guildName?: string;
  guildIconUrl?: string | null;
}) {
  // WHY the space fallback for empty content? Discord rejects embeds with empty
  // descriptions. A single space is invisible but keeps the API happy.
  const e = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setDescription(args.content || " ")
    .setTimestamp()
    // Use generic server identity instead of staff identity for privacy.
    // Staff have been harassed by rejected applicants. This is why we can't have nice things.
    .setFooter({
      text: args.guildName || "Pawtropolis Tech",
      iconURL: args.guildIconUrl ?? undefined,
    });

  // Include first image attachment if present
  if (args.imageUrl) e.setImage(args.imageUrl);
  return e;
}

/**
 * buildUserToStaffEmbed
 * WHAT: Builds an embed for messages from user to staff thread.
 * WHY: Displays user info for staff reference.
 */
export function buildUserToStaffEmbed(args: {
  userDisplayName: string;
  userAvatarUrl?: string | null;
  content: string;
  imageUrl?: string | null;
}) {
  const e = new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription(args.content || " ")
    .setTimestamp()
    .setFooter({ text: args.userDisplayName, iconURL: args.userAvatarUrl ?? undefined });

  if (args.imageUrl) e.setImage(args.imageUrl);
  return e;
}

// ===== Message Forwarding Tracking =====

/**
 * In-memory map to prevent echo loops in message routing.
 *
 * Problem: When staff sends "Hello" in the thread, we forward it to the user's DM.
 * The bot sends that DM. Without this map, the DM handler might see the bot's
 * message and try to route it back to the thread, creating an infinite loop.
 *
 * Solution: Hybrid time + size-based eviction
 * - Time-based: Entries expire after 5 minutes TTL
 * - Size-based: Eviction triggers at 5,000 entries (prevents unbounded growth)
 * - Cleanup: Runs every 60 seconds to remove expired entries
 *
 * Memory: Max ~250KB (2,500 entries after eviction x 100 bytes/entry)
 *
 * Uses a Map with timestamps + periodic cleanup instead of Set with setTimeout
 * to avoid accumulating thousands of pending timers under high load.
 */
/*
 * WHY use a Map instead of a Set with setTimeout cleanup?
 * Under high message volume, you'd have thousands of timers piling up in the event
 * loop, which is a great way to make your memory usage graph look like a hockey stick.
 * The periodic cleanup approach trades a tiny bit of memory (timestamps) for sanity.
 */
const forwardedMessages = new Map<string, number>(); // messageId -> timestamp
const FORWARDED_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
const FORWARDED_MAX_SIZE = 10000; // Hard limit - never exceed this
const FORWARDED_EVICTION_SIZE = 5000; // Start evicting at this size
const FORWARDED_CLEANUP_INTERVAL_MS = 60 * 1000; // Cleanup every minute

// Periodic cleanup to remove expired entries
const forwardedCleanupInterval = setInterval(() => {
  const now = Date.now();
  const sizeBefore = forwardedMessages.size;
  let cleaned = 0;

  for (const [msgId, timestamp] of forwardedMessages) {
    if (now - timestamp > FORWARDED_TTL_MS) {
      forwardedMessages.delete(msgId);
      cleaned++;
    }
  }

  // Log if we cleaned entries or if Map is large (monitoring for memory issues)
  if (cleaned > 0 || sizeBefore > 1000) {
    logger.debug(
      { cleaned, sizeBefore, sizeAfter: forwardedMessages.size },
      "[modmail] forwardedMessages cleanup"
    );
  }
}, FORWARDED_CLEANUP_INTERVAL_MS);
// GOTCHA: Without unref(), Node will keep the process alive forever waiting for
// this interval. Ask me how I know.
forwardedCleanupInterval.unref();

/**
 * evictOldestEntries
 * WHAT: Remove oldest entries from forwardedMessages Map to stay under size limit.
 * WHY: Prevents unbounded memory growth under high message volume.
 * PARAMS:
 *  - targetSize: Number of entries to keep after eviction
 */
function evictOldestEntries(targetSize: number) {
  // Sort entries by timestamp (oldest first) and remove oldest.
  // Yes, this is O(n log n) which isn't great, but it only runs when we hit
  // 5000 entries. If that's happening often, the bot has bigger problems.
  const entries = Array.from(forwardedMessages.entries()).sort(
    (a, b) => a[1] - b[1]
  );

  const toRemove = entries.slice(0, entries.length - targetSize);
  for (const [msgId] of toRemove) {
    forwardedMessages.delete(msgId);
  }

  logger.debug(
    { removed: toRemove.length, remaining: forwardedMessages.size },
    "[modmail] size-based eviction"
  );
}

/**
 * isForwarded
 * WHAT: Check if a message has already been forwarded.
 * WHY: Prevents echo loops in message routing.
 */
export function isForwarded(messageId: string): boolean {
  const timestamp = forwardedMessages.get(messageId);
  if (!timestamp) return false;
  // Check if entry is expired
  if (Date.now() - timestamp > FORWARDED_TTL_MS) {
    forwardedMessages.delete(messageId);
    return false;
  }
  return true;
}

/**
 * markForwarded
 * WHAT: Mark a message as forwarded.
 * WHY: Prevents the same message from being routed again.
 * NOTE: Triggers size-based eviction if Map grows too large.
 */
export function markForwarded(messageId: string) {
  // Hard cap enforcement: refuse to add if at max size (prevents memory exhaustion)
  if (forwardedMessages.size >= FORWARDED_MAX_SIZE) {
    logger.warn(
      { size: forwardedMessages.size, maxSize: FORWARDED_MAX_SIZE },
      "[modmail] forwardedMessages at hard cap - evicting oldest entries"
    );
    evictOldestEntries(FORWARDED_EVICTION_SIZE / 2);
  }

  forwardedMessages.set(messageId, Date.now());

  // Soft size-based eviction if Map grows too large
  if (forwardedMessages.size > FORWARDED_EVICTION_SIZE) {
    evictOldestEntries(FORWARDED_EVICTION_SIZE / 2);
  }
}

// ===== Message Routing =====

/**
 * routeThreadToDm
 * WHAT: Route a message from the modmail thread to the applicant's DM.
 * WHY: Enables staff to communicate with applicants via thread.
 * PARAMS:
 *  - message: The thread message from staff
 *  - ticket: The modmail ticket
 *  - client: Discord client
 */
export async function routeThreadToDm(message: Message, ticket: ModmailTicket, client: Client) {
  // GOTCHA: Early returns here are your friend. Without them, staff chit-chat in
  // the thread would spam the applicant's DMs. Only messages from real staff
  // that haven't already been processed should make it through.
  if (message.author.bot) return;
  if (isForwarded(message.id)) return;

  // Ignore empty messages
  if (!message.content && message.attachments.size === 0) return;

  try {
    const user = await client.users.fetch(ticket.user_id);
    const guild = message.guild;
    if (!guild) return;

    // Fetch member to get display name.
    // We still collect staff info even though we don't show it in the embed (privacy).
    // It's used for internal logging and transcripts.
    let staffDisplayName: string;
    let staffAvatarUrl: string | null = null;
    try {
      const member = await guild.members.fetch(message.author.id);
      // The triple-fallback chain is ugly but necessary. Discord's naming is a mess -
      // displayName, globalName, username are all different things that may or may not exist.
      staffDisplayName =
        member.displayName ?? member.user.globalName ?? member.user.username ?? "Staff";
      staffAvatarUrl = member.displayAvatarURL({ size: 128 });
    } catch {
      staffDisplayName = message.author.globalName ?? message.author.username;
      staffAvatarUrl = message.author.displayAvatarURL({ size: 128 });
    }

    // Extract first image URL
    let imageUrl: string | null = null;
    for (const att of message.attachments.values()) {
      if (att.contentType?.startsWith("image/")) {
        imageUrl = att.url;
        break;
      }
    }

    // Detect reply - preserves threading across the DM/thread boundary.
    // Without this, conversations would become a confusing wall of text.
    let replyToDmMessageId: string | undefined;
    if (message.reference?.messageId) {
      const replyToThreadId = message.reference.messageId;
      const dmId = getDmIdForThreadReply(replyToThreadId);
      if (dmId) {
        replyToDmMessageId = dmId;
      }
    }

    // Build embed with guild info for privacy (no staff identity in DM)
    const embed = buildStaffToUserEmbed({
      staffDisplayName,
      staffAvatarUrl,
      content: message.content,
      imageUrl,
      guildName: guild.name,
      guildIconUrl: guild.iconURL({ size: 128 }),
    });

    // Send to DM
    const dmMessage = await user.send({
      embeds: [embed],
      allowedMentions: SAFE_ALLOWED_MENTIONS,
      ...(replyToDmMessageId && {
        reply: { messageReference: replyToDmMessageId, failIfNotExists: false },
      }),
    });

    markForwarded(dmMessage.id);

    // Format content with attachments for complete audit trail
    const transcriptContent = formatContentWithAttachments(message.content, message.attachments);

    /*
     * WHY double-store the transcript (DB + in-memory buffer)?
     * The in-memory buffer is fast for real-time transcript generation when closing.
     * The DB version survives restarts and is the source of truth for historical lookups.
     * Yes, it's redundant. No, I'm not refactoring it at 2am.
     */
    insertModmailMessage({
      ticketId: ticket.id,
      direction: "to_user",
      threadMessageId: message.id,
      dmMessageId: dmMessage.id,
      replyToThreadMessageId: message.reference?.messageId,
      replyToDmMessageId,
      content: transcriptContent,
    });

    appendTranscript(ticket.id, "STAFF", transcriptContent);

    // Track in wide event
    enrichEvent((e) => {
      e.setFeature("modmail", "relay_message");
      e.addEntity({ type: "ticket", id: String(ticket.id) });
      e.addAttr("direction", "staff_to_user");
      e.addAttr("messageLength", message.content.length);
    });
  } catch (err) {
    logger.warn(
      { err, ticketId: ticket.id, userId: ticket.user_id },
      "[modmail] failed to route thread -> DM"
    );
    captureException(err, { area: "modmail:routeThreadToDm", ticketId: ticket.id });

    // Try to notify in thread - staff should know their message didn't go through.
    // The nested try-catch is ugly but necessary. If both the DM and the thread
    // notification fail, we've done what we can. Time to go home.
    try {
      await message.reply({
        content: "Failed to deliver message to applicant (DMs may be closed).",
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      });
    } catch {
      // Best effort
    }
  }
}

/**
 * routeDmToThread
 * WHAT: Route a DM from the applicant to the modmail thread.
 * WHY: Enables applicants to communicate with staff via DM.
 * PARAMS:
 *  - message: The DM message from applicant
 *  - ticket: The modmail ticket
 *  - client: Discord client
 */
export async function routeDmToThread(message: Message, ticket: ModmailTicket, client: Client) {
  if (message.author.bot) return;
  if (isForwarded(message.id)) return;

  // Ignore empty messages
  if (!message.content && message.attachments.size === 0) return;

  // Edge case: ticket exists but thread_id is null. This can happen if thread
  // creation failed mid-way through. The ticket is basically orphaned at this point.
  if (!ticket.thread_id) {
    logger.warn({ ticketId: ticket.id }, "[modmail] no thread_id for DM routing");
    return;
  }

  try {
    const channel = await client.channels.fetch(ticket.thread_id);
    if (!channel || !channel.isThread()) {
      logger.warn(
        { ticketId: ticket.id, threadId: ticket.thread_id },
        "[modmail] thread not found or not a thread"
      );
      return;
    }
    const thread = channel as ThreadChannel;

    // Detect reply
    let replyToThreadMessageId: string | undefined;
    if (message.reference?.messageId) {
      const replyToDmId = message.reference.messageId;
      const threadId = getThreadIdForDmReply(replyToDmId);
      if (threadId) {
        replyToThreadMessageId = threadId;
      }
    }

    // Extract first image URL
    let imageUrl: string | null = null;
    for (const att of message.attachments.values()) {
      if (att.contentType?.startsWith("image/")) {
        imageUrl = att.url;
        break;
      }
    }

    // Build embed
    const embed = buildUserToStaffEmbed({
      userDisplayName: message.author.globalName ?? message.author.username,
      userAvatarUrl: message.author.displayAvatarURL({ size: 128 }),
      content: message.content,
      imageUrl,
    });

    // Send to thread
    const threadMessage = await thread.send({
      embeds: [embed],
      allowedMentions: SAFE_ALLOWED_MENTIONS,
      ...(replyToThreadMessageId && {
        reply: { messageReference: replyToThreadMessageId, failIfNotExists: false },
      }),
    });

    markForwarded(threadMessage.id);

    // Format content with attachments for complete audit trail
    const transcriptContent = formatContentWithAttachments(message.content, message.attachments);

    // Store mapping + content for transcript persistence (survives bot restarts)
    insertModmailMessage({
      ticketId: ticket.id,
      direction: "to_staff",
      threadMessageId: threadMessage.id,
      dmMessageId: message.id,
      replyToThreadMessageId,
      replyToDmMessageId: message.reference?.messageId,
      content: transcriptContent, // Persist content with attachments for transcript
    });

    // Append to transcript buffer for audit trail (in-memory, also persisted above)
    appendTranscript(ticket.id, "USER", transcriptContent);

    // Track in wide event
    enrichEvent((e) => {
      e.setFeature("modmail", "relay_message");
      e.addEntity({ type: "ticket", id: String(ticket.id) });
      e.addAttr("direction", "user_to_staff");
      e.addAttr("messageLength", message.content.length);
    });
  } catch (err) {
    logger.warn(
      { err, ticketId: ticket.id, threadId: ticket.thread_id },
      "[modmail] failed to route DM -> thread"
    );
    captureException(err, { area: "modmail:routeDmToThread", ticketId: ticket.id });
  }
}

// ===== Inbound Message Handlers =====

/**
 * handleInboundDmForModmail
 * WHAT: Handles incoming DM messages for modmail routing.
 * WHY: Routes applicant DMs to the appropriate modmail thread.
 * PARAMS:
 *  - message: The DM message
 *  - client: Discord client
 */
export async function handleInboundDmForModmail(message: Message, client: Client) {
  if (message.author.bot) return;

  /*
   * GOTCHA: "across all guilds" means if a user has open modmail in multiple
   * servers (rare but possible), we route to the most recent one. This might
   * not be what the user expects. We prioritize simplicity over edge case
   * handling here - supporting multi-guild selection would require actual UX work.
   */
  const ticket = db
    .prepare(
      `
    SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, thread_channel_id, status, created_at, closed_at
    FROM modmail_ticket
    WHERE user_id = ? AND status = 'open'
    ORDER BY created_at DESC
    LIMIT 1
  `
    )
    .get(message.author.id) as ModmailTicket | undefined;

  if (ticket) {
    await routeDmToThread(message, ticket, client);
  }
}

/**
 * handleInboundThreadMessageForModmail
 * WHAT: Handles incoming thread messages for modmail routing.
 * WHY: Routes staff thread messages to the applicant's DM.
 * PARAMS:
 *  - message: The thread message
 *  - client: Discord client
 */
export async function handleInboundThreadMessageForModmail(message: Message, client: Client) {
  if (message.author.bot) return;
  if (!message.channel.isThread()) return;
  if (!message.guildId) return;

  // The getTicketByThread lookup is fast (indexed query), so we can afford to
  // check every thread message. False positives (messages in non-modmail threads)
  // just return null and exit early.
  const ticket = getTicketByThread(message.channel.id);
  if (ticket && ticket.status === "open") {
    await routeThreadToDm(message, ticket, client);
  }
}

// ===== Testing Exports =====

/**
 * _testing
 * WHAT: Exports internal state and helpers for testing.
 * WHY: Allows unit tests to verify size-based eviction behavior.
 * NOTE: Only use in tests, not in production code.
 */
// Exposing internals for testing. If you're importing this in production code,
// that's on you. The underscore prefix is the "please don't" convention.
export const _testing = {
  getForwardedMessagesSize: () => forwardedMessages.size,
  clearForwardedMessages: () => forwardedMessages.clear(),
  FORWARDED_EVICTION_SIZE,
  FORWARDED_MAX_SIZE,
};
