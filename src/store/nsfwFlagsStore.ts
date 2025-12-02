/**
 * Pawtropolis Tech — src/store/nsfwFlagsStore.ts
 * WHAT: Storage layer for NSFW avatar flags from /audit nsfw command
 * WHY: Centralize NSFW flag CRUD operations separate from bot detection flags
 * FLOWS:
 *  - upsertNsfwFlag({ guildId, userId, avatarUrl, nsfwScore, reason, flaggedBy }) → void
 *  - isNsfwFlagged(guildId, userId) → boolean
 *  - getNsfwFlagCount(guildId) → number
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

export interface NsfwFlagRow {
  id: number;
  guild_id: string;
  user_id: string;
  avatar_url: string;
  nsfw_score: number;
  reason: string;
  flagged_by: string;
  flagged_at: string;
  reviewed: number;
}

/**
 * Upsert NSFW flag for a user's avatar
 */
export function upsertNsfwFlag(params: {
  guildId: string;
  userId: string;
  avatarUrl: string;
  nsfwScore: number;
  reason: string;
  flaggedBy: string;
}): void {
  const { guildId, userId, avatarUrl, nsfwScore, reason, flaggedBy } = params;

  try {
    db.prepare(
      `INSERT INTO nsfw_flags (guild_id, user_id, avatar_url, nsfw_score, reason, flagged_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET
         avatar_url = excluded.avatar_url,
         nsfw_score = excluded.nsfw_score,
         reason = excluded.reason,
         flagged_by = excluded.flagged_by,
         flagged_at = datetime('now'),
         reviewed = 0`
    ).run(guildId, userId, avatarUrl, nsfwScore, reason, flaggedBy);

    logger.info(
      { guildId, userId, nsfwScore, reason },
      "[nsfwFlagsStore] Upserted NSFW flag"
    );
  } catch (err) {
    logger.error({ err, guildId, userId }, "[nsfwFlagsStore] Failed to upsert NSFW flag");
    throw err;
  }
}

/**
 * Check if user is already NSFW flagged
 */
export function isNsfwFlagged(guildId: string, userId: string): boolean {
  try {
    const row = db
      .prepare(
        `SELECT 1 FROM nsfw_flags WHERE guild_id = ? AND user_id = ?`
      )
      .get(guildId, userId);
    return row !== undefined;
  } catch (err) {
    logger.error({ err, guildId, userId }, "[nsfwFlagsStore] Failed to check NSFW flag");
    return false;
  }
}

/**
 * Get count of NSFW flags for a guild
 */
export function getNsfwFlagCount(guildId: string): number {
  try {
    const row = db
      .prepare(`SELECT COUNT(*) as count FROM nsfw_flags WHERE guild_id = ?`)
      .get(guildId) as { count: number } | undefined;
    return row?.count ?? 0;
  } catch (err) {
    logger.error({ err, guildId }, "[nsfwFlagsStore] Failed to get NSFW flag count");
    return 0;
  }
}

/**
 * Get pending (unreviewed) NSFW flags for a guild
 */
export function getPendingNsfwFlags(guildId: string): NsfwFlagRow[] {
  try {
    return db
      .prepare(
        `SELECT * FROM nsfw_flags WHERE guild_id = ? AND reviewed = 0 ORDER BY flagged_at DESC`
      )
      .all(guildId) as NsfwFlagRow[];
  } catch (err) {
    logger.error({ err, guildId }, "[nsfwFlagsStore] Failed to get pending NSFW flags");
    return [];
  }
}
