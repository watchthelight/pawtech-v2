/**
 * Pawtropolis Tech -- src/features/modmail/transcript.ts
 * WHAT: Transcript buffering and persistence for modmail conversations.
 * WHY: Maintains audit trail of staff-user communication for compliance and review.
 * DOCS:
 *  - Map: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
 *  - ISO 8601: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { AttachmentBuilder, Client, EmbedBuilder, type TextChannel, type Attachment } from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { captureException } from "../../lib/sentry.js";
import type { TranscriptLine } from "./types.js";

// ===== Transcript Buffer =====

/**
 * In-memory per-ticket transcript buffer.
 * Buffers are cleared after being flushed to .txt file on ticket close.
 */
const transcriptBuffers = new Map<number, TranscriptLine[]>();

/**
 * appendTranscript
 * WHAT: Adds a timestamped line to the in-memory transcript.
 * WHY: Tracks all messages for later export as .txt file.
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
 * getTranscriptBuffer
 * WHAT: Get the transcript buffer for a ticket.
 * WHY: Used for testing and inspection.
 */
export function getTranscriptBuffer(ticketId: number): TranscriptLine[] | undefined {
  return transcriptBuffers.get(ticketId);
}

/**
 * clearTranscriptBuffer
 * WHAT: Remove a transcript buffer from memory.
 * WHY: Called after successful flush to free memory.
 */
export function clearTranscriptBuffer(ticketId: number): void {
  transcriptBuffers.delete(ticketId);
}

// ===== Formatting =====

/**
 * formatTranscript
 * WHAT: Converts transcript lines into human-readable .txt format.
 * WHY: Provides archiveable, searchable logs for compliance/review.
 * FORMAT: [2025-10-19T00:02:15.123Z] STAFF: Ok
 */
export function formatTranscript(lines: TranscriptLine[]): string {
  return lines.map((line) => `[${line.timestamp}] ${line.author}: ${line.content}`).join("\n");
}

/**
 * formatContentWithAttachments
 * WHAT: Combines message text with attachment URLs for complete audit trail.
 * WHY: Ensures images and files are traceable in transcript.
 */
export function formatContentWithAttachments(
  content: string,
  attachments?: ReadonlyMap<string, Attachment>
): string {
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

// ===== Flush to Log Channel =====

/**
 * flushTranscript
 * WHAT: Sends the complete modmail conversation transcript to the log channel.
 * WHY: Provides permanent audit trail for compliance, review, and dispute resolution.
 * RETURNS: Message ID of the log message if sent, null otherwise.
 */
export async function flushTranscript(params: {
  client: Client;
  ticketId: number;
  guildId: string;
  userId: string;
  appCode?: string | null;
}): Promise<{ messageId: string | null; lineCount: number }> {
  const { client, ticketId, guildId, userId, appCode } = params;

  // Get config to find log channel
  const { getConfig } = await import("../../lib/config.js");
  const config = getConfig(guildId);

  if (!config?.modmail_log_channel_id) {
    logger.info({ ticketId, guildId }, "[modmail] transcript skipped (no log channel configured)");
    return { messageId: null, lineCount: 0 };
  }

  // Get transcript from in-memory buffer first (fast path)
  // If empty, fall back to database (for when bot restarted mid-conversation)
  let lines = transcriptBuffers.get(ticketId);

  // If in-memory buffer is empty, try to reconstruct from database
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

      // Alert: transcript flush failed due to invalid log channel
      await logTranscriptFailure(client, guildId, {
        ticketId,
        userId,
        appCode,
        reason: "log_channel_not_text",
        channelId: config.modmail_log_channel_id,
      });

      return { messageId: null, lineCount: 0 };
    }

    const textChannel = channel as TextChannel;

    // Build summary embed
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

    // If no transcript lines, post "No content" log
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
    await logTranscriptFailure(client, guildId, {
      ticketId,
      userId,
      appCode,
      reason: "exception",
      error: err instanceof Error ? err.message : String(err),
      channelId: config.modmail_log_channel_id,
    });

    return { messageId: null, lineCount: lines?.length ?? 0 };
  }
}

/**
 * logTranscriptFailure
 * WHAT: Log a transcript failure to the action log.
 * WHY: Ensures admins are aware when transcripts fail to flush.
 */
async function logTranscriptFailure(
  client: Client,
  guildId: string,
  meta: Record<string, unknown>
): Promise<void> {
  try {
    const { logActionPretty } = await import("../../logging/pretty.js");
    const guild = await client.guilds.fetch(guildId);
    await logActionPretty(guild, {
      actorId: client.user?.id || "system",
      action: "modmail_transcript_fail",
      meta,
    });
  } catch (alertErr) {
    logger.warn({ err: alertErr }, "[modmail] failed to log transcript failure alert");
  }
}
