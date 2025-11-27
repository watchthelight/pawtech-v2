/**
 * Pawtropolis Tech -- src/features/review/index.ts
 * WHAT: Barrel file for review module - re-exports all public APIs.
 * WHY: Maintains backwards compatibility with existing imports from "./features/review.js"
 * DOCS: https://basarat.gitbook.io/typescript/main-1/barrel
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// Re-export types
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
  upsertClaim,
  clearClaim,
} from "./claims.js";

// Re-export flows
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

// Note: ALLOWED_ACTIONS is defined in ../review.ts and re-exports from here
// Import it from the parent module to avoid circular dependencies:
// import { ALLOWED_ACTIONS } from "../review.js";
