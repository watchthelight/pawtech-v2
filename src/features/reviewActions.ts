/**
 * Pawtropolis Tech — src/features/reviewActions.ts
 * WHAT: Atomic claim/unclaim transactions for application review system
 * WHY: Eliminate race conditions in multi-moderator environments
 * FLOWS:
 *  - claimTx() - Atomic claim with optimistic locking
 *  - unclaimTx() - Atomic unclaim with ownership validation
 * USAGE:
 *  import { claimTx, unclaimTx } from "./reviewActions.js";
 *  try {
 *    claimTx(appId, moderatorId, guildId);
 *    // ... do work
 *  } catch (err) {
 *    if (err.code === 'ALREADY_CLAIMED') { ... }
 *  }
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { nowUtc } from "../lib/time.js";
import { isPanicMode } from "./panicStore.js";
import type { ReviewClaimRow } from "./review/types.js";

// Re-export for backward compatibility
export type { ReviewClaimRow };

/**
 * ClaimError - Typed errors for claim/unclaim operations
 */
export class ClaimError extends Error {
  constructor(
    message: string,
    public code: "ALREADY_CLAIMED" | "NOT_CLAIMED" | "NOT_OWNER" | "APP_NOT_FOUND" | "INVALID_STATUS"
  ) {
    super(message);
    this.name = "ClaimError";
  }
}

/**
 * claimTx
 * WHAT: Atomically claim an application for review
 * WHY: Prevents race conditions where two moderators claim the same app
 * PARAMS:
 *  - appId: Application ID to claim
 *  - moderatorId: Moderator user ID performing claim
 *  - guildId: Guild ID for validation
 * RETURNS: void (throws ClaimError on failure)
 * THROWS:
 *  - ClaimError('ALREADY_CLAIMED') if app already claimed by another moderator
 *  - ClaimError('APP_NOT_FOUND') if app doesn't exist
 *  - ClaimError('INVALID_STATUS') if app is in terminal state
 */
// Core atomic claim. Wrapped in db.transaction() for SQLite's serializable isolation.
// The transaction ensures: check -> insert -> audit all happen atomically.
// If two moderators call this simultaneously, one will win and the other gets ALREADY_CLAIMED.
export function claimTx(appId: string, moderatorId: string, guildId: string): void {
  // Panic mode check - block all claim operations during emergencies
  if (isPanicMode(guildId)) {
    logger.warn({ appId, moderatorId, guildId }, "[reviewActions] claimTx blocked - panic mode active");
    throw new ClaimError("Panic mode is active. All review operations are suspended.", "INVALID_STATUS");
  }

  return db.transaction(() => {
    logger.debug({ appId, moderatorId, guildId }, "[reviewActions] claimTx started");

    // Validate application exists and is claimable
    const app = db
      .prepare("SELECT id, guild_id, status FROM application WHERE id = ? AND guild_id = ?")
      .get(appId, guildId) as { id: string; guild_id: string; status: string } | undefined;

    if (!app) {
      logger.warn({ appId, guildId }, "[reviewActions] claimTx: app not found");
      throw new ClaimError("Application not found", "APP_NOT_FOUND");
    }

    // Check if app is in terminal state
    const terminalStatuses = ["approved", "rejected", "kicked"];
    if (terminalStatuses.includes(app.status)) {
      logger.warn({ appId, status: app.status }, "[reviewActions] claimTx: app in terminal state");
      throw new ClaimError(`Application already ${app.status}`, "INVALID_STATUS");
    }

    // Check for existing claim (optimistic locking)
    // Note: This is not SELECT FOR UPDATE - SQLite doesn't support row-level locks.
    // The transaction isolation handles concurrent access instead.
    const existingClaim = db
      .prepare("SELECT reviewer_id FROM review_claim WHERE app_id = ?")
      .get(appId) as { reviewer_id: string } | undefined;

    if (existingClaim) {
      // Allow re-claim by same moderator (idempotent)
      // This handles double-click scenarios gracefully.
      if (existingClaim.reviewer_id === moderatorId) {
        logger.debug({ appId, moderatorId }, "[reviewActions] claimTx: already claimed by same moderator (idempotent)");
        return;
      }

      // Different moderator already claimed
      logger.warn(
        { appId, existingReviewer: existingClaim.reviewer_id, newReviewer: moderatorId },
        "[reviewActions] claimTx: already claimed by different moderator"
      );
      throw new ClaimError("Application already claimed by another moderator", "ALREADY_CLAIMED");
    }

    // Capture timestamp once for both claim record and audit log
    // nowUtc() returns Unix epoch seconds (INTEGER), matching both table schemas
    const timestamp = nowUtc();

    db.prepare(
      "INSERT INTO review_claim (app_id, reviewer_id, claimed_at) VALUES (?, ?, ?)"
    ).run(appId, moderatorId, timestamp);

    // Insert into review_action for audit trail (inside same transaction for atomicity)
    db.prepare(
      "INSERT INTO review_action (app_id, moderator_id, action, created_at) VALUES (?, ?, 'claim', ?)"
    ).run(appId, moderatorId, timestamp);

    logger.info(
      { appId, moderatorId, guildId, timestamp },
      "[reviewActions] claimTx: application claimed successfully"
    );
  })();
}

/**
 * unclaimTx
 * WHAT: Atomically release a claimed application back to queue
 * WHY: Allows moderators to return applications they can't process
 * PARAMS:
 *  - appId: Application ID to unclaim
 *  - moderatorId: Moderator user ID performing unclaim
 *  - guildId: Guild ID for validation
 * RETURNS: void (throws ClaimError on failure)
 * THROWS:
 *  - ClaimError('NOT_CLAIMED') if app is not claimed
 *  - ClaimError('NOT_OWNER') if app claimed by different moderator
 *  - ClaimError('APP_NOT_FOUND') if app doesn't exist
 */
export function unclaimTx(appId: string, moderatorId: string, guildId: string): void {
  // Panic mode check - block all unclaim operations during emergencies
  if (isPanicMode(guildId)) {
    logger.warn({ appId, moderatorId, guildId }, "[reviewActions] unclaimTx blocked - panic mode active");
    throw new ClaimError("Panic mode is active. All review operations are suspended.", "INVALID_STATUS");
  }

  return db.transaction(() => {
    logger.debug({ appId, moderatorId, guildId }, "[reviewActions] unclaimTx started");

    // Validate application exists
    const app = db
      .prepare("SELECT id, guild_id, status FROM application WHERE id = ? AND guild_id = ?")
      .get(appId, guildId) as { id: string; guild_id: string; status: string } | undefined;

    if (!app) {
      logger.warn({ appId, guildId }, "[reviewActions] unclaimTx: app not found");
      throw new ClaimError("Application not found", "APP_NOT_FOUND");
    }

    // Check if application is claimed
    const claim = db
      .prepare("SELECT reviewer_id FROM review_claim WHERE app_id = ?")
      .get(appId) as { reviewer_id: string } | undefined;

    if (!claim) {
      logger.warn({ appId }, "[reviewActions] unclaimTx: app not claimed");
      throw new ClaimError("Application is not claimed", "NOT_CLAIMED");
    }

    // Validate ownership
    if (claim.reviewer_id !== moderatorId) {
      logger.warn(
        { appId, claimOwner: claim.reviewer_id, requestor: moderatorId },
        "[reviewActions] unclaimTx: not claim owner"
      );
      throw new ClaimError("You did not claim this application", "NOT_OWNER");
    }

    // Capture timestamp before deleting claim (for audit log)
    const timestamp = nowUtc();

    // Remove claim
    db.prepare("DELETE FROM review_claim WHERE app_id = ?").run(appId);

    // Insert into review_action for audit trail (inside same transaction for atomicity)
    db.prepare(
      "INSERT INTO review_action (app_id, moderator_id, action, created_at) VALUES (?, ?, 'unclaim', ?)"
    ).run(appId, moderatorId, timestamp);

    logger.info(
      { appId, moderatorId, guildId },
      "[reviewActions] unclaimTx: application unclaimed successfully"
    );
  })();
}

/**
 * getClaim
 * WHAT: Retrieve current claim for an application (non-transactional read)
 * WHY: Check claim status without acquiring locks
 * PARAMS:
 *  - appId: Application ID
 * RETURNS: ReviewClaimRow or null if not claimed
 */
export function getClaim(appId: string): ReviewClaimRow | null {
  const row = db
    .prepare("SELECT app_id, reviewer_id, claimed_at FROM review_claim WHERE app_id = ?")
    .get(appId) as ReviewClaimRow | undefined;

  return row || null;
}

/**
 * clearClaim
 * WHAT: Force-remove a claim without ownership validation (admin function)
 * WHY: Allow admins to reset stuck claims
 * PARAMS:
 *  - appId: Application ID
 * RETURNS: boolean - true if claim was removed, false if no claim existed
 * WARNING: This bypasses ownership checks. Use with caution.
 */
export function clearClaim(appId: string): boolean {
  const result = db.prepare("DELETE FROM review_claim WHERE app_id = ?").run(appId);

  if (result.changes > 0) {
    logger.info({ appId, changes: result.changes }, "[reviewActions] clearClaim: claim removed (admin override)");
    return true;
  }

  logger.debug({ appId }, "[reviewActions] clearClaim: no claim to remove");
  return false;
}

/**
 * claimGuard
 * WHAT: Validate claim ownership for user actions
 * WHY: Reusable guard for button interactions and slash commands
 * PARAMS:
 *  - claim: Current claim record (or null if unclaimed)
 *  - userId: User ID attempting action
 * RETURNS: Error message string or null if authorized
 * USAGE:
 *  const errorMsg = claimGuard(claim, interaction.user.id);
 *  if (errorMsg) return interaction.reply({ content: errorMsg, ephemeral: true });
 */
// Guard function for button handlers. Returns error message if user can't act, null if authorized.
// Usage pattern: const err = claimGuard(claim, user.id); if (err) return reply(err);
// Returns user-facing Discord markdown - the <@id> syntax renders as a clickable mention.
export function claimGuard(claim: ReviewClaimRow | null, userId: string): string | null {
  if (!claim) {
    return "❌ This application is not claimed. Use the **Claim Application** button first.";
  }

  if (claim.reviewer_id !== userId) {
    return `❌ This application is claimed by <@${claim.reviewer_id}>. You cannot modify it.`;
  }

  return null;
}
