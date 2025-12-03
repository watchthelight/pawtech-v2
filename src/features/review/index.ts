/**
 * Pawtropolis Tech -- src/features/review/index.ts
 * WHAT: Barrel file for review module - re-exports all public APIs.
 * WHY: Maintains backwards compatibility with existing imports from "./features/review.js"
 * DOCS: https://basarat.gitbook.io/typescript/main-1/barrel
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// Re-export types
// WHY: Using `export type` to make it crystal clear these are types-only.
// This helps bundlers tree-shake properly and prevents "this import is a type" errors.
export type {
  ApplicationStatus,
  ApplicationRow,
  ReviewAnswer,
  ReviewActionMeta,
  ReviewActionKind,
  ReviewActionSnapshot,
  ReviewClaimRow,
  ReviewCardApplication,
  ReviewCardRow,
  AvatarScanRow,
  TxResult,
  ReviewStaffInteraction,
  ReviewActionInteraction,
  ApproveFlowResult,
  WelcomeFailureReason,
  WelcomeResult,
  RenderWelcomeTemplateOptions,
} from "./types.js";

// Re-export queries
// GOTCHA: isClaimable is a read-only check - it does NOT acquire the claim.
// If you call isClaimable then try to act, someone else could claim in between.
// Use claimGuard from ./claims.js for atomic check-and-claim.
export {
  getRecentActionsForApp,
  loadApplication,
  findPendingAppByUserId,
  updateReviewActionMeta,
  isClaimable,
  type RecentAction,
} from "./queries.js";

// Re-export claims
export {
  CLAIMED_MESSAGE,
  claimGuard,
  getReviewClaim,
  getClaim,
  clearClaim,
} from "./claims.js";

// Re-export flows
/*
 * The *Tx functions are database transactions only - they update state but don't
 * touch Discord. The *Flow functions do the full dance: claim check, DB update,
 * Discord API calls, DM delivery, the works.
 *
 * If you call approveTx but not the full flow, you'll have a database that says
 * "approved" but a user who's still sitting in limbo wondering why nothing happened.
 */
export {
  // Transaction functions
  approveTx,
  rejectTx,
  kickTx,
  // Flow functions
  approveFlow,
  deliverApprovalDm,
  rejectFlow,
  kickFlow,
} from "./flows/index.js";

// Re-export handlers
// These are the Discord interaction handlers. They get wired up in the event router.
// If you add a new button/modal, you'll need to add its handler here AND register it.
export {
  handleReviewButton,
  handleRejectModal,
  handleAcceptModal,
  handleModmailButton,
  handlePermRejectButton,
  handlePermRejectModal,
  handleCopyUidButton,
  handlePingInUnverified,
  handleDeletePing,
} from "./handlers.js";

// Re-export card functions (newly extracted)
export {
  formatSubmittedFooter,
  renderReviewEmbed,
  buildDecisionComponents,
  ensureReviewMessage,
} from "./card.js";

// Re-export welcome functions (newly extracted)
export {
  DEFAULT_WELCOME_TEMPLATE,
  renderWelcomeTemplate,
  postWelcomeMessage,
  buildWelcomeNotice,
  logWelcomeFailure,
} from "./welcome.js";

/*
 * Note: ALLOWED_ACTIONS is defined in ../review.ts and re-exports from here.
 * Import it from the parent module to avoid circular dependencies:
 *   import { ALLOWED_ACTIONS } from "../review.js";
 *
 * Yes, the circular dependency situation is annoying. No, I don't have a better
 * solution that doesn't involve restructuring half the codebase. We live with it.
 */
