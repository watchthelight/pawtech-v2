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

/*
 * GOTCHA: Prepared statements are cached at import time. If you're seeing
 * "database is locked" or statement handle errors after db reconnection,
 * this is why. The app assumes one db handle for the lifetime of the process.
 * Don't overthink it - just restart the bot.
 */

const createSessionStmt = db.prepare(
  `INSERT INTO audit_sessions (guild_id, audit_type, scope, started_by, total_to_scan, channel_id)
   VALUES (?, ?, ?, ?, ?, ?)`
);

// ORDER BY + LIMIT 1 means we only care about the most recent in-progress session.
// If somehow two sessions got started (shouldn't happen, but Discord is chaos),
// we'll grab the newest one and the old one will rot in the database forever.
const getActiveSessionStmt = db.prepare(
  `SELECT * FROM audit_sessions
   WHERE guild_id = ? AND audit_type = ? AND status = 'in_progress'
   ORDER BY started_at DESC
   LIMIT 1`
);

// INSERT OR IGNORE: If we try to mark the same user twice (e.g., resumed audit
// hitting overlap), just silently do nothing. Better than crashing mid-scan.
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

// Both complete and cancel set completed_at. Yes, "completed_at" for a cancelled
// session is weird naming. Think of it as "ended_at" but we were too lazy to rename.
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

/*
 * These fields mirror the audit_sessions table schema exactly.
 * If you change the table, change this. If you change this, change the table.
 * SQLite doesn't enforce types anyway, but at least TypeScript can yell at you.
 */
export interface AuditSession {
  id: number;
  guild_id: string;
  audit_type: "members" | "nsfw";
  scope: string | null;
  status: "in_progress" | "completed" | "cancelled";
  started_by: string;
  started_at: string; // ISO 8601 from SQLite's datetime()
  completed_at: string | null;
  total_to_scan: number;
  scanned_count: number;
  flagged_count: number;
  api_calls: number; // Tracks Google Vision API calls - useful for billing awareness since Vision ain't free
  channel_id: string; // Where to send progress updates; needed for resume when the original interaction is long dead
}

/**
 * Create a new audit session.
 *
 * WHY return the session ID: Callers need it to mark users as scanned and
 * update progress. Returning it saves a round-trip query.
 */
export function createSession(params: {
  guildId: string;
  auditType: "members" | "nsfw";
  scope: string | null;
  startedBy: string;
  totalToScan: number;
  channelId: string; // Where to send progress updates and final results
}): number {
  const { guildId, auditType, scope, startedBy, totalToScan, channelId } = params;

  try {
    const result = createSessionStmt.run(guildId, auditType, scope, startedBy, totalToScan, channelId);
    // GOTCHA: lastInsertRowid is typed as number | bigint, but our IDs never exceed
    // Number.MAX_SAFE_INTEGER (we'd need 9 quadrillion audits). Safe to cast.
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
 * Get active (in_progress) session for a guild and audit type.
 *
 * Returns null on error instead of throwing. The caller typically uses this
 * to check "should I resume?" and null means "no, start fresh" which is
 * a safe fallback even if the real answer was "database exploded."
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
 * Mark a user as scanned in the current session.
 *
 * Swallows errors intentionally. If we can't record that someone was scanned,
 * the worst case is they get scanned again on resume. Not great, not fatal.
 */
export function markUserScanned(sessionId: number, userId: string): void {
  try {
    markUserScannedStmt.run(sessionId, userId);
  } catch (err) {
    logger.error({ err, sessionId, userId }, "[auditSessionStore] Failed to mark user scanned");
  }
}

/**
 * Get all scanned user IDs for a session (for efficient resume).
 *
 * Returns a Set for O(1) lookup when filtering out already-scanned users.
 * For a 10k member server, array.includes() would be noticeably slower.
 */
export function getScannedUserIds(sessionId: number): Set<string> {
  try {
    const rows = getScannedUserIdsStmt.all(sessionId) as Array<{ user_id: string }>;
    return new Set(rows.map((r) => r.user_id));
  } catch (err) {
    // Return empty set on error - resume will just re-scan some users.
    // Not ideal but better than failing the entire audit.
    logger.error({ err, sessionId }, "[auditSessionStore] Failed to get scanned user IDs");
    return new Set();
  }
}

/**
 * Update progress counters for a session.
 *
 * PERF: This gets called after every batch, not every user. Batching reduces
 * write amplification and keeps SQLite happy. Caller is responsible for
 * deciding batch frequency (currently every 10 users or so).
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
 * Mark session as completed.
 *
 * NOTE: We don't delete audit_scanned_users rows here. They're orphaned but
 * harmless, and deleting during completion could slow down large audits.
 * If the table grows huge, add a periodic cleanup job later.
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
