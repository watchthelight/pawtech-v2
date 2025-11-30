/**
 * Pawtropolis Tech — migrations/020_add_message_activity_table.ts
 * WHAT: Create message_activity table for tracking all server messages
 * WHY: action_log only tracks moderator actions, not general message activity for heatmap
 * HOW: CREATE TABLE message_activity with guild_id, user_id, timestamp, and hour_bucket
 *
 * SAFETY:
 *  - Idempotent: CREATE TABLE IF NOT EXISTS
 *  - Additive: no changes to existing tables
 *  - Indexed: guild_id + created_at_s, guild_id + hour_bucket for efficient queries
 *
 * USAGE:
 *  - Populated by messageActivityLogger.ts via messageCreate event
 *  - Queried by activityHeatmap.ts for /activity command visualization
 *
 * ROLLBACK:
 *  - To remove: DROP TABLE message_activity;
 *  - Warning: loses all message activity history
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from 'better-sqlite3';
import { logger } from '../src/lib/logger.js';
import { tableExists, recordMigration } from './lib/helpers.js';

/**
 * Migration: Create message_activity table for heatmap data collection
 *
 * Schema:
 *   id: INTEGER PRIMARY KEY
 *   guild_id: TEXT - Discord guild ID
 *   channel_id: TEXT - Discord channel ID
 *   user_id: TEXT - Discord user ID
 *   created_at_s: INTEGER - Unix timestamp in seconds
 *   hour_bucket: INTEGER - Timestamp rounded to hour for aggregation
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate020AddMessageActivityTable(db: Database): void {
  logger.info('[migration 020] Starting: create message_activity table');

  if (!tableExists(db, 'message_activity')) {
    logger.info('[migration 020] Creating message_activity table');

    db.exec(`
      CREATE TABLE message_activity (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id      TEXT NOT NULL,
        channel_id    TEXT NOT NULL,
        user_id       TEXT NOT NULL,
        created_at_s  INTEGER NOT NULL,
        hour_bucket   INTEGER NOT NULL
      );
    `);

    logger.info('[migration 020] message_activity table created');

    // Create index for guild + time-based queries (heatmap generation)
    logger.info('[migration 020] Creating index idx_message_activity_guild_time');
    db.exec(`
      CREATE INDEX idx_message_activity_guild_time
        ON message_activity(guild_id, created_at_s DESC);
    `);

    logger.info('[migration 020] Creating index idx_message_activity_guild_hour');
    db.exec(`
      CREATE INDEX idx_message_activity_guild_hour
        ON message_activity(guild_id, hour_bucket);
    `);

    logger.info('[migration 020] Indexes created');
  } else {
    logger.info('[migration 020] message_activity table already exists, skipping');
  }

  // Record migration
  recordMigration(db, '020', 'add_message_activity_table');

  logger.info('[migration 020] ✅ Complete');
  logger.info('[migration 020] 💡 Message activity will be tracked automatically via messageCreate event');
}
