/**
 * Pawtropolis Tech — src/features/messageActivityLogger.ts
 * WHAT: Logs all server messages to message_activity table for heatmap visualization
 * WHY: Provides real server activity data for /activity command heatmap
 * FLOWS:
 *  - logMessage(message) → buffers in memory → flushMessageBuffer() inserts batch
 * DOCS:
 *  - Migration 020: migrations/020_add_message_activity_table.ts
 *  - Activity Heatmap: src/lib/activityHeatmap.ts
 * PERF:
 *  - Batched writes: Messages buffered in memory, flushed every 1 second
 *  - 95% reduction in event loop blocking vs per-message writes
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from '../db/db.js';
import { logger } from '../lib/logger.js';
import type { Message } from 'discord.js';

/**
 * Buffered message activity entry for batch insertion
 */
interface MessageActivity {
  guildId: string;
  channelId: string;
  userId: string;
  created_at_s: number;
  hour_bucket: number;
}

/**
 * In-memory buffer for message activity. Flushed every 1 second to reduce
 * event loop blocking from per-message synchronous DB writes.
 */
const messageBuffer: MessageActivity[] = [];

/**
 * Timer handle for scheduled flush. Null when no flush is pending.
 */
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Flush interval in milliseconds. Short enough for near-real-time data,
 * long enough to batch multiple messages in high-traffic servers.
 */
const FLUSH_INTERVAL_MS = 1000;

/**
 * Maximum buffer size to prevent OOM in edge cases (e.g., DB outage during traffic spike).
 * At ~100 bytes per entry, 10,000 entries = ~1MB memory usage.
 */
const MAX_BUFFER_SIZE = 10000;

/**
 * WHAT: Log a message to message_activity table (buffered)
 * WHY: Tracks all server messages for activity heatmap visualization
 * HOW: Buffers messages in memory, flushes every 1 second in a single transaction
 *
 * @param message - Discord message object
 * @example
 * client.on('messageCreate', (message) => {
 *   if (!message.author.bot && message.guildId) {
 *     logMessage(message);
 *   }
 * });
 */
export function logMessage(message: Message): void {
  // Filter out non-human messages. Bots and webhooks would skew activity metrics
  // and potentially create feedback loops (bot posts trigger more bot posts).
  if (!message.guildId) return;
  if (message.author.bot) return;
  if (message.webhookId) return;

  // Buffer overflow protection: Drop oldest 10% of messages if buffer is full
  // This prevents OOM during DB outages or extreme traffic spikes
  if (messageBuffer.length >= MAX_BUFFER_SIZE) {
    const dropCount = Math.floor(MAX_BUFFER_SIZE * 0.1);
    logger.warn(
      { bufferSize: messageBuffer.length, dropCount },
      '[message_activity] Buffer full, dropping oldest messages'
    );
    messageBuffer.splice(0, dropCount);
  }

  const created_at_s = Math.floor(message.createdTimestamp / 1000);

  // Hour buckets enable O(1) aggregation for heatmaps without GROUP BY on raw timestamps.
  // Storing both precise time and bucket lets us do detailed queries when needed
  // while keeping heatmap rendering fast.
  const hour_bucket = Math.floor(created_at_s / 3600) * 3600;

  messageBuffer.push({
    guildId: message.guildId,
    channelId: message.channelId,
    userId: message.author.id,
    created_at_s,
    hour_bucket,
  });

  // Schedule flush if not already scheduled
  if (!flushTimer) {
    flushTimer = setTimeout(flushMessageBuffer, FLUSH_INTERVAL_MS);
  }
}

/**
 * WHAT: Flush buffered messages to database in a single transaction
 * WHY: Reduces event loop blocking by batching multiple inserts
 * HOW: Drains buffer, wraps inserts in transaction for atomicity and speed
 */
function flushMessageBuffer(): void {
  flushTimer = null;

  if (messageBuffer.length === 0) return;

  // Drain buffer atomically - splice returns removed items and empties array
  const batch = messageBuffer.splice(0, messageBuffer.length);

  try {
    db.transaction(() => {
      const stmt = db.prepare(
        `INSERT INTO message_activity (guild_id, channel_id, user_id, created_at_s, hour_bucket)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const msg of batch) {
        stmt.run(msg.guildId, msg.channelId, msg.userId, msg.created_at_s, msg.hour_bucket);
      }
    })();

    logger.debug({ count: batch.length }, '[message_activity] flushed batch');
  } catch (err: any) {
    // Gracefully handle missing table - this happens when running against a
    // database that predates migration 020. We don't want to crash the bot
    // just because activity tracking isn't available yet.
    if (err?.message?.includes('no such table: message_activity')) {
      logger.debug(
        { err, batchSize: batch.length },
        '[message_activity] message_activity table missing - migration 020 may not have run yet'
      );
      return;
    }
    // Swallow errors silently after logging. Activity tracking is nice-to-have,
    // not critical path. A DB hiccup shouldn't disrupt normal bot operation.
    logger.warn({ err, batchSize: batch.length }, '[message_activity] flush failed');
  }
}

/**
 * WHAT: Flush any remaining buffered messages on shutdown
 * WHY: Ensures no data loss during graceful shutdown
 * HOW: Clears pending timer and immediately flushes buffer
 *
 * Call this from the graceful shutdown handler in src/index.ts
 */
export function flushOnShutdown(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushMessageBuffer();
}

/**
 * Prune old message activity data to prevent unbounded table growth.
 *
 * The heatmap only shows 8 weeks, but we keep 90 days by default to allow
 * for some historical queries and buffer. At ~1000 messages/day for an active
 * server, 90 days is about 90K rows - manageable for SQLite.
 *
 * Call this periodically (e.g., daily via cron job or scheduled task).
 * It's safe to call frequently - DELETE with no matching rows is cheap.
 *
 * @param guildId - Discord guild ID
 * @param daysToKeep - Number of days of history to keep (default: 90)
 * @returns Number of rows deleted
 */
export function pruneOldMessages(guildId: string, daysToKeep: number = 90): number {
  const cutoffTimestamp = Math.floor(Date.now() / 1000) - (daysToKeep * 86400);

  try {
    const result = db
      .prepare(
        `DELETE FROM message_activity
         WHERE guild_id = ? AND created_at_s < ?`
      )
      .run(guildId, cutoffTimestamp);

    const deleted = result.changes;
    logger.info(
      { guildId, daysToKeep, cutoffTimestamp, deleted },
      '[message_activity] pruned old messages'
    );

    return deleted;
  } catch (err) {
    logger.warn({ err, guildId, daysToKeep }, '[message_activity] failed to prune old messages');
    return 0;
  }
}
