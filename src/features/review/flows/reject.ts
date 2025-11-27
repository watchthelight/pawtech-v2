/**
 * Pawtropolis Tech -- src/features/review/flows/reject.ts
 * WHAT: Rejection transaction and flow logic for application review.
 * WHY: Handles standard and permanent rejections with DM notification.
 * FLOWS:
 *  - rejectTx: Database transaction to mark application as rejected
 *  - rejectFlow: Discord-side DM notification to applicant
 * DOCS:
 *  - User.send: https://discord.js.org/#/docs/discord.js/main/class/User?scrollTo=send
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { User } from "discord.js";
import { db } from "../../../db/db.js";
import { logger } from "../../../lib/logger.js";
import { nowUtc } from "../../../lib/time.js";
import type { ApplicationRow, TxResult } from "../types.js";

// ===== Constants =====

const FLOW_TIMEOUT_MS = 30000;

// ===== Helpers =====

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

// ===== Transaction =====

/**
 * rejectTx
 * WHAT: Database transaction to reject an application.
 * WHY: Atomic update with optional permanent rejection flag.
 * NOTE: permanent=true sets `permanently_rejected=1` which blocks future applications.
 * @param appId - Application ID
 * @param moderatorId - Moderator performing the action
 * @param reason - Rejection reason (required)
 * @param permanent - If true, blocks future applications from this user
 * @returns TxResult indicating success or current state
 */
export function rejectTx(
  appId: string,
  moderatorId: string,
  reason: string,
  permanent = false
): TxResult {
  return db.transaction(() => {
    const row = db.prepare(`SELECT status FROM application WHERE id = ?`).get(appId) as
      | { status: ApplicationRow["status"] }
      | undefined;
    if (!row) throw new Error("Application not found");
    if (row.status === "rejected") return { kind: "already" as const, status: row.status };
    if (row.status === "approved" || row.status === "kicked") {
      return { kind: "terminal" as const, status: row.status };
    }
    if (row.status === "draft") {
      return { kind: "invalid" as const, status: row.status };
    }
    // Insert a snapshot row for moderation audit trail.
    // Table: review_action(app_id, moderator_id, action, created_at, reason, meta)
    // Reason is free text; meta is JSON for per-flow flags.
    const action = permanent ? "perm_reject" : "reject";
    const insert = db
      .prepare(
        `
        INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, meta)
        VALUES (?, ?, ?, ?, ?, NULL)
      `
      )
      .run(appId, moderatorId, action, nowUtc(), reason);
    // Mark the application terminal state and resolver in application table.
    db.prepare(
      `
      UPDATE application
      SET status = 'rejected',
          updated_at = datetime('now'),
          resolved_at = datetime('now'),
          resolver_id = ?,
          resolution_reason = ?,
          permanently_rejected = ?,
          permanent_reject_at = CASE WHEN ? = 1 THEN datetime('now') ELSE permanent_reject_at END
      WHERE id = ?
    `
    ).run(moderatorId, reason, permanent ? 1 : 0, permanent ? 1 : 0, appId);
    return { kind: "changed" as const, reviewActionId: Number(insert.lastInsertRowid) };
  })();
}

// ===== Flow =====

/**
 * rejectFlow
 * WHAT: Sends rejection DM to the applicant.
 * WHY: Provides feedback about why their application was not approved.
 * NOTE: DM delivery is best-effort; failure does not block the rejection.
 * @param user - Discord User to notify
 * @param options - Contains guildName, reason, and optional permanent flag
 * @returns Object with dmDelivered boolean
 */
export async function rejectFlow(
  user: User,
  options: { guildName: string; reason: string; permanent?: boolean }
) {
  // DM might fail. we tried.
  const result = { dmDelivered: false };
  const lines = options.permanent
    ? [
        `You've been permanently rejected from **${options.guildName}** and cannot apply again. Thanks for stopping by.`,
      ]
    : [
        `Hello, thanks for applying to ${options.guildName}. The moderation team was not able to approve this application. You can submit a new one anytime!`,
        `Reason: ${options.reason}.`,
      ];
  try {
    // DM can fail; we record dmDelivered=false and continue moderation flow.
    await withTimeout(
      user.send({ content: lines.join("\n") }),
      FLOW_TIMEOUT_MS,
      "rejectFlow:sendDm"
    );
    result.dmDelivered = true;
  } catch (err) {
    logger.warn({ err, userId: user.id }, "Failed to DM applicant about rejection");
  }
  return result;
}
