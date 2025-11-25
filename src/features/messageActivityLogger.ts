/**
 * Pawtropolis Tech — src/features/messageActivityLogger.ts
 * WHAT: Logs all server messages to message_activity table for heatmap visualization
 * WHY: Provides real server activity data for /activity command heatmap
 * FLOWS:
 *  - logMessage(guildId, channelId, userId, timestamp) → inserts into message_activity
 * DOCS:
 *  - Migration 020: migrations/020_add_message_activity_table.ts
 *  - Activity Heatmap: src/lib/activityHeatmap.ts
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from '../db/db.js';
import { logger } from '../lib/logger.js';
import type { Message } from 'discord.js';

/**
 * WHAT: Log a message to message_activity table
 * WHY: Tracks all server messages for activity heatmap visualization
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
  if (!message.guildId) return; // DMs don't count
  if (message.author.bot) return; // Ignore bots
  if (message.webhookId) return; // Ignore webhooks

  const guildId = message.guildId;
  const channelId = message.channelId;
  const userId = message.author.id;
  const created_at_s = Math.floor(message.createdTimestamp / 1000);

  // Round to hour bucket for efficient aggregation
  const hour_bucket = Math.floor(created_at_s / 3600) * 3600;

  try {
    db.prepare(
      `INSERT INTO message_activity (guild_id, channel_id, user_id, created_at_s, hour_bucket)
       VALUES (?, ?, ?, ?, ?)`
    ).run(guildId, channelId, userId, created_at_s, hour_bucket);

    logger.debug(
      { guildId, channelId, userId, created_at_s, hour_bucket },
      '[message_activity] message logged'
    );
  } catch (err: any) {
    // Gracefully handle missing table (pre-migration databases)
    if (err?.message?.includes('no such table: message_activity')) {
      logger.debug(
        { err, guildId },
        '[message_activity] message_activity table missing - migration 020 may not have run yet'
      );
      return;
    }
    // Log other errors but don't throw (activity logging is non-critical)
    logger.warn({ err, guildId, channelId, userId }, '[message_activity] failed to log message');
  }
}

/**
 * WHAT: Prune old message activity data to prevent database bloat
 * WHY: Heatmap only shows last 8 weeks, older data can be purged
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
