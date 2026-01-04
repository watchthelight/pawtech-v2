/**
 * Pawtropolis Tech — src/store/acknowledgedSecurityStore.ts
 * WHAT: Storage layer for acknowledged security audit warnings
 * WHY: Let staff mark security warnings as intentional so they don't keep appearing
 * FLOWS:
 *  - acknowledgeIssue({ guildId, issueKey, ... }) → void
 *  - getAcknowledgedIssues(guildId) → Map<issueKey, AcknowledgedIssue>
 *  - unacknowledgeIssue(guildId, issueKey) → boolean
 *  - listAcknowledgedIssues(guildId) → AcknowledgedIssue[]
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { LRUCache } from "../lib/lruCache.js";

// ============================================================================
// Types
// ============================================================================

export interface AcknowledgedIssue {
  id: number;
  guildId: string;
  issueKey: string;
  severity: string;
  title: string;
  permissionHash: string;
  acknowledgedBy: string;
  acknowledgedAt: number; // Unix epoch seconds
  reason: string | null;
}

interface AcknowledgedIssueRow {
  id: number;
  guild_id: string;
  issue_key: string;
  severity: string;
  title: string;
  permission_hash: string;
  acknowledged_by: string;
  acknowledged_at: number;
  reason: string | null;
}

// ============================================================================
// Prepared Statements (cached at module load for performance)
// ============================================================================

const upsertAckStmt = db.prepare(
  `INSERT INTO acknowledged_security_issues
   (guild_id, issue_key, severity, title, permission_hash, acknowledged_by, acknowledged_at, reason)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(guild_id, issue_key) DO UPDATE SET
     severity = excluded.severity,
     title = excluded.title,
     permission_hash = excluded.permission_hash,
     acknowledged_by = excluded.acknowledged_by,
     acknowledged_at = excluded.acknowledged_at,
     reason = excluded.reason`
);

const getAckByGuildStmt = db.prepare(
  `SELECT * FROM acknowledged_security_issues WHERE guild_id = ?`
);

const deleteAckStmt = db.prepare(
  `DELETE FROM acknowledged_security_issues WHERE guild_id = ? AND issue_key = ?`
);

const deleteStaleAcksStmt = db.prepare(
  `DELETE FROM acknowledged_security_issues
   WHERE guild_id = ? AND issue_key NOT IN (SELECT value FROM json_each(?))`
);

// ============================================================================
// Cache Layer
// ============================================================================

// Cache acknowledgments per guild - checked on every /audit security run
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes - longer TTL since acks change rarely
const CACHE_MAX_SIZE = 100; // Max guilds to cache

type CachedAcks = Map<string, AcknowledgedIssue>;
const ackCache = new LRUCache<string, CachedAcks>(CACHE_MAX_SIZE, CACHE_TTL_MS);

function invalidateCache(guildId: string): void {
  ackCache.delete(guildId);
}

// ============================================================================
// Public Functions
// ============================================================================

/**
 * Acknowledge a security issue as intentional.
 * Upserts - can be re-acknowledged by different staff or with different reason.
 */
export function acknowledgeIssue(params: {
  guildId: string;
  issueKey: string;
  severity: string;
  title: string;
  permissionHash: string;
  acknowledgedBy: string;
  reason?: string;
}): void {
  const { guildId, issueKey, severity, title, permissionHash, acknowledgedBy, reason } = params;
  const nowS = Math.floor(Date.now() / 1000);

  try {
    upsertAckStmt.run(
      guildId,
      issueKey,
      severity,
      title,
      permissionHash,
      acknowledgedBy,
      nowS,
      reason ?? null
    );

    invalidateCache(guildId);

    logger.info(
      { guildId, issueKey, severity, acknowledgedBy },
      "[acknowledgedSecurityStore] Issue acknowledged"
    );
  } catch (err) {
    logger.error({ err, guildId, issueKey }, "[acknowledgedSecurityStore] Failed to acknowledge issue");
    throw err;
  }
}

/**
 * Get all acknowledged issues for a guild as a Map for quick lookup.
 * The Map key is the issueKey (e.g., "role:123456789:admin").
 */
export function getAcknowledgedIssues(guildId: string): Map<string, AcknowledgedIssue> {
  // Check cache first
  const cached = ackCache.get(guildId);
  if (cached !== undefined) {
    return cached;
  }

  const result = new Map<string, AcknowledgedIssue>();

  try {
    const rows = getAckByGuildStmt.all(guildId) as AcknowledgedIssueRow[];

    for (const row of rows) {
      result.set(row.issue_key, {
        id: row.id,
        guildId: row.guild_id,
        issueKey: row.issue_key,
        severity: row.severity,
        title: row.title,
        permissionHash: row.permission_hash,
        acknowledgedBy: row.acknowledged_by,
        acknowledgedAt: row.acknowledged_at,
        reason: row.reason,
      });
    }

    ackCache.set(guildId, result);
  } catch (err) {
    // Table might not exist yet if migration hasn't run
    logger.warn({ err, guildId }, "[acknowledgedSecurityStore] Failed to get acknowledged issues");
  }

  return result;
}

/**
 * List all acknowledged issues for a guild (for display purposes).
 */
export function listAcknowledgedIssues(guildId: string): AcknowledgedIssue[] {
  return Array.from(getAcknowledgedIssues(guildId).values());
}

/**
 * Remove an acknowledgment (staff changed their mind or issue is no longer intentional).
 * @returns true if an acknowledgment was deleted, false if none existed
 */
export function unacknowledgeIssue(guildId: string, issueKey: string): boolean {
  try {
    const result = deleteAckStmt.run(guildId, issueKey);
    invalidateCache(guildId);

    if (result.changes > 0) {
      logger.info(
        { guildId, issueKey },
        "[acknowledgedSecurityStore] Issue unacknowledged"
      );
      return true;
    }
    return false;
  } catch (err) {
    logger.error({ err, guildId, issueKey }, "[acknowledgedSecurityStore] Failed to unacknowledge issue");
    throw err;
  }
}

/**
 * Clean up acknowledgments for issues that no longer exist.
 * Called after audit to remove acks for deleted roles/channels.
 *
 * @param guildId - Guild to clean up
 * @param validKeys - Set of issueKeys that still exist in the audit
 */
export function clearStaleAcknowledgments(guildId: string, validKeys: Set<string>): number {
  try {
    // SQLite json_each() lets us pass a JSON array and match against it
    // This deletes any acknowledgment whose issue_key is NOT in the valid set
    const keysJson = JSON.stringify(Array.from(validKeys));
    const result = deleteStaleAcksStmt.run(guildId, keysJson);

    if (result.changes > 0) {
      invalidateCache(guildId);
      logger.info(
        { guildId, deletedCount: result.changes },
        "[acknowledgedSecurityStore] Cleared stale acknowledgments"
      );
    }

    return result.changes;
  } catch (err) {
    logger.error({ err, guildId }, "[acknowledgedSecurityStore] Failed to clear stale acknowledgments");
    return 0;
  }
}

/**
 * Clear cache entry for a guild (called on guildDelete).
 */
export function clearAckCache(guildId: string): void {
  ackCache.delete(guildId);
}
