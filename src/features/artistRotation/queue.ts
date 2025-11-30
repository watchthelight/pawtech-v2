/**
 * Pawtropolis Tech — src/features/artistRotation/queue.ts
 * WHAT: Queue CRUD operations for Server Artist rotation.
 * WHY: Manage artist queue positions, assignments, and sync with role holders.
 * FLOWS:
 *  - addArtist: Add new artist to end of queue
 *  - removeArtist: Remove artist and reorder positions
 *  - getNextArtist: Get next non-skipped artist in rotation
 *  - processAssignment: ATOMIC move artist to end + increment assignments (transaction)
 *  - moveToEnd: Legacy function - prefer processAssignment for assignment flow
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

/**
 * getQueueLength
 * WHAT: Get total number of artists in queue for a guild.
 */
export function getQueueLength(guildId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM artist_queue WHERE guild_id = ?`)
    .get(guildId) as { count: number } | undefined;
  return row?.count ?? 0;
}

/**
 * getMaxPosition
 * WHAT: Get the highest position number in the queue.
 */
function getMaxPosition(guildId: string): number {
  const row = db
    .prepare(`SELECT MAX(position) as max_pos FROM artist_queue WHERE guild_id = ?`)
    .get(guildId) as { max_pos: number | null } | undefined;
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
  const existing = db
    .prepare(`SELECT id FROM artist_queue WHERE guild_id = ? AND user_id = ?`)
    .get(guildId, userId);

  if (existing) {
    logger.debug({ guildId, userId }, "[artistQueue] User already in queue");
    return null;
  }

  const nextPosition = getMaxPosition(guildId) + 1;

  db.prepare(
    `INSERT INTO artist_queue (guild_id, user_id, position) VALUES (?, ?, ?)`
  ).run(guildId, userId, nextPosition);

  logger.info({ guildId, userId, position: nextPosition }, "[artistQueue] Artist added to queue");
  return nextPosition;
}

/**
 * removeArtist
 * WHAT: Remove an artist from the queue and reorder positions.
 * WHY: When someone loses the Server Artist role, remove them from rotation.
 * @returns The artist's assignment count before removal, or null if not found
 */
export function removeArtist(guildId: string, userId: string): number | null {
  const artist = db
    .prepare(`SELECT position, assignments_count FROM artist_queue WHERE guild_id = ? AND user_id = ?`)
    .get(guildId, userId) as { position: number; assignments_count: number } | undefined;

  if (!artist) {
    logger.debug({ guildId, userId }, "[artistQueue] User not in queue");
    return null;
  }

  // Remove the artist
  db.prepare(`DELETE FROM artist_queue WHERE guild_id = ? AND user_id = ?`).run(guildId, userId);

  // Reorder positions to fill the gap
  db.prepare(
    `UPDATE artist_queue SET position = position - 1 WHERE guild_id = ? AND position > ?`
  ).run(guildId, artist.position);

  logger.info(
    { guildId, userId, previousPosition: artist.position, assignments: artist.assignments_count },
    "[artistQueue] Artist removed from queue"
  );

  return artist.assignments_count;
}

/**
 * getArtist
 * WHAT: Get a specific artist's queue entry.
 */
export function getArtist(guildId: string, userId: string): ArtistQueueRow | null {
  const row = db
    .prepare(`SELECT * FROM artist_queue WHERE guild_id = ? AND user_id = ?`)
    .get(guildId, userId) as ArtistQueueRow | undefined;
  return row ?? null;
}

/**
 * getAllArtists
 * WHAT: Get all artists in queue ordered by position.
 */
export function getAllArtists(guildId: string): ArtistQueueRow[] {
  return db
    .prepare(`SELECT * FROM artist_queue WHERE guild_id = ? ORDER BY position ASC`)
    .all(guildId) as ArtistQueueRow[];
}

/**
 * getNextArtist
 * WHAT: Get the next artist in rotation (lowest position, not skipped).
 * WHY: Used when assigning art rewards to get who's next.
 */
export function getNextArtist(guildId: string): NextArtistResult | null {
  const row = db
    .prepare(
      `SELECT user_id, position, assignments_count, last_assigned_at
       FROM artist_queue
       WHERE guild_id = ? AND skipped = 0
       ORDER BY position ASC
       LIMIT 1`
    )
    .get(guildId) as
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
 * moveToEnd
 * WHAT: Move an artist to the end of the queue after assignment.
 * WHY: Rotate artists fairly - after handling a request, go to back of line.
 *
 * @deprecated Use processAssignment() instead when incrementing assignments.
 *             This function should only be used for manual queue reordering.
 *             Calling moveToEnd() + incrementAssignments() separately creates race conditions.
 */
export function moveToEnd(guildId: string, userId: string): number {
  const artist = db
    .prepare(`SELECT position FROM artist_queue WHERE guild_id = ? AND user_id = ?`)
    .get(guildId, userId) as { position: number } | undefined;

  if (!artist) {
    logger.warn({ guildId, userId }, "[artistQueue] Cannot move - artist not in queue");
    return -1;
  }

  const currentPosition = artist.position;
  const maxPosition = getMaxPosition(guildId);

  if (currentPosition === maxPosition) {
    // Already at end
    return currentPosition;
  }

  // Move everyone after this artist up by 1
  db.prepare(
    `UPDATE artist_queue SET position = position - 1 WHERE guild_id = ? AND position > ?`
  ).run(guildId, currentPosition);

  // Move this artist to the end
  db.prepare(`UPDATE artist_queue SET position = ? WHERE guild_id = ? AND user_id = ?`).run(
    maxPosition,
    guildId,
    userId
  );

  logger.info(
    { guildId, userId, from: currentPosition, to: maxPosition },
    "[artistQueue] Artist moved to end of queue"
  );

  return maxPosition;
}

/**
 * moveToPosition
 * WHAT: Move an artist to a specific position in the queue.
 * WHY: Manual reordering by admins.
 */
export function moveToPosition(guildId: string, userId: string, newPosition: number): boolean {
  const artist = db
    .prepare(`SELECT position FROM artist_queue WHERE guild_id = ? AND user_id = ?`)
    .get(guildId, userId) as { position: number } | undefined;

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
    db.prepare(
      `UPDATE artist_queue SET position = position - 1
       WHERE guild_id = ? AND position > ? AND position <= ?`
    ).run(guildId, currentPosition, targetPosition);
  } else {
    // Moving up: shift others down
    db.prepare(
      `UPDATE artist_queue SET position = position + 1
       WHERE guild_id = ? AND position >= ? AND position < ?`
    ).run(guildId, targetPosition, currentPosition);
  }

  // Set new position
  db.prepare(`UPDATE artist_queue SET position = ? WHERE guild_id = ? AND user_id = ?`).run(
    targetPosition,
    guildId,
    userId
  );

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
  const result = db
    .prepare(`UPDATE artist_queue SET skipped = 1, skip_reason = ? WHERE guild_id = ? AND user_id = ?`)
    .run(reason ?? null, guildId, userId);

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
  const result = db
    .prepare(`UPDATE artist_queue SET skipped = 0, skip_reason = NULL WHERE guild_id = ? AND user_id = ?`)
    .run(guildId, userId);

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
  db.prepare(
    `UPDATE artist_queue
     SET assignments_count = assignments_count + 1,
         last_assigned_at = datetime('now')
     WHERE guild_id = ? AND user_id = ?`
  ).run(guildId, userId);
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
    const artist = db
      .prepare(`SELECT position, assignments_count FROM artist_queue WHERE guild_id = ? AND user_id = ?`)
      .get(guildId, userId) as { position: number; assignments_count: number } | undefined;

    if (!artist) {
      logger.warn({ guildId, userId }, "[artistQueue] Cannot process assignment - artist not in queue");
      return null;
    }

    const currentPosition = artist.position;
    const maxPosition = getMaxPosition(guildId);

    // 2. Move artist to end (only if not already there)
    if (currentPosition !== maxPosition) {
      // Move everyone after this artist up by 1
      db.prepare(
        `UPDATE artist_queue SET position = position - 1 WHERE guild_id = ? AND position > ?`
      ).run(guildId, currentPosition);

      // Move this artist to the end
      db.prepare(
        `UPDATE artist_queue SET position = ? WHERE guild_id = ? AND user_id = ?`
      ).run(maxPosition, guildId, userId);
    }

    // 3. Increment assignments and update timestamp
    const newAssignmentsCount = artist.assignments_count + 1;
    db.prepare(
      `UPDATE artist_queue
       SET assignments_count = ?,
           last_assigned_at = datetime('now')
       WHERE guild_id = ? AND user_id = ?`
    ).run(newAssignmentsCount, guildId, userId);

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
  const result = db
    .prepare(
      `INSERT INTO artist_assignment_log
       (guild_id, artist_id, recipient_id, ticket_type, ticket_role_id, assigned_by, channel_id, override)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
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
    return db
      .prepare(
        `SELECT * FROM artist_assignment_log
         WHERE guild_id = ? AND artist_id = ?
         ORDER BY assigned_at DESC
         LIMIT ?`
      )
      .all(guildId, artistId, limit) as ArtistAssignmentRow[];
  }

  return db
    .prepare(
      `SELECT * FROM artist_assignment_log
       WHERE guild_id = ?
       ORDER BY assigned_at DESC
       LIMIT ?`
    )
    .all(guildId, limit) as ArtistAssignmentRow[];
}

/**
 * getArtistStats
 * WHAT: Get assignment stats for a specific artist.
 */
export function getArtistStats(
  guildId: string,
  artistId: string
): { totalAssignments: number; lastAssignment: string | null } {
  const row = db
    .prepare(
      `SELECT COUNT(*) as total, MAX(assigned_at) as last_at
       FROM artist_assignment_log
       WHERE guild_id = ? AND artist_id = ?`
    )
    .get(guildId, artistId) as { total: number; last_at: string | null };

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
