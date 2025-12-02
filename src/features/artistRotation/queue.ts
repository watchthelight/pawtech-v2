/**
 * Pawtropolis Tech — src/features/artistRotation/queue.ts
 * WHAT: Queue CRUD operations for Server Artist rotation.
 * WHY: Manage artist queue positions, assignments, and sync with role holders.
 * FLOWS:
 *  - addArtist: Add new artist to end of queue
 *  - removeArtist: Remove artist and reorder positions
 *  - getNextArtist: Get next non-skipped artist in rotation
 *  - processAssignment: ATOMIC move artist to end + increment assignments (transaction)
 *  - syncWithRole: Sync queue with current Server Artist role holders
 *
 * CONCURRENCY:
 *  - processAssignment uses db.transaction() for atomic queue updates
 *  - Prevents race conditions during simultaneous assignments
 *  - better-sqlite3 transactions are synchronous and ACID-compliant
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import type {
  ArtistQueueRow,
  ArtistAssignmentRow,
  NextArtistResult,
  AssignmentOptions,
  SyncResult,
} from "./types.js";

// ============================================================================
// Prepared Statements (cached at module load for performance)
// ============================================================================

const getQueueLengthStmt = db.prepare(
  `SELECT COUNT(*) as count FROM artist_queue WHERE guild_id = ?`
);

const getMaxPositionStmt = db.prepare(
  `SELECT MAX(position) as max_pos FROM artist_queue WHERE guild_id = ?`
);

const checkArtistExistsStmt = db.prepare(
  `SELECT id FROM artist_queue WHERE guild_id = ? AND user_id = ?`
);

const insertArtistStmt = db.prepare(
  `INSERT INTO artist_queue (guild_id, user_id, position) VALUES (?, ?, ?)`
);

const getArtistForRemovalStmt = db.prepare(
  `SELECT position, assignments_count FROM artist_queue WHERE guild_id = ? AND user_id = ?`
);

const deleteArtistStmt = db.prepare(
  `DELETE FROM artist_queue WHERE guild_id = ? AND user_id = ?`
);

const reorderPositionsAfterRemovalStmt = db.prepare(
  `UPDATE artist_queue SET position = position - 1 WHERE guild_id = ? AND position > ?`
);

const getArtistStmt = db.prepare(
  `SELECT * FROM artist_queue WHERE guild_id = ? AND user_id = ?`
);

const getAllArtistsStmt = db.prepare(
  `SELECT * FROM artist_queue WHERE guild_id = ? ORDER BY position ASC`
);

const getNextArtistStmt = db.prepare(
  `SELECT user_id, position, assignments_count, last_assigned_at
   FROM artist_queue
   WHERE guild_id = ? AND skipped = 0
   ORDER BY position ASC
   LIMIT 1`
);

const getArtistPositionStmt = db.prepare(
  `SELECT position FROM artist_queue WHERE guild_id = ? AND user_id = ?`
);

const shiftPositionsUpStmt = db.prepare(
  `UPDATE artist_queue SET position = position - 1
   WHERE guild_id = ? AND position > ? AND position <= ?`
);

const shiftPositionsDownStmt = db.prepare(
  `UPDATE artist_queue SET position = position + 1
   WHERE guild_id = ? AND position >= ? AND position < ?`
);

const setPositionStmt = db.prepare(
  `UPDATE artist_queue SET position = ? WHERE guild_id = ? AND user_id = ?`
);

const skipArtistStmt = db.prepare(
  `UPDATE artist_queue SET skipped = 1, skip_reason = ? WHERE guild_id = ? AND user_id = ?`
);

const unskipArtistStmt = db.prepare(
  `UPDATE artist_queue SET skipped = 0, skip_reason = NULL WHERE guild_id = ? AND user_id = ?`
);

const incrementAssignmentsStmt = db.prepare(
  `UPDATE artist_queue
   SET assignments_count = assignments_count + 1,
       last_assigned_at = datetime('now')
   WHERE guild_id = ? AND user_id = ?`
);

const getArtistStateStmt = db.prepare(
  `SELECT position, assignments_count FROM artist_queue WHERE guild_id = ? AND user_id = ?`
);

const shiftPositionsAfterStmt = db.prepare(
  `UPDATE artist_queue SET position = position - 1 WHERE guild_id = ? AND position > ?`
);

const updateAssignmentsStmt = db.prepare(
  `UPDATE artist_queue
   SET assignments_count = ?,
       last_assigned_at = datetime('now')
   WHERE guild_id = ? AND user_id = ?`
);

const logAssignmentStmt = db.prepare(
  `INSERT INTO artist_assignment_log
   (guild_id, artist_id, recipient_id, ticket_type, ticket_role_id, assigned_by, channel_id, override)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

const getAssignmentHistoryByArtistStmt = db.prepare(
  `SELECT * FROM artist_assignment_log
   WHERE guild_id = ? AND artist_id = ?
   ORDER BY assigned_at DESC
   LIMIT ?`
);

const getAssignmentHistoryAllStmt = db.prepare(
  `SELECT * FROM artist_assignment_log
   WHERE guild_id = ?
   ORDER BY assigned_at DESC
   LIMIT ?`
);

const getArtistStatsStmt = db.prepare(
  `SELECT COUNT(*) as total, MAX(assigned_at) as last_at
   FROM artist_assignment_log
   WHERE guild_id = ? AND artist_id = ?`
);

/**
 * getQueueLength
 * WHAT: Get total number of artists in queue for a guild.
 */
export function getQueueLength(guildId: string): number {
  const row = getQueueLengthStmt.get(guildId) as { count: number } | undefined;
  return row?.count ?? 0;
}

/**
 * getMaxPosition
 * WHAT: Get the highest position number in the queue.
 */
function getMaxPosition(guildId: string): number {
  const row = getMaxPositionStmt.get(guildId) as { max_pos: number | null } | undefined;
  return row?.max_pos ?? 0;
}

/**
 * addArtist
 * WHAT: Add a new artist to the end of the queue.
 * WHY: When someone receives the Server Artist role, they join the rotation.
 * @returns The position they were added at, or null if already in queue
 */
export function addArtist(guildId: string, userId: string): number | null {
  // Check if already in queue
  const existing = checkArtistExistsStmt.get(guildId, userId);

  if (existing) {
    logger.debug({ guildId, userId }, "[artistQueue] User already in queue");
    return null;
  }

  const nextPosition = getMaxPosition(guildId) + 1;
  insertArtistStmt.run(guildId, userId, nextPosition);

  logger.info({ guildId, userId, position: nextPosition }, "[artistQueue] Artist added to queue");
  return nextPosition;
}

/**
 * removeArtist
 * WHAT: Remove an artist from the queue and reorder positions.
 * WHY: When someone loses the Server Artist role, remove them from rotation.
 * SECURITY: Uses transaction to ensure DELETE and position reorder happen atomically.
 * @returns The artist's assignment count before removal, or null if not found
 */
export function removeArtist(guildId: string, userId: string): number | null {
  return db.transaction(() => {
    const artist = getArtistForRemovalStmt.get(guildId, userId) as
      | { position: number; assignments_count: number }
      | undefined;

    if (!artist) {
      logger.debug({ guildId, userId }, "[artistQueue] User not in queue");
      return null;
    }

    // Remove the artist
    deleteArtistStmt.run(guildId, userId);

    // Reorder positions to fill the gap
    reorderPositionsAfterRemovalStmt.run(guildId, artist.position);

    logger.info(
      { guildId, userId, previousPosition: artist.position, assignments: artist.assignments_count },
      "[artistQueue] Artist removed from queue"
    );

    return artist.assignments_count;
  })();
}

/**
 * getArtist
 * WHAT: Get a specific artist's queue entry.
 */
export function getArtist(guildId: string, userId: string): ArtistQueueRow | null {
  const row = getArtistStmt.get(guildId, userId) as ArtistQueueRow | undefined;
  return row ?? null;
}

/**
 * getAllArtists
 * WHAT: Get all artists in queue ordered by position.
 */
export function getAllArtists(guildId: string): ArtistQueueRow[] {
  return getAllArtistsStmt.all(guildId) as ArtistQueueRow[];
}

/**
 * getNextArtist
 * WHAT: Get the next artist in rotation (lowest position, not skipped).
 * WHY: Used when assigning art rewards to get who's next.
 */
export function getNextArtist(guildId: string): NextArtistResult | null {
  const row = getNextArtistStmt.get(guildId) as
    | { user_id: string; position: number; assignments_count: number; last_assigned_at: string | null }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    position: row.position,
    assignmentsCount: row.assignments_count,
    lastAssignedAt: row.last_assigned_at,
  };
}

/**
 * moveToPosition
 * WHAT: Move an artist to a specific position in the queue.
 * WHY: Manual reordering by admins.
 */
export function moveToPosition(guildId: string, userId: string, newPosition: number): boolean {
  const artist = getArtistPositionStmt.get(guildId, userId) as { position: number } | undefined;

  if (!artist) {
    return false;
  }

  const currentPosition = artist.position;
  const maxPosition = getMaxPosition(guildId);

  // Clamp to valid range
  const targetPosition = Math.max(1, Math.min(newPosition, maxPosition));

  if (currentPosition === targetPosition) {
    return true; // No change needed
  }

  if (currentPosition < targetPosition) {
    // Moving down: shift others up
    shiftPositionsUpStmt.run(guildId, currentPosition, targetPosition);
  } else {
    // Moving up: shift others down
    shiftPositionsDownStmt.run(guildId, targetPosition, currentPosition);
  }

  // Set new position
  setPositionStmt.run(targetPosition, guildId, userId);

  logger.info(
    { guildId, userId, from: currentPosition, to: targetPosition },
    "[artistQueue] Artist position changed"
  );

  return true;
}

/**
 * skipArtist
 * WHAT: Mark an artist as skipped in rotation.
 * WHY: Artist may be on break or temporarily unavailable.
 */
export function skipArtist(guildId: string, userId: string, reason?: string): boolean {
  const result = skipArtistStmt.run(reason ?? null, guildId, userId);

  if (result.changes > 0) {
    logger.info({ guildId, userId, reason }, "[artistQueue] Artist skipped");
    return true;
  }
  return false;
}

/**
 * unskipArtist
 * WHAT: Remove skip status from an artist.
 */
export function unskipArtist(guildId: string, userId: string): boolean {
  const result = unskipArtistStmt.run(guildId, userId);

  if (result.changes > 0) {
    logger.info({ guildId, userId }, "[artistQueue] Artist unskipped");
    return true;
  }
  return false;
}

/**
 * incrementAssignments
 * WHAT: Increment assignment count and update last_assigned_at timestamp.
 * WHY: Track how many assignments each artist has handled.
 */
export function incrementAssignments(guildId: string, userId: string): void {
  incrementAssignmentsStmt.run(guildId, userId);
}

/**
 * processAssignment
 * WHAT: Atomically move artist to end of queue and increment assignment count.
 * WHY: Prevents race conditions when multiple assignments happen simultaneously.
 * SECURITY: Uses transaction to ensure queue position and assignment count are updated atomically.
 *
 * @param guildId - Guild ID
 * @param userId - Artist user ID
 * @returns Object with old position, new position, and new assignment count
 */
export function processAssignment(
  guildId: string,
  userId: string
): { oldPosition: number; newPosition: number; assignmentsCount: number } | null {
  return db.transaction(() => {
    // 1. Get current artist state
    const artist = getArtistStateStmt.get(guildId, userId) as
      | { position: number; assignments_count: number }
      | undefined;

    if (!artist) {
      logger.warn({ guildId, userId }, "[artistQueue] Cannot process assignment - artist not in queue");
      return null;
    }

    const currentPosition = artist.position;
    const maxPosition = getMaxPosition(guildId);

    // 2. Move artist to end (only if not already there)
    if (currentPosition !== maxPosition) {
      // Move everyone after this artist up by 1
      shiftPositionsAfterStmt.run(guildId, currentPosition);

      // Move this artist to the end
      setPositionStmt.run(maxPosition, guildId, userId);
    }

    // 3. Increment assignments and update timestamp
    const newAssignmentsCount = artist.assignments_count + 1;
    updateAssignmentsStmt.run(newAssignmentsCount, guildId, userId);

    logger.info(
      {
        guildId,
        userId,
        oldPosition: currentPosition,
        newPosition: maxPosition,
        assignmentsCount: newAssignmentsCount,
      },
      "[artistQueue] Assignment processed atomically"
    );

    return {
      oldPosition: currentPosition,
      newPosition: maxPosition,
      assignmentsCount: newAssignmentsCount,
    };
  })();
}

/**
 * logAssignment
 * WHAT: Record an art reward assignment in the audit log.
 */
export function logAssignment(options: AssignmentOptions): number {
  const result = logAssignmentStmt.run(
    options.guildId,
    options.artistId,
    options.recipientId,
    options.ticketType,
    options.ticketRoleId,
    options.assignedBy,
    options.channelId,
    options.override ? 1 : 0
  );

  logger.info(
    {
      guildId: options.guildId,
      artistId: options.artistId,
      recipientId: options.recipientId,
      ticketType: options.ticketType,
      assignedBy: options.assignedBy,
      override: options.override,
    },
    "[artistQueue] Assignment logged"
  );

  return result.lastInsertRowid as number;
}

/**
 * getAssignmentHistory
 * WHAT: Get assignment history, optionally filtered by artist.
 */
export function getAssignmentHistory(
  guildId: string,
  artistId?: string,
  limit = 10
): ArtistAssignmentRow[] {
  if (artistId) {
    return getAssignmentHistoryByArtistStmt.all(guildId, artistId, limit) as ArtistAssignmentRow[];
  }

  return getAssignmentHistoryAllStmt.all(guildId, limit) as ArtistAssignmentRow[];
}

/**
 * getArtistStats
 * WHAT: Get assignment stats for a specific artist.
 */
export function getArtistStats(
  guildId: string,
  artistId: string
): { totalAssignments: number; lastAssignment: string | null } {
  const row = getArtistStatsStmt.get(guildId, artistId) as { total: number; last_at: string | null };

  return {
    totalAssignments: row.total,
    lastAssignment: row.last_at,
  };
}

/**
 * syncWithRoleMembers
 * WHAT: Sync the queue with a list of user IDs who have the Server Artist role.
 * WHY: Ensure queue matches reality - add missing, remove stale entries.
 */
export function syncWithRoleMembers(guildId: string, roleHolderIds: string[]): SyncResult {
  const currentQueue = getAllArtists(guildId);
  const currentIds = new Set(currentQueue.map((a) => a.user_id));
  const roleHolderSet = new Set(roleHolderIds);

  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  // Add missing artists
  for (const userId of roleHolderIds) {
    if (!currentIds.has(userId)) {
      addArtist(guildId, userId);
      added.push(userId);
    } else {
      unchanged.push(userId);
    }
  }

  // Remove artists who no longer have the role
  for (const artist of currentQueue) {
    if (!roleHolderSet.has(artist.user_id)) {
      removeArtist(guildId, artist.user_id);
      removed.push(artist.user_id);
    }
  }

  logger.info(
    { guildId, added: added.length, removed: removed.length, unchanged: unchanged.length },
    "[artistQueue] Queue synced with role members"
  );

  return { added, removed, unchanged };
}
