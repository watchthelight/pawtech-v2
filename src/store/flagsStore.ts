/**
 * Pawtropolis Tech — src/store/flagsStore.ts
 * WHAT: Manual flag storage layer for /flag command
 * WHY: Centralize flag CRUD operations with proper sanitization and duplicate prevention
 * FLOWS:
 *  - getExistingFlag(guildId, userId) → FlagRow | null
 *  - upsertManualFlag({ guildId, userId, reason, flaggedBy, joinedAt }) → FlagRow
 *  - isAlreadyFlagged(guildId, userId) → boolean
 * DOCS:
 *  - better-sqlite3 prepared statements: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { FLAG_REASON_MAX_LENGTH } from "../lib/constants.js";

// ============================================================================
// Prepared Statements (cached at module load for performance)
// ============================================================================

const getExistingFlagStmt = db.prepare(
  `SELECT guild_id, user_id, joined_at, flagged_at, flagged_reason, manual_flag, flagged_by
   FROM user_activity
   WHERE guild_id = ? AND user_id = ? AND flagged_at IS NOT NULL`
);

const getFlaggedUserIdsStmt = db.prepare(
  `SELECT user_id FROM user_activity WHERE guild_id = ? AND flagged_at IS NOT NULL`
);

const checkExistingRowStmt = db.prepare(
  `SELECT * FROM user_activity WHERE guild_id = ? AND user_id = ?`
);

const updateManualFlagStmt = db.prepare(
  `UPDATE user_activity
   SET flagged_at = ?,
       flagged_reason = ?,
       manual_flag = 1,
       flagged_by = ?
   WHERE guild_id = ? AND user_id = ?`
);

const insertManualFlagStmt = db.prepare(
  `INSERT INTO user_activity (guild_id, user_id, joined_at, flagged_at, flagged_reason, manual_flag, flagged_by)
   VALUES (?, ?, ?, ?, ?, 1, ?)`
);

const getResultRowStmt = db.prepare(
  `SELECT guild_id, user_id, joined_at, flagged_at, flagged_reason, manual_flag, flagged_by
   FROM user_activity
   WHERE guild_id = ? AND user_id = ?`
);

export interface FlagRow {
  guild_id: string;
  user_id: string;
  joined_at: number;
  flagged_at: number;
  flagged_reason: string;
  manual_flag: number; // 0 or 1
  flagged_by: string | null;
}

/**
 * WHAT: Get existing flag for a user (manual or auto-flagged)
 * WHY: Check if user is already flagged before creating duplicate
 *
 * @param guildId - Discord guild ID
 * @param userId - Discord user ID
 * @returns FlagRow if flagged, null otherwise
 * @example
 * const existing = await getExistingFlag('123', '456');
 * if (existing) {
 *   console.log(`Already flagged on ${new Date(existing.flagged_at * 1000)}`);
 * }
 */
export function getExistingFlag(guildId: string, userId: string): FlagRow | null {
  try {
    const row = getExistingFlagStmt.get(guildId, userId) as FlagRow | undefined;
    return row || null;
  } catch (err) {
    logger.error({ err, guildId, userId }, "[flagsStore] Failed to get existing flag");
    throw err;
  }
}

/**
 * WHAT: Check if user is already flagged (manual or auto)
 * WHY: Quick boolean check for duplicate prevention
 *
 * @param guildId - Discord guild ID
 * @param userId - Discord user ID
 * @returns true if flagged, false otherwise
 * @example
 * if (await isAlreadyFlagged('123', '456')) {
 *   return 'User already flagged';
 * }
 */
export function isAlreadyFlagged(guildId: string, userId: string): boolean {
  return getExistingFlag(guildId, userId) !== null;
}

/**
 * WHAT: Get all flagged user IDs for a guild
 * WHY: Support NSFW audit "flagged only" scope
 *
 * @param guildId - Discord guild ID
 * @returns Array of user IDs that are flagged
 */
export function getFlaggedUserIds(guildId: string): string[] {
  try {
    const rows = getFlaggedUserIdsStmt.all(guildId) as Array<{ user_id: string }>;
    return rows.map((row) => row.user_id);
  } catch (err) {
    logger.error({ err, guildId }, "[flagsStore] Failed to get flagged user IDs");
    return [];
  }
}

/**
 * WHAT: Upsert manual flag for a user
 * WHY: Create or update flag record with moderator attribution
 *
 * @param params.guildId - Discord guild ID
 * @param params.userId - Discord user ID
 * @param params.reason - Flag reason (truncated to 512 chars)
 * @param params.flaggedBy - Moderator user ID who created the flag
 * @param params.joinedAt - User's guild join timestamp (unix seconds), optional
 * @returns FlagRow with created/updated flag data
 * @example
 * const flag = await upsertManualFlag({
 *   guildId: '123',
 *   userId: '456',
 *   reason: 'Suspicious activity',
 *   flaggedBy: '789',
 *   joinedAt: 1640000000
 * });
 */
export function upsertManualFlag(params: {
  guildId: string;
  userId: string;
  reason: string;
  flaggedBy: string;
  joinedAt?: number | null;
}): FlagRow {
  const { guildId, userId, reason, flaggedBy, joinedAt } = params;

  // Sanitize and truncate reason to FLAG_REASON_MAX_LENGTH chars
  const sanitizedReason = reason.trim().slice(0, FLAG_REASON_MAX_LENGTH);

  // Current timestamp (unix seconds)
  const now = Math.floor(Date.now() / 1000);

  try {
    // Check if row exists
    const existing = checkExistingRowStmt.get(guildId, userId) as FlagRow | undefined;

    if (existing) {
      // UPDATE existing row with manual flag data
      updateManualFlagStmt.run(now, sanitizedReason, flaggedBy, guildId, userId);
      logger.info({ guildId, userId, flaggedBy }, "[flagsStore] Updated existing row with manual flag");
    } else {
      // INSERT new row with manual flag
      const finalJoinedAt = joinedAt ?? now;
      insertManualFlagStmt.run(guildId, userId, finalJoinedAt, now, sanitizedReason, flaggedBy);
      logger.info({ guildId, userId, flaggedBy }, "[flagsStore] Inserted new manual flag row");
    }

    // Return updated/inserted row
    const result = getResultRowStmt.get(guildId, userId) as FlagRow;
    return result;
  } catch (err) {
    logger.error({ err, guildId, userId, flaggedBy }, "[flagsStore] Failed to upsert manual flag");
    throw err;
  }
}
