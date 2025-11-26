/**
 * Pawtropolis Tech — src/features/modmail.ts
 * WHAT: Modmail system for staff-applicant DM bridge via private threads.
 * WHY: Enables staff to communicate privately with applicants without exposing staff DMs.
 * Works on my machine ✓
 * FLOWS:
 *  - Open: create private thread, post starter embed, DM applicant
 *  - Route: thread messages → applicant DM, applicant DM → thread
 *  - Close/Reopen: lock/unlock thread, update DB status, notify applicant
 * DOCS:
 *  - Threads: https://discord.com/developers/docs/resources/channel#thread-create
 *  - DMs: https://discord.com/developers/docs/resources/user#create-dm
 *  - Permissions: https://discord.com/developers/docs/topics/permissions
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ThreadAutoArchiveDuration,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type MessageContextMenuCommandInteraction,
  type Message,
  type PrivateThreadChannel,
  type TextBasedChannel,
  type TextChannel,
  type ForumChannel,
  type NewsChannel,
  type ThreadChannel,
  type User,
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  type APIEmbed,
  type Attachment,
  type GuildMember as GuildMemberType,
  type Guild,
} from "discord.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { captureException } from "../lib/sentry.js";
import { shortCode } from "../lib/ids.js";
import { replyOrEdit, ensureDeferred, type CommandContext } from "../lib/cmdWrap.js";
import { hasManageGuild, isReviewer, canRunAllCommands, getConfig } from "../lib/config.js";
import { logActionPretty } from "../logging/pretty.js";
import type { GuildMember } from "discord.js";

// ===== Types =====

type ModmailTicket = {
  id: number;
  guild_id: string;
  user_id: string;
  app_code: string | null;
  review_message_id: string | null;
  thread_id: string | null;
  thread_channel_id: string | null;
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
};

// ===== Permission Checks =====

/**
 * WHAT: Precise permission flags required to start a public thread from a message.
 * WHY: ManageThreads is NOT needed to create threads - only to lock/archive/delete.
 * DOCS: https://discord.com/developers/docs/topics/permissions#permissions-for-public-threads
 */
const NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.SendMessagesInThreads,
] as const;

/**
 * WHAT: Check what permissions are missing for starting a thread.
 * WHY: Channel overwrites can silently remove perms that appear granted at role level.
 * RETURNS: Array of missing permission names (empty if all granted).
 */
function missingPermsForStartThread(
  channel: TextChannel | NewsChannel | ForumChannel,
  meId: string
): string[] {
  const perms = channel.permissionsFor(meId);
  if (!perms) return NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE.map((flag) => String(flag));

  const missing: string[] = [];
  for (const flag of NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE) {
    if (!perms.has(flag)) {
      // Convert flag bigint to readable name
      const flagName = Object.keys(PermissionFlagsBits).find(
        (key) => PermissionFlagsBits[key as keyof typeof PermissionFlagsBits] === flag
      );
      missing.push(flagName ?? String(flag));
    }
  }
  return missing;
}

// ===== Open Thread Tracking =====

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

export async function hydrateOpenModmailThreadsOnStartup(client: Client) {
  const rows = db
    .prepare(`SELECT thread_id FROM modmail_ticket WHERE status = 'open' AND thread_id IS NOT NULL`)
    .all() as { thread_id: string }[];
  for (const row of rows) {
    OPEN_MODMAIL_THREADS.add(row.thread_id);
  }
  logger.info({ count: OPEN_MODMAIL_THREADS.size }, "[modmail] hydrated open threads");
}

// ===== Transcript Buffer System =====

/**
 * WHAT: In-memory per-ticket transcript buffer for logging modmail conversations.
 * WHY: Maintains a complete audit trail of staff-user communication for compliance and review.
 * FORMAT: Array of timestamped lines with author type (STAFF/USER) and content.
 * RETENTION: Buffers are cleared after being flushed to .txt file on ticket close.
 * ROTATION: If log channel becomes full/needs archival, configure a new channel via /config.
 * DOCS:
 *  - Map: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
 *  - ISO 8601 timestamps: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString
 */
type TranscriptLine = {
  timestamp: string; // ISO 8601 format
  author: "STAFF" | "USER";
  content: string;
};

// Map ticketId -> array of transcript lines
const transcriptBuffers = new Map<number, TranscriptLine[]>();

/**
 * Append a line to the transcript buffer for a given ticket.
 * WHAT: Adds a timestamped line to the in-memory transcript.
 * WHY: Tracks all messages for later export as .txt file.
 * PARAMS:
 *  - ticketId: The modmail ticket ID
 *  - author: "STAFF" or "USER"
 *  - content: Message content (stripped of markdown/formatting for readability)
 */
export function appendTranscript(ticketId: number, author: "STAFF" | "USER", content: string) {
  if (!transcriptBuffers.has(ticketId)) {
    transcriptBuffers.set(ticketId, []);
  }
  const buffer = transcriptBuffers.get(ticketId)!;
  buffer.push({
    timestamp: new Date().toISOString(),
    author,
    content,
  });
}

/**
 * Format transcript buffer as plain text.
 * WHAT: Converts transcript lines into human-readable .txt format.
 * WHY: Provides archiveable, searchable logs for compliance/review.
 * FORMAT: [2025-10-19T00:02:15.123Z] STAFF: Ok
 * RETURNS: Plain text string ready for file attachment.
 */
function formatTranscript(lines: TranscriptLine[]): string {
  return lines.map((line) => `[${line.timestamp}] ${line.author}: ${line.content}`).join("\n");
}

/**
 * Format message content with attachment URLs for transcript.
 * WHAT: Combines message text with attachment URLs for complete audit trail.
 * WHY: Ensures images and files are traceable in transcript even though we can't embed them.
 */
function formatContentWithAttachments(content: string, attachments?: ReadonlyMap<string, Attachment>): string {
  let fullContent = content || "";

  if (attachments && attachments.size > 0) {
    const attachmentUrls = Array.from(attachments.values())
      .map((att) => `[${att.contentType || "file"}] ${att.url}`)
      .join("\n");
    if (fullContent) {
      fullContent += `\n${attachmentUrls}`;
    } else {
      fullContent = attachmentUrls;
    }
  }

  return fullContent || "(empty message)";
}

/**
 * ensureModsCanSpeakInThread
 * WHAT: Ensures moderators have permission to send messages in modmail threads.
 * WHY:
 *  - Public threads: Permissions inherit from parent channel, so no explicit membership is needed.
 *  - Private threads: Require BOTH explicit membership AND SendMessagesInThreads permission on parent.
 * HOW:
 *  1. Always sets SendMessagesInThreads permission on parent channel for all mod roles
 *  2. For PUBLIC threads: Skip adding members; visibility/participation inherits from parent
 *  3. For PRIVATE threads: Add claimer + all mod role members + bot to thread explicitly
 * PARAMS:
 *  - thread: The thread channel to configure (public or private)
 *  - claimerMember: Optional GuildMember who claimed/opened the ticket
 * DOCS:
 *  - Public vs Private threads: https://discord.com/developers/docs/resources/channel#thread-create
 *  - ThreadMemberManager: https://discord.js.org/#/docs/discord.js/main/class/ThreadMemberManager
 *  - Permission overwrites: https://discord.js.org/#/docs/discord.js/main/class/PermissionOverwriteManager
 */
async function ensureModsCanSpeakInThread(
  thread: ThreadChannel,
  claimerMember?: GuildMemberType | null
) {
  try {
    const { getConfig } = await import("../lib/config.js");
    const config = getConfig(thread.guildId!);

    if (!config?.mod_role_ids || config.mod_role_ids.trim().length === 0) {
      logger.warn(
        { threadId: thread.id, guildId: thread.guildId },
        "[modmail] no mod roles configured, skipping thread permission setup"
      );
      return;
    }

    const modRoleIds = config.mod_role_ids
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    logger.info(
      { threadId: thread.id, guildId: thread.guildId, modRoleIds, threadType: thread.type },
      "[modmail] setting up thread permissions for mod roles"
    );

    // 1. Set SendMessagesInThreads permission on parent channel for all mod roles
    const parent = thread.parent;
    if (parent) {
      for (const roleId of modRoleIds) {
        try {
          await (parent as TextChannel | ForumChannel).permissionOverwrites.edit(roleId, {
            SendMessagesInThreads: true,
          });
          logger.debug(
            { threadId: thread.id, roleId, parentId: parent.id },
            "[modmail] set SendMessagesInThreads on parent for mod role"
          );
        } catch (err) {
          logger.warn(
            { err, threadId: thread.id, roleId, parentId: parent.id },
            "[modmail] failed to set SendMessagesInThreads for mod role"
          );
        }
      }
    } else {
      logger.warn(
        { threadId: thread.id },
        "[modmail] thread has no parent, cannot set parent permissions"
      );
    }

    // Check if this is a public thread
    const isPublic = thread.type === ChannelType.PublicThread;

    if (isPublic) {
      // Public threads: permissions inherit from parent channel
      // SKIP adding claimer and SKIP adding all role members to thread
      // Only ensure bot is present (usually already is since bot created the thread)
      const guild = thread.guild;
      const me = guild?.members.me;
      if (me) {
        try {
          await thread.members.add(me.id).catch((err) => {
            // Bot is likely already in the thread since it created it
            logger.debug({ threadId: thread.id, err }, "[modmail] bot already in thread (expected)");
          });
        } catch (err) {
          logger.debug({ threadId: thread.id, err }, "[modmail] failed to add bot to thread");
        }
      }
      logger.info(
        { threadId: thread.id, guildId: thread.guildId, threadType: thread.type },
        "[modmail] public thread: using parent perms; no member adds"
      );
      return;
    }

    // Private threads: explicit membership is required
    // 2. Add claimer to thread membership (if provided and not already added)
    if (claimerMember) {
      try {
        await thread.members.add(claimerMember.id);
        logger.debug(
          { threadId: thread.id, claimerId: claimerMember.id },
          "[modmail] added claimer to thread"
        );
      } catch (err) {
        logger.warn(
          { err, threadId: thread.id, claimerId: claimerMember.id },
          "[modmail] failed to add claimer to thread"
        );
      }
    }

    // 3. Add all mod role members to thread
    const guild = thread.guild;
    if (guild) {
      for (const roleId of modRoleIds) {
        try {
          const role = await guild.roles.fetch(roleId);
          if (!role) {
            logger.warn({ threadId: thread.id, roleId }, "[modmail] mod role not found in guild");
            continue;
          }

          // Fetch all members with this role
          const members = role.members;
          logger.debug(
            { threadId: thread.id, roleId, memberCount: members.size },
            "[modmail] adding mod role members to private thread"
          );

          for (const [memberId, member] of members) {
            try {
              await thread.members.add(memberId);
              logger.debug(
                { threadId: thread.id, memberId },
                "[modmail] added mod to private thread"
              );
            } catch (err) {
              logger.warn(
                { err, threadId: thread.id, memberId },
                "[modmail] failed to add mod to private thread"
              );
            }
          }
        } catch (err) {
          logger.warn(
            { err, threadId: thread.id, roleId },
            "[modmail] failed to fetch role or add members to private thread"
          );
        }
      }
    }

    // 4. Ensure bot can send messages in private thread
    const me = guild?.members.me;
    if (me) {
      try {
        await thread.members.add(me.id);
        logger.debug({ threadId: thread.id }, "[modmail] ensured bot in private thread");
      } catch (err) {
        logger.warn({ err, threadId: thread.id }, "[modmail] failed to add bot to thread");
      }
    }

    // For public threads, permissions are inherited from the parent channel.
    // Explicit member additions are skipped as they are not necessary and can be noisy.
    // Moderators must have SendMessagesInThreads permission on the parent channel.

    logger.info(
      { threadId: thread.id, guildId: thread.guildId },
      "[modmail] thread permissions configured successfully"
    );
  } catch (err) {
    logger.error(
      { err, threadId: thread.id },
      "[modmail] failed to ensure mods can speak in thread"
    );
    captureException(err);
  }
}

/**
 * Flush transcript to configured log channel as .txt attachment.
 * if this works, I'm buying it a coffee
 * WHAT: Sends the complete modmail conversation transcript to the log channel.
 * WHY: Provides permanent audit trail for compliance, review, and dispute resolution.
 * PRIVACY: Only sent to staff channel, never to user; ensures accountability without exposing to public.
 * ROTATION: If log channel needs archival, configure new channel via /config set modmail_log_channel.
 * PARAMS:
 *  - client: Discord client for channel fetching
 *  - ticketId: The modmail ticket ID
 *  - guildId: Guild ID for config lookup
 *  - userId: User ID for transcript metadata
 *  - appCode: Optional application code for reference
 * RETURNS: Message ID of the log message if sent, null otherwise
 * DOCS:
 *  - AttachmentBuilder: https://discord.js.org/#/docs/discord.js/main/class/AttachmentBuilder
 *  - File attachments: https://discord.com/developers/docs/reference#uploading-files
 */
async function flushTranscript(params: {
  client: Client;
  ticketId: number;
  guildId: string;
  userId: string;
  appCode?: string | null;
}): Promise<{ messageId: string | null; lineCount: number }> {
  const { client, ticketId, guildId, userId, appCode } = params;

  // Get config to find log channel
  const { getConfig } = await import("../lib/config.js");
  const config = getConfig(guildId);

  if (!config?.modmail_log_channel_id) {
    logger.info({ ticketId, guildId }, "[modmail] transcript skipped (no log channel configured)");
    return { messageId: null, lineCount: 0 };
  }

  // Get transcript from in-memory buffer first (fast path)
  // If empty, fall back to database (for when bot restarted mid-conversation)
  let lines = transcriptBuffers.get(ticketId);

  // If in-memory buffer is empty, try to reconstruct from database
  // This handles the case where bot restarted between messages and close
  if (!lines || lines.length === 0) {
    try {
      const dbMessages = db
        .prepare(
          `
        SELECT direction, content, created_at
        FROM modmail_message
        WHERE ticket_id = ? AND content IS NOT NULL
        ORDER BY created_at ASC
      `
        )
        .all(ticketId) as Array<{
        direction: "to_user" | "to_staff";
        content: string;
        created_at: string;
      }>;

      if (dbMessages.length > 0) {
        lines = dbMessages.map((msg) => ({
          timestamp: msg.created_at,
          author: msg.direction === "to_user" ? ("STAFF" as const) : ("USER" as const),
          content: msg.content,
        }));
        logger.info(
          { ticketId, count: dbMessages.length },
          "[modmail] reconstructed transcript from database (bot may have restarted)"
        );
      }
    } catch (err) {
      logger.warn({ err, ticketId }, "[modmail] failed to read transcript from database");
    }
  }

  try {
    const channel = await client.channels.fetch(config.modmail_log_channel_id);
    if (!channel?.isTextBased()) {
      logger.warn(
        { ticketId, channelId: config.modmail_log_channel_id },
        "[modmail] log channel is not text-based"
      );

      // Alert: transcript flush failed due to invalid log channel configuration
      try {
        const { logActionPretty } = await import("../logging/pretty.js");
        const guild = await client.guilds.fetch(guildId);
        await logActionPretty(guild, {
          actorId: client.user?.id || "system",
          action: "modmail_transcript_fail",
          meta: {
            ticketId,
            userId,
            appCode,
            reason: "log_channel_not_text",
            channelId: config.modmail_log_channel_id,
          },
        });
      } catch (alertErr) {
        logger.warn({ err: alertErr }, "[modmail] failed to log transcript failure alert");
      }

      return { messageId: null, lineCount: 0 };
    }

    const textChannel = channel as TextChannel;

    // Build summary embed
    const { EmbedBuilder } = await import("discord.js");
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Modmail Transcript")
      .addFields(
        { name: "Ticket ID", value: String(ticketId), inline: true },
        { name: "User", value: `<@${userId}>`, inline: true },
        { name: "App Code", value: appCode || "N/A", inline: true },
        { name: "Messages", value: lines ? String(lines.length) : "0", inline: true },
        { name: "Closed", value: new Date().toISOString(), inline: true }
      )
      .setTimestamp();

    // If no transcript lines (neither in memory nor database), post "No content" log
    if (!lines || lines.length === 0) {
      logger.info(
        { ticketId, guildId },
        "[modmail] no transcript lines to flush - posting empty log"
      );
      transcriptBuffers.delete(ticketId);

      const message = await textChannel.send({
        embeds: [embed],
        content: "_No transcript content (no messages exchanged)_",
        allowedMentions: { parse: [] },
      });

      logger.info(
        {
          evt: "modmail_transcript_flushed_empty",
          ticketId,
          guildId,
          userId,
          appCode,
          messageCount: 0,
          channelId: config.modmail_log_channel_id,
          messageId: message.id,
        },
        "[modmail] empty transcript logged"
      );

      return { messageId: message.id, lineCount: 0 };
    }

    // Format transcript as plain text
    const transcriptText = formatTranscript(lines);

    // Create .txt file attachment
    // DOCS: https://discord.js.org/#/docs/discord.js/main/class/AttachmentBuilder
    const { AttachmentBuilder } = await import("discord.js");
    const buffer = Buffer.from(transcriptText, "utf-8");
    const filename = `modmail-${appCode || ticketId}-${Date.now()}.txt`;
    const attachment = new AttachmentBuilder(buffer, { name: filename });

    // Send to log channel
    const message = await textChannel.send({
      embeds: [embed],
      files: [attachment],
      allowedMentions: { parse: [] },
    });

    logger.info(
      {
        evt: "modmail_transcript_flushed",
        ticketId,
        guildId,
        userId,
        appCode,
        messageCount: lines.length,
        channelId: config.modmail_log_channel_id,
        filename,
        messageId: message.id,
      },
      "[modmail] transcript flushed to log channel"
    );

    // Capture count before clearing buffer
    const lineCount = lines.length;

    // Clear buffer after successful flush
    transcriptBuffers.delete(ticketId);

    return { messageId: message.id, lineCount };
  } catch (err) {
    logger.warn(
      { err, ticketId, guildId, channelId: config.modmail_log_channel_id },
      "[modmail] failed to flush transcript"
    );
    captureException(err, { area: "modmail:flushTranscript", ticketId });

    // Alert: transcript flush failed due to exception
    try {
      const { logActionPretty } = await import("../logging/pretty.js");
      const guild = await client.guilds.fetch(guildId);
      await logActionPretty(guild, {
        actorId: client.user?.id || "system",
        action: "modmail_transcript_fail",
        meta: {
          ticketId,
          userId,
          appCode,
          reason: "exception",
          error: err instanceof Error ? err.message : String(err),
          channelId: config.modmail_log_channel_id,
        },
      });
    } catch (alertErr) {
      logger.warn({ err: alertErr }, "[modmail] failed to log transcript failure alert");
    }

    return { messageId: null, lineCount: lines?.length ?? 0 };
  }
}

// ===== DAO Helpers =====

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
  return Number(result.lastInsertRowid);
}

export function getOpenTicketByUser(guildId: string, userId: string): ModmailTicket | null {
  const row = db
    .prepare(
      `
    SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, status, created_at, closed_at
    FROM modmail_ticket
    WHERE guild_id = ? AND user_id = ? AND status = 'open'
    ORDER BY created_at DESC
    LIMIT 1
  `
    )
    .get(guildId, userId) as ModmailTicket | undefined;
  return row ?? null;
}

export function getTicketByThread(threadId: string): ModmailTicket | null {
  const row = db
    .prepare(
      `
    SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, status, created_at, closed_at
    FROM modmail_ticket
    WHERE thread_id = ?
  `
    )
    .get(threadId) as ModmailTicket | undefined;
  return row ?? null;
}

export function updateTicketThread(ticketId: number, threadId: string) {
  db.prepare(`UPDATE modmail_ticket SET thread_id = ? WHERE id = ?`).run(threadId, ticketId);
}

export function closeTicket(ticketId: number) {
  db.prepare(
    `UPDATE modmail_ticket SET status = 'closed', closed_at = datetime('now') WHERE id = ?`
  ).run(ticketId);
}

export function reopenTicket(ticketId: number) {
  db.prepare(`UPDATE modmail_ticket SET status = 'open', closed_at = NULL WHERE id = ?`).run(
    ticketId
  );
}

export function findModmailTicketForApplication(
  guildId: string,
  appCode: string
): ModmailTicket | null {
  /**
   * findModmailTicketForApplication
   * WHAT: Finds the most recent modmail ticket for a given application code.
   * WHY: Prevents duplicate modmail threads for the same application.
   * RETURNS: ModmailTicket if exists, null otherwise.
   * DOCS:
   *  - SQL ORDER BY DESC: Returns most recent ticket first
   *  - LIMIT 1: Only one ticket per application
   */
  const row = db
    .prepare(
      `
    SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, status, created_at, closed_at
    FROM modmail_ticket
    WHERE guild_id = ? AND app_code = ?
    ORDER BY id DESC
    LIMIT 1
  `
    )
    .get(guildId, appCode) as ModmailTicket | undefined;
  return row ?? null;
}

export function getTicketById(ticketId: number): ModmailTicket | null {
  const row = db
    .prepare(
      `
    SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, status, created_at, closed_at
    FROM modmail_ticket
    WHERE id = ?
  `
    )
    .get(ticketId) as ModmailTicket | undefined;
  return row ?? null;
}

// ===== Message Mapping DAO =====

type ModmailMessageMap = {
  ticketId: number;
  direction: "to_user" | "to_staff";
  threadMessageId?: string;
  dmMessageId?: string;
  replyToThreadMessageId?: string;
  replyToDmMessageId?: string;
  content?: string; // Message content for transcript persistence
};

/**
 * Insert or update a modmail message mapping.
 *
 * Each routed message creates a mapping between its thread message ID and DM
 * message ID. This lets us support reply chains: when a user replies to a
 * specific DM message, we look up its corresponding thread message and
 * create a reply there too.
 *
 * The ON CONFLICT clause handles edge cases where a message is recorded twice
 * (e.g., retry after partial failure). COALESCE ensures we don't overwrite
 * existing data with NULL.
 *
 * We also persist content for transcript generation. This survives bot restarts -
 * if the bot crashes, we can reconstruct the transcript from this table.
 */
export function insertModmailMessage(map: ModmailMessageMap) {
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

export function getThreadIdForDmReply(dmMessageId: string): string | null {
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

// ===== Embed Builders =====

/** Simple embed for staff → user DM */
export function buildStaffToUserEmbed(args: {
  staffDisplayName: string;
  staffAvatarUrl?: string | null;
  content: string;
  imageUrl?: string | null;
  guildName?: string;
  guildIconUrl?: string | null;
}) {
  /**
   * buildStaffToUserEmbed
   * WHAT: Builds an embed for messages sent from staff to users via modmail.
   * WHY: Hides staff identity (name/avatar) to prevent targeted harassment or doxxing.
   * PRIVACY: Footer shows only server name/icon instead of individual staff member.
   * DOCS:
   *  - EmbedBuilder: https://discord.js.org/#/docs/discord.js/main/class/EmbedBuilder
   *  - setImage: https://discord.js.org/#/docs/discord.js/main/class/EmbedBuilder?scrollTo=setImage
   */
  const e = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setDescription(args.content || " ")
    .setTimestamp()
    // Use generic server identity instead of staff identity for privacy
    // This prevents users from identifying/targeting specific staff members
    .setFooter({
      text: args.guildName || "Pawtropolis Tech",
      iconURL: args.guildIconUrl ?? undefined,
    });

  // Include first image attachment if present
  // DOCS: https://discord.js.org/#/docs/discord.js/main/class/EmbedBuilder?scrollTo=setImage
  if (args.imageUrl) e.setImage(args.imageUrl);
  return e;
}

/** Simple embed for user → staff thread */
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

/**
 * Escape markdown characters to prevent formatting issues
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_`~|>])/g, "\\$1");
}

/**
 * Chunk text into parts no larger than maxLength
 */
function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to break at a newline
    const breakPoint = remaining.lastIndexOf("\n", maxLength);
    if (breakPoint > 0) {
      chunks.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint + 1);
    } else {
      // No newline found, break at maxLength
      chunks.push(remaining.slice(0, maxLength));
      remaining = remaining.slice(maxLength);
    }
  }

  return chunks;
}

// ===== Message Routing =====

/**
 * In-memory set to prevent echo loops in message routing.
 *
 * Problem: When staff sends "Hello" in the thread, we forward it to the user's DM.
 * The bot sends that DM. Without this set, the DM handler might see the bot's
 * message and try to route it back to the thread, creating an infinite loop.
 *
 * Solution: When we forward a message, we mark its ID in this set. The routing
 * handlers check this set and skip messages that were already forwarded.
 *
 * The 5-minute TTL prevents memory leaks while being long enough that we won't
 * accidentally re-process a message (Discord message IDs are unique anyway).
 */
const forwardedMessages = new Set<string>();

export function isForwarded(messageId: string): boolean {
  return forwardedMessages.has(messageId);
}

export function markForwarded(messageId: string) {
  forwardedMessages.add(messageId);
  // TTL prevents unbounded memory growth. 5 minutes is plenty of buffer.
  setTimeout(() => forwardedMessages.delete(messageId), 5 * 60 * 1000);
}

/**
 * Route a message from the modmail thread to the applicant's DM
 */
export async function routeThreadToDm(message: Message, ticket: ModmailTicket, client: Client) {
  if (message.author.bot) return;
  if (isForwarded(message.id)) return;

  // Ignore empty messages
  if (!message.content && message.attachments.size === 0) return;

  try {
    const user = await client.users.fetch(ticket.user_id);
    const guild = message.guild;
    if (!guild) return;

    // Fetch member to get display name
    let staffDisplayName: string;
    let staffAvatarUrl: string | null = null;
    try {
      const member = await guild.members.fetch(message.author.id);
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

    // Detect reply
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
      allowedMentions: { parse: [] },
      ...(replyToDmMessageId && {
        reply: { messageReference: replyToDmMessageId, failIfNotExists: false },
      }),
    });

    markForwarded(dmMessage.id);

    // Format content with attachments for complete audit trail
    const transcriptContent = formatContentWithAttachments(message.content, message.attachments);

    // Store mapping + content for transcript persistence (survives bot restarts)
    insertModmailMessage({
      ticketId: ticket.id,
      direction: "to_user",
      threadMessageId: message.id,
      dmMessageId: dmMessage.id,
      replyToThreadMessageId: message.reference?.messageId,
      replyToDmMessageId,
      content: transcriptContent, // Persist content with attachments for transcript
    });

    // Append to transcript buffer for audit trail (in-memory, also persisted above)
    appendTranscript(ticket.id, "STAFF", transcriptContent);

    logger.info(
      {
        ticketId: ticket.id,
        threadId: ticket.thread_id,
        userId: ticket.user_id,
        messageId: message.id,
        dmMessageId: dmMessage.id,
      },
      "[modmail] routed thread → DM"
    );
  } catch (err) {
    logger.warn(
      { err, ticketId: ticket.id, userId: ticket.user_id },
      "[modmail] failed to route thread → DM"
    );
    captureException(err, { area: "modmail:routeThreadToDm", ticketId: ticket.id });

    // Try to notify in thread
    try {
      await message.reply({
        content: "⚠️ Failed to deliver message to applicant (DMs may be closed).",
        allowedMentions: { parse: [] },
      });
    } catch {
      // Best effort
    }
  }
}

/**
 * Route a DM from the applicant to the modmail thread
 */
export async function routeDmToThread(message: Message, ticket: ModmailTicket, client: Client) {
  if (message.author.bot) return;
  if (isForwarded(message.id)) return;

  // Ignore empty messages
  if (!message.content && message.attachments.size === 0) return;

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
      allowedMentions: { parse: [] },
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

    logger.info(
      {
        ticketId: ticket.id,
        threadId: ticket.thread_id,
        userId: ticket.user_id,
        messageId: message.id,
        threadMessageId: threadMessage.id,
      },
      "[modmail] routed DM → thread"
    );
  } catch (err) {
    logger.warn(
      { err, ticketId: ticket.id, threadId: ticket.thread_id },
      "[modmail] failed to route DM → thread"
    );
    captureException(err, { area: "modmail:routeDmToThread", ticketId: ticket.id });
  }
}

// ===== Thread Management =====

/**
 * Register the final thread_id after Discord thread creation.
 *
 * This is the second part of the race-safe open flow. We inserted a 'pending'
 * placeholder earlier; now we update it with the real thread ID.
 *
 * The UPSERT (ON CONFLICT DO UPDATE) makes this idempotent - if something goes
 * wrong and this gets called twice, it won't create duplicate rows.
 */
function registerModmailThreadTx(params: {
  guildId: string;
  userId: string;
  threadId: string;
  ticketId: number;
}): void {
  const { guildId, userId, threadId, ticketId } = params;

  // Update ticket with thread_id
  db.prepare(`UPDATE modmail_ticket SET thread_id = ?, thread_channel_id = ? WHERE id = ?`).run(
    threadId,
    threadId,
    ticketId
  );

  logger.info({ ticketId, threadId }, "[modmail] stored thread_channel_id on ticket");

  // Upsert into open_modmail guard table (idempotent)
  db.prepare(
    `
    INSERT INTO open_modmail (guild_id, applicant_id, thread_id, created_at)
    VALUES (?, ?, ?, strftime('%s','now'))
    ON CONFLICT(guild_id, applicant_id) DO UPDATE SET thread_id=excluded.thread_id
  `
  ).run(guildId, userId, threadId);

  logger.info({ guildId, userId, threadId }, "[modmail] registered in open_modmail guard table");
}

/**
 * Open a new modmail thread for an applicant
 */
export async function openPublicModmailThreadFor(params: {
  interaction:
    | ButtonInteraction
    | ChatInputCommandInteraction
    | MessageContextMenuCommandInteraction;
  userId: string;
  appCode?: string;
  reviewMessageId?: string;
  appId?: string;
}): Promise<{ success: boolean; message?: string }> {
  const { interaction, userId, appCode, reviewMessageId, appId } = params;

  if (!interaction.guildId || !interaction.guild) {
    return { success: false, message: "Guild only." };
  }

  // Check permissions: owner + mod roles first, then fall back to hasManageGuild/isReviewer
  // DOCS:
  //  - canRunAllCommands: checks OWNER_IDS and mod_role_ids from guild config
  //  - hasManageGuild: checks ManageGuild permission
  //  - isReviewer: checks reviewer_role_id or review channel visibility
  const member = interaction.member as GuildMember | null;
  const hasPermission =
    canRunAllCommands(member, interaction.guildId) ||
    hasManageGuild(member) ||
    isReviewer(interaction.guildId, member);
  if (!hasPermission) {
    return { success: false, message: "You do not have permission for this." };
  }

  // ======================================================================
  // RACE CONDITION PROTECTION (important, read carefully)
  // ======================================================================
  //
  // Problem: Two mods click "Open Modmail" at the same time for the same user.
  // Without protection, both would create threads, causing confusion.
  //
  // Solution: Use the open_modmail table as a lock. The table has a PRIMARY KEY
  // on (guild_id, applicant_id), so only one row can exist per user per guild.
  //
  // The flow is:
  // 1. Check if row exists (fast path, no lock)
  // 2. Inside transaction, double-check and INSERT with thread_id='pending'
  // 3. Create Discord thread (outside transaction - can't await in db.transaction)
  // 4. UPDATE the row with the real thread_id
  //
  // If step 3 fails, we clean up the 'pending' row so future attempts work.
  // If two mods race past step 1, only one will succeed at step 2 (PRIMARY KEY).
  // ======================================================================

  // Fast path check - avoids transaction overhead for common "already exists" case
  const existingRow = db
    .prepare(`SELECT thread_id FROM open_modmail WHERE guild_id = ? AND applicant_id = ?`)
    .get(interaction.guildId, userId) as { thread_id: string } | undefined;

  if (existingRow?.thread_id) {
    // Handle 'pending' case - another mod is in the middle of creating the thread
    if (existingRow.thread_id === "pending") {
      return {
        success: false,
        message: "Modmail thread is being created by another moderator. Please wait a moment and try again.",
      };
    }
    return {
      success: false,
      message: `Modmail thread already exists: <#${existingRow.thread_id}>`,
    };
  }

  // Prepare Discord API calls outside transaction (cannot await inside db.transaction)
  let user: User;
  let thread: ThreadChannel;
  let ticketId: number;

  try {
    // Fetch user
    user = await interaction.client.users.fetch(userId);
    const code = appCode ?? shortCode(userId).slice(0, 6);

    // Validate channel
    const channel = interaction.channel;
    if (!channel || channel.type === ChannelType.DM || !("permissionsFor" in channel)) {
      return { success: false, message: "Cannot create thread in this channel." };
    }

    // Only allow Text/News/Forum types
    if (
      ![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(
        channel.type
      )
    ) {
      return {
        success: false,
        message: "Modmail is only supported in text/news/forum channels.",
      };
    }

    // Check precise bot permissions for thread creation
    const me = interaction.guild.members.me;
    if (!me) {
      return { success: false, message: "Bot member not found in guild." };
    }

    const missing = missingPermsForStartThread(
      channel as TextChannel | NewsChannel | ForumChannel,
      me.id
    );

    // Helpful debug log
    logger.info(
      {
        guildId: interaction.guildId,
        channelId: channel.id,
        channelType: channel.type,
        missing,
        botId: me.id,
      },
      "[modmail] permission check for start thread"
    );

    // If missing, return granular error
    if (missing.length) {
      return {
        success: false,
        message: `Cannot open modmail here. Missing: ${missing.join(", ")}.\n• Check channel-specific overwrites on <#${channel.id}> (they override role perms).`,
      };
    }

    // Execute DB writes in a single atomic transaction.
    // This is the critical section for race protection - see comment above.
    const openResult = db.transaction(() => {
      // Double-check guard INSIDE transaction. The fast path check above doesn't
      // hold a lock, so another mod could have snuck in between then and now.
      // This check happens under SQLite's write lock, so it's authoritative.
      const guardCheck = db
        .prepare(`SELECT thread_id FROM open_modmail WHERE guild_id = ? AND applicant_id = ?`)
        .get(interaction.guildId, userId) as { thread_id: string } | undefined;

      if (guardCheck?.thread_id) {
        return { alreadyExists: true, threadId: guardCheck.thread_id };
      }

      // Create ticket in DB. We do this inside the transaction so that if the
      // INSERT into open_modmail fails (race), we don't leave orphan tickets.
      ticketId = createTicket({
        guildId: interaction.guildId!,
        userId,
        appCode: code,
        reviewMessageId,
      });

      // Insert with 'pending' thread_id to acquire the lock. The PRIMARY KEY
      // constraint will cause this to fail if another transaction beat us.
      // We can't put the real thread_id here because we can't call Discord API
      // inside a synchronous transaction.
      db.prepare(
        `INSERT INTO open_modmail (guild_id, applicant_id, thread_id, created_at)
         VALUES (?, ?, 'pending', strftime('%s','now'))`
      ).run(interaction.guildId, userId);

      logger.debug(
        { guildId: interaction.guildId, userId, ticketId },
        "[modmail] Acquired lock in open_modmail with pending thread_id"
      );

      return { alreadyExists: false, ticketId };
    })();

    if (openResult.alreadyExists) {
      // Handle 'pending' case - another mod is in the middle of creating the thread
      if (openResult.threadId === "pending") {
        return {
          success: false,
          message: "Modmail thread is being created by another moderator. Please wait a moment and try again.",
        };
      }
      return {
        success: false,
        message: `Modmail thread already exists: <#${openResult.threadId}>`,
      };
    }

    // openResult.ticketId is guaranteed to exist when alreadyExists is false
    ticketId = openResult.ticketId!;

    // Create Discord thread (outside transaction - cannot await inside)
    // Different creation paths for Forum vs Text/News channels
    // Type assertion needed because channel was already narrowed at runtime (lines 1072-1076)
    const narrowedChannel = channel as TextChannel | NewsChannel | ForumChannel;

    if (narrowedChannel.type === ChannelType.GuildForum) {
      // Forum channels: create a new post (thread) under the forum
      const forum = narrowedChannel as ForumChannel;
      thread = await forum.threads.create({
        name: `Modmail • ${code} • ${user.username}`,
        message: { content: `Opening modmail for <@${userId}> (App #${code}).` },
        autoArchiveDuration: ThreadAutoArchiveDuration.ThreeDays,
        reason: `Modmail for ${user.tag} (${user.id})`,
      });
    } else {
      // Text/News: create a public thread (not attached to a specific message)
      const textChannel = narrowedChannel as TextChannel | NewsChannel;
      thread = await textChannel.threads.create({
        name: `Modmail • ${code} • ${user.username}`,
        autoArchiveDuration: ThreadAutoArchiveDuration.ThreeDays,
        reason: `Modmail for ${user.tag} (${user.id})`,
      });
    }

    // Public threads inherit visibility from the parent channel.
    // Adding individual members is unnecessary and noisy.
    // We only ensure SendMessagesInThreads on the PARENT so all mods can reply.

    // Add loud assertion logs after thread creation
    logger.info(
      {
        threadId: thread.id,
        threadType: thread.type,
        parentId: thread.parentId,
        guildId: thread.guildId,
        public: thread.type === ChannelType.PublicThread,
        autoArchiveDuration: thread.autoArchiveDuration,
      },
      "[modmail] THREAD CREATED: public modmail thread ready"
    );

    // Ensure moderators can speak in the thread (sets parent perms, no member adds for public)
    await ensureModsCanSpeakInThread(thread, member);

    // Register the real thread_id now that we have it.
    // This updates the 'pending' placeholder we inserted earlier.
    db.transaction(() => {
      registerModmailThreadTx({
        guildId: interaction.guildId!,
        userId,
        threadId: thread.id,
        ticketId,
      });
    })();

    // Add to open threads set
    OPEN_MODMAIL_THREADS.add(thread.id);

    // Log modmail open action with public/private metadata
    // Metadata tracks thread visibility for analytics (helps understand modmail usage patterns)
    if (interaction.guild) {
      await logActionPretty(interaction.guild, {
        appId: appId || undefined,
        appCode: code || undefined,
        actorId: interaction.user.id,
        subjectId: userId,
        action: "modmail_open",
        meta: { public: thread.type === ChannelType.PublicThread },
      }).catch((err) => {
        logger.warn({ err, threadId: thread.id }, "[modmail] failed to log modmail_open");
      });
    }

    // Refresh review card if appId is available
    if (appId) {
      try {
        const { ensureReviewMessage } = await import("./review.js");
        await ensureReviewMessage(interaction.client, appId);
        logger.info({ appId, threadId: thread.id }, "[review] card refreshed");
      } catch (err) {
        logger.warn(
          { err, appId, threadId: thread.id },
          "[review] failed to refresh card after modmail open"
        );
      }
    }

    // Build starter embed
    const avatarUrl = user.displayAvatarURL({ size: 128 });
    const accountAge = user.createdTimestamp
      ? `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`
      : "unknown";

    const lensUrl = avatarUrl
      ? `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(avatarUrl)}`
      : null;

    const embed = new EmbedBuilder()
      .setTitle(`Modmail Thread`)
      .setDescription(
        `**Applicant:** <@${userId}> (${user.tag})\n**App Code:** ${code}\n**Account Age:** ${accountAge}`
      )
      .setColor(0x5865f2)
      .setThumbnail(avatarUrl)
      .setFooter({ text: `Ticket #${ticketId}` });

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`v1:modmail:close:${ticketId}`)
        .setLabel("Close")
        .setStyle(ButtonStyle.Danger)
    );

    if (lensUrl) {
      buttons.addComponents(
        new ButtonBuilder().setLabel("Copy Lens Link").setStyle(ButtonStyle.Link).setURL(lensUrl)
      );
    }

    // Diagnostic logging before first message send
    logger.debug(
      {
        threadId: thread.id,
        threadType: thread.type,
        parentId: thread.parentId,
        guildId: thread.guildId,
        botMemberId: interaction.guild?.members.me?.id,
        claimerId: interaction.user.id,
      },
      "[modmail] about to send first message to thread"
    );

    await thread.send({ embeds: [embed], components: [buttons], allowedMentions: { parse: [] } });

    // Try to DM the applicant
    try {
      await user.send({
        content: `Hi, a moderator opened a modmail thread regarding your application to **${interaction.guild.name}**.`,
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      logger.warn({ err, userId, ticketId }, "[modmail] failed to DM applicant on open");
      await thread.send({
        content: "⚠️ Failed to DM the applicant (their DMs may be closed).",
        allowedMentions: { parse: [] },
      });
    }

    logger.info(
      { ticketId, threadId: thread.id, userId, guildId: interaction.guildId },
      "[modmail] thread opened"
    );

    return {
      success: true,
      message: `Modmail thread created: <#${thread.id}>`,
    };
  } catch (err: any) {
    // Transaction rollback is automatic via db.transaction() - no explicit rollback needed

    // Detect race condition: if we hit a PRIMARY KEY constraint, another mod won.
    // SQLite error codes vary by driver, so we check both the message and code.
    const isRaceCondition =
      String(err?.message || "").includes("UNIQUE") ||
      String(err?.message || "").includes("PRIMARY KEY") ||
      err?.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
      err?.code === "SQLITE_CONSTRAINT";

    if (isRaceCondition) {
      // Race detected: another moderator beat us. Look up their thread and link to it.
      // This is a clean failure - no error card needed, just redirect to existing thread.
      const existingThread = db
        .prepare(`SELECT thread_id FROM open_modmail WHERE guild_id = ? AND applicant_id = ?`)
        .get(interaction.guildId, userId) as { thread_id: string } | undefined;

      if (existingThread?.thread_id && existingThread.thread_id !== "pending") {
        logger.info(
          { guildId: interaction.guildId, userId, threadId: existingThread.thread_id },
          "[modmail] race condition detected - linking to existing thread"
        );
        return {
          success: false,
          message: `Modmail thread already exists: <#${existingThread.thread_id}>`,
        };
      }
      // Edge case: the winner is still in the 'pending' state (creating the thread)
      if (existingThread?.thread_id === "pending") {
        return {
          success: false,
          message: "Modmail thread is being created by another moderator. Please wait a moment and try again.",
        };
      }
    }

    // CRITICAL CLEANUP: If we fail for any reason (Discord API error, permission issue,
    // etc.), we must remove our 'pending' entry. Otherwise, future attempts will see
    // 'pending' forever and no one can create a thread for this user.
    try {
      db.prepare(
        `DELETE FROM open_modmail WHERE guild_id = ? AND applicant_id = ? AND thread_id = 'pending'`
      ).run(interaction.guildId, userId);
      logger.debug(
        { guildId: interaction.guildId, userId },
        "[modmail] Cleaned up pending entry after thread creation failure"
      );
    } catch (cleanupErr) {
      // If cleanup fails, we're in trouble - manual intervention may be needed.
      // Log at warn level so it shows up in monitoring.
      logger.warn({ cleanupErr, guildId: interaction.guildId, userId },
        "[modmail] Failed to clean up pending entry - manual cleanup may be required");
    }

    // Unknown error - log and return generic message
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, userId, traceId }, "[modmail] failed to open thread");
    captureException(err, { area: "modmail:openThread", userId, traceId });
    return {
      success: false,
      message: `Failed to create modmail thread (trace: ${traceId}). Check logs.`,
    };
  }
}

/**
 * Close a modmail thread
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
      OPEN_MODMAIL_THREADS.delete(ticket.thread_id);
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
        allowedMentions: { parse: [] },
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
      const { getConfig } = await import("../lib/config.js");
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
      const { ensureReviewMessage, findAppByShortCode } = await import("./review.js");
      const app =
        interaction.guildId && ticket.app_code
          ? findAppByShortCode(interaction.guildId, ticket.app_code)
          : null;
      if (app) {
        await ensureReviewMessage(interaction.client, app.id);
        logger.info({ code: ticket.app_code, appId: app.id }, "[review] card refreshed");
      }
    } catch (err) {
      logger.warn({ err, ticketId: ticket.id }, "[review] failed to refresh card after close");
    }

    logger.info({ ticketId: ticket.id, threadId: ticket.thread_id }, "[modmail] thread closed");

    // Log modmail close action (before auto-delete so we know which action was taken)
    let archiveAction: "delete" | "archive" = "archive";

    // Auto-delete or leave thread based on config (after transcript is flushed)
    if (threadForCleanup && interaction.guildId) {
      const { getConfig } = await import("../lib/config.js");
      const cfg = getConfig(interaction.guildId);
      const preferDelete = cfg?.modmail_delete_on_close !== false; // default true

      try {
        if (preferDelete) {
          archiveAction = "delete";
          await threadForCleanup.delete("Closed by decision — transcript flushed");
          logger.info({ threadId: threadForCleanup.id }, "[modmail] thread deleted after close");
        } else {
          archiveAction = "archive";
          // Fall back: hide it by leaving the thread
          // Bot leaves, which makes it vanish from the sidebar
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
    // Metadata includes: transcript line count (from transcriptBuffers) and archive method (delete vs archive)
    // This helps track modmail volume and understand how conversations are being handled
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

/**
 * Reopen a modmail thread
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
      SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, status, created_at, closed_at
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
    // Reopen in DB
    reopenTicket(ticket.id);

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
        allowedMentions: { parse: [] },
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

// ===== Safe Close Helpers =====

/**
 * trySendClosingMessage
 * WHAT: Best-effort attempt to send a closing message to the modmail thread.
 * WHY: Informs staff that the thread is being closed before archiving/deleting.
 * HOW: Checks last 10 messages for duplicate "Modmail Closed" embeds to avoid spam.
 * RETURNS: 'ok' | 'skip' | 'err' to indicate outcome
 * DOCS:
 *  - ThreadChannel.messages.fetch: https://discord.js.org/#/docs/discord.js/main/class/MessageManager?scrollTo=fetch
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

    await thread.send({ embeds: [closeEmbed], allowedMentions: { parse: [] } });
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
 * HOW:
 *  1. Pre-check permissions using permissionsFor()
 *  2. If delete configured:
 *     a. Check thread.deletable and ManageThreads permission
 *     b. Try thread.delete()
 *     c. On 50013/50001 (Missing Permissions/Access), fall back to archive+lock
 *  3. For archive+lock:
 *     a. Try thread.edit() if manageable/editable
 *     b. Fall back to parent.threads.edit() for public threads
 *     c. Final fallback: remove bot from thread to hide it
 * RETURNS: { action: 'delete' | 'archive', ok: boolean, err?: any, code?: number }
 * DOCS:
 *  - ThreadChannel.delete: https://discord.js.org/#/docs/discord.js/main/class/ThreadChannel?scrollTo=delete
 *  - ThreadChannel.edit: https://discord.js.org/#/docs/discord.js/main/class/ThreadChannel?scrollTo=edit
 *  - PermissionsBitField: https://discord.js.org/#/docs/discord.js/main/class/PermissionsBitField
 */
async function archiveOrDeleteThread(
  thread: ThreadChannel,
  deleteOnClose: boolean,
  client: Client
): Promise<{ action: "delete" | "archive"; ok: boolean; err?: any; code?: number }> {
  const { PermissionFlagsBits } = await import("discord.js");

  // Pre-check permissions
  const me = thread.guild?.members.me;
  const myPerms = me ? thread.permissionsFor(me.id) : null;
  const canManageThreads = myPerms?.has(PermissionFlagsBits.ManageThreads) ?? false;

  if (deleteOnClose) {
    // Check if we can delete
    if (!canManageThreads) {
      logger.info(
        { threadId: thread.id, canManageThreads },
        "[modmail] close:archive skipped delete (insufficient perms) → falling back to archive"
      );
      // Fall through to archive+lock below
    } else {
      // Try to delete
      try {
        await thread.delete("Modmail closed — transcript flushed");
        logger.debug({ threadId: thread.id }, "[modmail] close:archive action=delete ok");
        return { action: "delete", ok: true };
      } catch (e: any) {
        const code = e?.code;
        logger.warn(
          { err: e, threadId: thread.id, code },
          "[modmail] close:archive action=delete failed → falling back to archive"
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
 * HOW: DELETE from open_modmail + remove from OPEN_MODMAIL_THREADS set.
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

/**
 * Auto-close modmail for an application when a decision is made
 * WHAT: Safely closes modmail thread with transcript logging and cleanup.
 * WHY: Ensures audit trail and cleanup on approve/reject decisions.
 * HOW: Ordered sequence - close message → transcript flush → archive/delete → cleanup.
 * SAFETY: Resilient to permission errors; never blocks decision flow.
 * DOCS:
 *  - Thread management: https://discord.js.org/#/docs/discord.js/main/class/ThreadChannel
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

      await user.send({ embeds: [closeEmbed], allowedMentions: { parse: [] } });
      logger.debug({ ticketId, userId }, "[modmail] close:dm_user ok");
    } catch (err) {
      logger.debug({ err, ticketId, userId }, "[modmail] close:dm_user err (non-fatal)");
    }

    // ===== Refresh review card =====
    try {
      const { ensureReviewMessage, findAppByShortCode } = await import("./review.js");
      const app = ticket.app_code ? findAppByShortCode(guildId, ticket.app_code) : null;
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

    logger.info(
      {
        ticketId,
        threadId,
        userId,
        reason,
        closingMsg: closingMessageResult,
        transcript: transcriptLines,
        archive: archiveResult.action,
      },
      "[modmail] close:complete auto-closed on decision"
    );
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

// ===== Button Handlers =====

export async function handleModmailOpenButton(interaction: ButtonInteraction) {
  const match = /^v1:modmail:open:(.+)$/.exec(interaction.customId);
  if (!match) return;

  const [, payload] = match;
  // Payload format: "code{HEX6}:msg{messageId}"
  const codeMatch = /code([A-F0-9]{6})/.exec(payload);
  const msgMatch = /msg([0-9]+)/.exec(payload);

  const appCode = codeMatch ? codeMatch[1] : undefined;
  const reviewMessageId = msgMatch ? msgMatch[1] : undefined;

  // Extract userId from review card or button context
  // For now, we need to look up the application by code
  if (!appCode || !interaction.guildId) {
    // Ensure the clicker gets immediate feedback (ephemeral)
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => undefined);
    }
    await interaction
      .followUp({
        flags: MessageFlags.Ephemeral,
        content: "Invalid modmail button data.",
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
    return;
  }

  // Find application by short code
  const { findAppByShortCode } = await import("./review.js");
  const app = findAppByShortCode(interaction.guildId, appCode);
  if (!app) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => undefined);
    }
    await interaction
      .followUp({
        flags: MessageFlags.Ephemeral,
        content: `No application found with code ${appCode}.`,
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
    return;
  }

  // Acknowledge the button click without creating a visible "Only you can see this" bubble.
  // https://discord.js.org/#/docs/discord.js/main/class/Interaction?scrollTo=deferUpdate
  await interaction.deferUpdate();

  const result = await openPublicModmailThreadFor({
    interaction,
    userId: app.user_id,
    appCode,
    reviewMessageId,
    appId: app.id,
  });

  // Always provide visible feedback:
  if (result.success) {
    // Public confirmation in the review channel if available
    if (interaction.channel && "send" in interaction.channel) {
      try {
        await interaction.channel.send({
          content: result.message ?? "Modmail thread created.",
          allowedMentions: { parse: [] },
        });
      } catch (err) {
        logger.warn({ err, appCode }, "[modmail] failed to post public thread creation message");
      }
    }
  } else {
    // Ephemeral explanation to the clicking moderator
    const msg = result.message || "Failed to create modmail thread. Check bot permissions.";
    await interaction
      .followUp({
        flags: MessageFlags.Ephemeral,
        content: `⚠️ ${msg}`,
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
  }
}

export async function handleModmailCloseButton(interaction: ButtonInteraction) {
  const match = /^v1:modmail:close:([0-9]+)$/.exec(interaction.customId);
  if (!match) return;

  // Acknowledge the button click without creating a visible "Only you can see this" bubble.
  // https://discord.js.org/#/docs/discord.js/main/class/Interaction?scrollTo=deferUpdate
  await interaction.deferUpdate();

  const ticketId = parseInt(match[1], 10);
  const result = await closeModmailThread({ interaction, ticketId });

  // Post public message for modmail close
  if (result.success && interaction.channel && "send" in interaction.channel) {
    try {
      await interaction.channel.send({
        content: result.message ?? "Modmail thread closed.",
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      logger.warn({ err, ticketId }, "[modmail] failed to post public close message");
    }
  }
}

export async function handleModmailContextMenu(interaction: MessageContextMenuCommandInteraction) {
  await interaction.deferReply();

  const targetMessage = interaction.targetMessage;
  const userId = targetMessage.author.id;

  // Try to find app code from the message content or embeds
  let appCode: string | undefined;
  const { findAppByShortCode } = await import("./review.js");

  // Check if the message is a review message by looking for app code in content or embeds
  const content = targetMessage.content;
  const embeds = targetMessage.embeds;

  // Look for app code in content (e.g., "App Code: ABC123")
  const contentMatch = /App Code:\s*([A-F0-9]{6})/i.exec(content);
  if (contentMatch) {
    appCode = contentMatch[1];
  } else {
    // Look in embeds
    for (const embed of embeds) {
      const embedMatch = /App Code:\s*([A-F0-9]{6})/i.exec(embed.description || "");
      if (embedMatch) {
        appCode = embedMatch[1];
        break;
      }
    }
  }

  const result = await openPublicModmailThreadFor({
    interaction,
    userId,
    appCode,
    reviewMessageId: targetMessage.id,
  });

  await interaction.editReply({ content: result.message ?? "Unknown error." });
}

// ===== Slash Commands =====

export const modmailCommand = new SlashCommandBuilder()
  .setName("modmail")
  .setDescription("Modmail management")
  .addSubcommand((sc) =>
    sc
      .setName("close")
      .setDescription("Close a modmail thread")
      .addStringOption((o) =>
        o.setName("thread").setDescription("Thread ID (optional, uses current)").setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("reopen")
      .setDescription("Reopen a closed modmail thread")
      .addUserOption((o) =>
        o.setName("user").setDescription("User to reopen modmail for").setRequired(false)
      )
      .addStringOption((o) =>
        o.setName("thread").setDescription("Thread ID to reopen (optional)").setRequired(false)
      )
  )
  .setDMPermission(false);

export async function executeModmailCommand(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  if (!interaction.guildId || !interaction.guild) {
    await replyOrEdit(interaction, { content: "Guild only." });
    return;
  }

  // Check permissions: owner + mod roles first, then fall back to hasManageGuild/isReviewer
  // DOCS:
  //  - canRunAllCommands: checks OWNER_IDS and mod_role_ids from guild config
  //  - hasManageGuild: checks ManageGuild permission
  //  - isReviewer: checks reviewer_role_id or review channel visibility
  const member = interaction.member as GuildMember | null;
  const hasPermission =
    canRunAllCommands(member, interaction.guildId) ||
    hasManageGuild(member) ||
    isReviewer(interaction.guildId, member);
  if (!hasPermission) {
    await replyOrEdit(interaction, {
      content: "You do not have permission for this.",
    });
    return;
  }

  await ensureDeferred(interaction);

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "close") {
    const threadId = interaction.options.getString("thread") ?? undefined;
    const result = await closeModmailThread({ interaction, threadId });
    await replyOrEdit(interaction, { content: result.message ?? "Unknown error." });
  } else if (subcommand === "reopen") {
    const user = interaction.options.getUser("user");
    const threadId = interaction.options.getString("thread") ?? undefined;
    const result = await reopenModmailThread({
      interaction,
      userId: user?.id,
      threadId,
    });
    await replyOrEdit(interaction, { content: result.message ?? "Unknown error." });
  }
}

// ===== Modmail retrofit of parent permissions on startup =====
//
// WHY this exists:
// For private threads, members need BOTH (a) membership in the private thread and
// (b) the parent channel permission "Send Messages In Threads". Legacy setups may
// lack that parent perm for moderator roles, which silently prevents them from speaking.
//
// WHAT this does:
// On bot startup (or after config changes), we scan all channels that host modmail threads
// and ensure the parent channel grants SendMessagesInThreads to all configured mod roles.
// This retrofits/heals existing threads so moderators can participate.
//
// Docs:
// - Thread basics: https://discord.js.org/#/docs/discord.js/main/class/ThreadChannel
// - Parent overwrites: https://discord.js.org/#/docs/discord.js/main/class/PermissionOverwrites
// - Permissions flags: https://discord.js.org/#/docs/discord.js/main/class/PermissionsBitField?scrollTo=s-FLAGS
//   (SendMessagesInThreads, ViewChannel, ReadMessageHistory)
// - ForumChannel vs TextChannel parents: https://discord.js.org/#/docs/discord.js/main/typedef/ChannelType

/**
 * ensureParentPermsForMods
 * WHAT: Ensure the given parent channel grants "Send Messages In Threads" to all configured mod roles.
 * WHY: Private threads require parent-level SendMessagesInThreads permission in addition to thread membership.
 * HOW: For each configured mod role, check if they have SendMessagesInThreads; if not, grant it plus baseline view/read.
 * PARAMS:
 *  - parent: The TextChannel or ForumChannel that hosts modmail threads
 * SAFETY: Best-effort; preserves other overwrites; only sets minimal required flags.
 * DOCS:
 *  - permissionOverwrites.edit: https://discord.js.org/#/docs/discord.js/main/class/PermissionOverwriteManager?scrollTo=edit
 *  - permissionsFor: https://discord.js.org/#/docs/discord.js/main/class/GuildChannel?scrollTo=permissionsFor
 */
export async function ensureParentPermsForMods(parent: TextChannel | ForumChannel) {
  try {
    const guild = parent.guild;
    const config = getConfig(guild.id);

    // Parse mod role IDs from config
    const modRoleIdsRaw = config?.mod_role_ids ?? "";
    if (!modRoleIdsRaw || modRoleIdsRaw.trim().length === 0) {
      logger.info(
        { parentId: parent.id, guildId: guild.id },
        "[modmail] retrofit: no mod roles configured; skipping parent perms"
      );
      return;
    }

    const modRoleIds = modRoleIdsRaw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (modRoleIds.length === 0) {
      logger.info(
        { parentId: parent.id, guildId: guild.id },
        "[modmail] retrofit: no valid mod roles after parsing; skipping parent perms"
      );
      return;
    }

    logger.info(
      { parentId: parent.id, guildId: guild.id, modRoleIds },
      "[modmail] retrofit: checking parent perms for mod roles"
    );

    // Make sure each mod role can view + read + SEND MESSAGES IN THREADS on the parent.
    // We edit only the relevant flags to avoid clobbering existing policy.
    for (const roleId of modRoleIds) {
      try {
        const perms = parent.permissionsFor(roleId);
        const has = perms?.has(PermissionFlagsBits.SendMessagesInThreads) ?? false;

        if (!has) {
          await parent.permissionOverwrites.edit(roleId, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessagesInThreads: true,
          });
          logger.debug(
            { parentId: parent.id, roleId },
            "[modmail] retrofit: granted SendMessagesInThreads to mod role"
          );
        } else {
          logger.debug(
            { parentId: parent.id, roleId },
            "[modmail] retrofit: mod role already has SendMessagesInThreads"
          );
        }
      } catch (err) {
        logger.warn(
          { err, parentId: parent.id, roleId },
          "[modmail] retrofit: failed to set perms for mod role"
        );
      }
    }

    // Also make sure the BOT itself can operate in threads under this parent.
    const botId = guild.client.user?.id;
    if (botId) {
      try {
        const botPerms = parent.permissionsFor(botId);
        const botHas = botPerms?.has(PermissionFlagsBits.SendMessagesInThreads) ?? false;

        if (!botHas) {
          await parent.permissionOverwrites.edit(botId, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: true,
            EmbedLinks: true,
            AttachFiles: true,
            SendMessagesInThreads: true,
          });
          logger.debug(
            { parentId: parent.id, botId },
            "[modmail] retrofit: granted thread perms to bot"
          );
        } else {
          logger.debug(
            { parentId: parent.id, botId },
            "[modmail] retrofit: bot already has SendMessagesInThreads"
          );
        }
      } catch (err) {
        logger.warn(
          { err, parentId: parent.id, botId },
          "[modmail] retrofit: failed to set bot perms"
        );
      }
    }

    logger.info(
      { guildId: guild.id, parentId: parent.id, roles: modRoleIds },
      "[modmail] retrofit: ensured parent SendMessagesInThreads for mod roles"
    );
  } catch (err) {
    logger.warn(
      { err, parentId: parent.id },
      "[modmail] retrofit: ensureParentPermsForMods failed"
    );
    captureException(err);
  }
}

/**
 * retrofitModmailParentsForGuild
 * WHAT: Discover parent channels that host modmail threads and retrofit their overwrites.
 * WHY: Legacy threads may have been created before parent permissions were configured properly.
 * HOW:
 *  1. Query all open modmail tickets from DB
 *  2. Fetch each thread channel and collect unique parent IDs
 *  3. (Optional) Include configured modmail parent channel if present in config
 *  4. For each parent, call ensureParentPermsForMods to grant SendMessagesInThreads
 * PARAMS:
 *  - guild: The guild to retrofit
 * SAFETY: Intentionally conservative and idempotent; only touches discovered parents.
 * DOCS:
 *  - Guild channels: https://discord.js.org/#/docs/discord.js/main/class/GuildChannelManager
 *  - Thread.parent: https://discord.js.org/#/docs/discord.js/main/class/ThreadChannel?scrollTo=parent
 */
export async function retrofitModmailParentsForGuild(guild: Guild) {
  try {
    logger.info({ guildId: guild.id }, "[modmail] retrofit: starting for guild");

    const parentIds = new Set<string>();

    // (A) From open tickets in DB
    // Query modmail_ticket table for all threads in this guild
    const rows = db
      .prepare(
        `SELECT thread_id
         FROM modmail_ticket
         WHERE guild_id = ? AND status = 'open' AND thread_id IS NOT NULL`
      )
      .all(guild.id) as { thread_id: string }[];

    logger.debug(
      { guildId: guild.id, ticketCount: rows.length },
      "[modmail] retrofit: found open tickets"
    );

    // Fetch each thread and collect parent IDs
    for (const r of rows) {
      try {
        const channel = await guild.channels.fetch(r.thread_id);
        if (channel && "parentId" in channel && channel.parentId) {
          parentIds.add(channel.parentId);
          logger.debug(
            { threadId: r.thread_id, parentId: channel.parentId },
            "[modmail] retrofit: discovered parent from thread"
          );
        }
      } catch (err) {
        logger.warn({ err, threadId: r.thread_id }, "[modmail] retrofit: failed to fetch thread");
      }
    }

    // (B) Optional: known configured parent if your config stores it
    // This project doesn't currently store a specific modmail_parent_channel_id,
    // but we check config in case it's added in the future
    const cfg = getConfig(guild.id);
    const configuredParentId = (cfg as any)?.modmail_parent_channel_id as string | undefined;
    if (configuredParentId) {
      parentIds.add(configuredParentId);
      logger.debug(
        { guildId: guild.id, parentId: configuredParentId },
        "[modmail] retrofit: added configured parent channel"
      );
    }

    logger.info(
      { guildId: guild.id, parentCount: parentIds.size },
      "[modmail] retrofit: discovered parents to process"
    );

    // Retrofit each parent
    for (const parentId of parentIds) {
      try {
        const parent = await guild.channels.fetch(parentId);
        if (!parent) {
          logger.warn(
            { parentId, guildId: guild.id },
            "[modmail] retrofit: parent channel not found"
          );
          continue;
        }

        // Only process TextChannel and ForumChannel parents
        if (parent.type !== ChannelType.GuildText && parent.type !== ChannelType.GuildForum) {
          logger.debug(
            { parentId, type: parent.type },
            "[modmail] retrofit: skipping non-text/forum channel"
          );
          continue;
        }

        await ensureParentPermsForMods(parent as TextChannel | ForumChannel);
      } catch (err) {
        logger.warn(
          { err, parentId, guildId: guild.id },
          "[modmail] retrofit: failed to process parent"
        );
      }
    }

    logger.info(
      { guildId: guild.id, parentCount: parentIds.size },
      "[modmail] retrofit: finished for guild"
    );
  } catch (err) {
    logger.warn({ err, guildId: guild.id }, "[modmail] retrofit: guild failed");
    captureException(err);
  }
}

/**
 * retrofitAllGuildsOnStartup
 * WHAT: Run retrofit across all guilds at startup.
 * WHY: Ensures existing modmail threads have proper parent permissions for moderators.
 * HOW: Iterate through all guilds the bot is in and call retrofitModmailParentsForGuild for each.
 * WHEN: Called once in client "ready" event.
 * PARAMS:
 *  - client: Discord client instance
 * DOCS:
 *  - Client.guilds: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=guilds
 *  - GuildManager.fetch: https://discord.js.org/#/docs/discord.js/main/class/GuildManager?scrollTo=fetch
 */
export async function retrofitAllGuildsOnStartup(client: Client) {
  try {
    logger.info("[modmail] retrofit: starting across all guilds");

    const guilds = await client.guilds.fetch();
    logger.info({ guildCount: guilds.size }, "[modmail] retrofit: discovered guilds");

    for (const [guildId, partialGuild] of guilds) {
      try {
        const guild = await partialGuild.fetch();
        await retrofitModmailParentsForGuild(guild);
      } catch (err) {
        logger.warn({ err, guildId }, "[modmail] retrofit: failed to process guild");
      }
    }

    logger.info({ count: guilds.size }, "[modmail] retrofit: completed across all guilds");
  } catch (err) {
    logger.error({ err }, "[modmail] retrofit: startup retrofit failed");
    captureException(err);
  }
}

// ===== Message Routing Handlers =====

/**
 * handleInboundDmForModmail
 * WHAT: Handles incoming DM messages for modmail routing.
 * WHY: Routes applicant DMs to the appropriate modmail thread.
 * PARAMS:
 *  - message: The DM message
 *  - client: Discord client
 * DOCS:
 *  - DM channels: https://discord.com/developers/docs/resources/channel#channel-object
 */
export async function handleInboundDmForModmail(message: Message, client: Client) {
  if (message.author.bot) return;

  // Find open ticket for this user across all guilds
  const ticket = db
    .prepare(
      `
    SELECT id, guild_id, user_id, app_code, review_message_id, thread_id, status, created_at, closed_at
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
 * DOCS:
 *  - Thread channels: https://discord.com/developers/docs/resources/channel#thread-object
 */
export async function handleInboundThreadMessageForModmail(message: Message, client: Client) {
  if (message.author.bot) return;
  if (!message.channel.isThread()) return;
  if (!message.guildId) return;

  const ticket = getTicketByThread(message.channel.id);
  if (ticket && ticket.status === "open") {
    await routeThreadToDm(message, ticket, client);
  }
}

// ===== Context Menu Command =====

export const modmailContextMenu = new ContextMenuCommandBuilder()
  .setName("Modmail: Open")
  .setType(ApplicationCommandType.Message)
  .setDMPermission(false);
