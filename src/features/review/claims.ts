/**
 * Pawtropolis Tech -- src/features/review/claims.ts
 * WHAT: Claim management for review applications.
 * WHY: Centralize claim logic to prevent race conditions and duplicate reviews.
 * FLOWS:
 *  - claimGuard: Check if another moderator has claimed the application
 *  - getClaim/getReviewClaim: Retrieve current claim status
 *  - clearClaim: Release a claim after resolution
 * NOTE: For atomic claim operations, use claimTx() from reviewActions.ts
 * DOCS:
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../../db/db.js";
import type { ReviewClaimRow } from "./types.js";

// ===== Claim Messages =====

export const CLAIMED_MESSAGE = (userId: string) =>
  `This application is claimed by <@${userId}>. Ask them to finish or unclaim it.`;

// ===== Claim Guard =====

/**
 * claimGuard
 * WHAT: Check if a claim exists and belongs to a different moderator.
 * WHY: Prevents stepping on another moderator's active review.
 * @param claim - Current claim row (or null if unclaimed)
 * @param userId - ID of the moderator attempting the action
 * @returns Error message if blocked, null if allowed
 */
export function claimGuard(claim: ReviewClaimRow | null, userId: string): string | null {
  if (claim && claim.reviewer_id !== userId) {
    return CLAIMED_MESSAGE(claim.reviewer_id);
  }
  return null;
}

// ===== Claim Queries =====

/**
 * getReviewClaim
 * WHAT: Fetch the current claim for an application.
 * WHY: Needed for displaying claim status on review cards.
 * @param appId - The application ID
 * @returns Claim row or undefined if unclaimed
 */
export function getReviewClaim(appId: string): ReviewClaimRow | undefined {
  return db
    .prepare("SELECT reviewer_id, claimed_at FROM review_claim WHERE app_id = ? LIMIT 1")
    .get(appId) as ReviewClaimRow | undefined;
}

/**
 * getClaim
 * WHAT: Fetch the current claim for an application (null-safe).
 * WHY: Provides a null return instead of undefined for cleaner conditionals.
 * @param appId - The application ID
 * @returns Claim row or null if unclaimed
 */
export function getClaim(appId: string): ReviewClaimRow | null {
  const row = db
    .prepare(`SELECT reviewer_id, claimed_at FROM review_claim WHERE app_id = ?`)
    .get(appId) as ReviewClaimRow | undefined;
  return row ?? null;
}

// ===== Claim Mutations =====

/**
 * clearClaim
 * WHAT: Remove the claim on an application.
 * WHY: Called after resolution (approve/reject/kick) to free the application.
 * @param appId - The application ID
 */
export function clearClaim(appId: string) {
  db.prepare(`DELETE FROM review_claim WHERE app_id = ?`).run(appId);
}
