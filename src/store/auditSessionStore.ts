/**
 * Pawtropolis Tech — src/store/auditSessionStore.ts
 * WHAT: Storage layer for audit session tracking to enable resume functionality
 * WHY: Track audit progress so interrupted audits can be resumed where they left off
 * FLOWS:
 *  - createSession(guildId, type, scope, ...) → session ID
 *  - getActiveSession(guildId, type) → session or null
 *  - markUserScanned(sessionId, userId) → void
 *  - getScannedUserIds(sessionId) → Set<string>
 *  - updateProgress(sessionId, scanned, flagged, apiCalls) → void
 *  - completeSession(sessionId) → void
 *  - cancelSession(sessionId) → void
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

// ============================================================================
// Prepared Statements (cached at module load for performance)
// ============================================================================

const createSessionStmt = db.prepare(
  `INSERT INTO audit_sessions (guild_id, audit_type, scope, started_by, total_to_scan, channel_id)
   VALUES (?, ?, ?, ?, ?, ?)`
);

const getActiveSessionStmt = db.prepare(
  `SELECT * FROM audit_sessions
   WHERE guild_id = ? AND audit_type = ? AND status = 'in_progress'
   ORDER BY started_at DESC
   LIMIT 1`
);

const markUserScannedStmt = db.prepare(
  `INSERT OR IGNORE INTO audit_scanned_users (session_id, user_id) VALUES (?, ?)`
);

const getScannedUserIdsStmt = db.prepare(
  `SELECT user_id FROM audit_scanned_users WHERE session_id = ?`
);

const updateProgressStmt = db.prepare(
  `UPDATE audit_sessions
   SET scanned_count = ?, flagged_count = ?, api_calls = ?
   WHERE id = ?`
);

const completeSessionStmt = db.prepare(
  `UPDATE audit_sessions
   SET status = 'completed', completed_at = datetime('now')
   WHERE id = ?`
);

const cancelSessionStmt = db.prepare(
  `UPDATE audit_sessions
   SET status = 'cancelled', completed_at = datetime('now')
   WHERE id = ?`
);

export interface AuditSession {
  id: number;
  guild_id: string;
  audit_type: "members" | "nsfw";
  scope: string | null;
  status: "in_progress" | "completed" | "cancelled";
  started_by: string;
  started_at: string;
  completed_at: string | null;
  total_to_scan: number;
  scanned_count: number;
  flagged_count: number;
  api_calls: number;
  channel_id: string;
}

/**
 * Create a new audit session
 */
export function createSession(params: {
  guildId: string;
  auditType: "members" | "nsfw";
  scope: string | null;
  startedBy: string;
  totalToScan: number;
  channelId: string;
}): number {
  const { guildId, auditType, scope, startedBy, totalToScan, channelId } = params;

  try {
    const result = createSessionStmt.run(guildId, auditType, scope, startedBy, totalToScan, channelId);
    const sessionId = result.lastInsertRowid as number;

    logger.info(
      { guildId, auditType, scope, sessionId, totalToScan },
      "[auditSessionStore] Created new audit session"
    );

    return sessionId;
  } catch (err) {
    logger.error({ err, guildId, auditType }, "[auditSessionStore] Failed to create session");
    throw err;
  }
}

/**
 * Get active (in_progress) session for a guild and audit type
 */
export function getActiveSession(
  guildId: string,
  auditType: "members" | "nsfw"
): AuditSession | null {
  try {
    const row = getActiveSessionStmt.get(guildId, auditType) as AuditSession | undefined;
    return row ?? null;
  } catch (err) {
    logger.error({ err, guildId, auditType }, "[auditSessionStore] Failed to get active session");
    return null;
  }
}

/**
 * Mark a user as scanned in the current session
 */
export function markUserScanned(sessionId: number, userId: string): void {
  try {
    markUserScannedStmt.run(sessionId, userId);
  } catch (err) {
    logger.error({ err, sessionId, userId }, "[auditSessionStore] Failed to mark user scanned");
  }
}

/**
 * Get all scanned user IDs for a session (for efficient resume)
 */
export function getScannedUserIds(sessionId: number): Set<string> {
  try {
    const rows = getScannedUserIdsStmt.all(sessionId) as Array<{ user_id: string }>;
    return new Set(rows.map((r) => r.user_id));
  } catch (err) {
    logger.error({ err, sessionId }, "[auditSessionStore] Failed to get scanned user IDs");
    return new Set();
  }
}

/**
 * Update progress counters for a session
 */
export function updateProgress(
  sessionId: number,
  scannedCount: number,
  flaggedCount: number,
  apiCalls: number
): void {
  try {
    updateProgressStmt.run(scannedCount, flaggedCount, apiCalls, sessionId);
  } catch (err) {
    logger.error({ err, sessionId }, "[auditSessionStore] Failed to update progress");
  }
}

/**
 * Mark session as completed
 */
export function completeSession(sessionId: number): void {
  try {
    completeSessionStmt.run(sessionId);
    logger.info({ sessionId }, "[auditSessionStore] Completed audit session");
  } catch (err) {
    logger.error({ err, sessionId }, "[auditSessionStore] Failed to complete session");
  }
}

/**
 * Mark session as cancelled
 */
export function cancelSession(sessionId: number): void {
  try {
    cancelSessionStmt.run(sessionId);
    logger.info({ sessionId }, "[auditSessionStore] Cancelled audit session");
  } catch (err) {
    logger.error({ err, sessionId }, "[auditSessionStore] Failed to cancel session");
  }
}
