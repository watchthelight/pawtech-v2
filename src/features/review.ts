/**
 * Pawtropolis Tech -- src/features/review.ts
 * WHAT: Barrel re-export file for the review module.
 * WHY: Maintains backwards compatibility with existing imports.
 *
 * NOTE: All implementation code has been extracted to ./review/ submodules:
 *   - ./review/types.ts - Type definitions
 *   - ./review/claims.ts - Claim functions
 *   - ./review/queries.ts - Database queries
 *   - ./review/flows/ - Transaction and flow functions
 *   - ./review/handlers.ts - Button and modal handlers
 *   - ./review/card.ts - Review card rendering
 *   - ./review/welcome.ts - Welcome message functions
 *
 * DOCS:
 *  - Barrel files: https://basarat.gitbook.io/typescript/main-1/barrel
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { ReviewActionKind } from "./review/types.js";

// ===== Constants =====

// Server-side allowlist for review actions (validation in code, no DB CHECK constraint)
// WHAT: Exhaustive list of permitted actions for review_action table writes.
// NOTE: All actions are tracked in history; no filtering in getRecentActionsForApp
// WHY: Prevents unknown actions from being written; extensible without schema changes.
// FLOWS: Validate before every INSERT; reject unknown actions with clear error message.
export const ALLOWED_ACTIONS = new Set<ReviewActionKind>([
  "approve",
  "reject",
  "need_info",
  "kick",
  "perm_reject",
  "copy_uid",
  "claim",
] as const);

// ===== Re-exports from submodules =====

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
} from "./review/types.js";

// Re-export claims
export {
  CLAIMED_MESSAGE,
  claimGuard,
  getReviewClaim,
  getClaim,
  clearClaim,
} from "./review/claims.js";

// Re-export queries
export {
  getRecentActionsForApp,
  loadApplication,
  findPendingAppByUserId,
  updateReviewActionMeta,
  isClaimable,
} from "./review/queries.js";

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
} from "./review/flows/index.js";

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
} from "./review/handlers.js";

// Re-export card functions
export {
  formatSubmittedFooter,
  renderReviewEmbed,
  buildDecisionComponents,
  ensureReviewMessage,
} from "./review/card.js";

// Re-export welcome functions
export {
  DEFAULT_WELCOME_TEMPLATE,
  renderWelcomeTemplate,
  postWelcomeMessage,
  buildWelcomeNotice,
  logWelcomeFailure,
} from "./review/welcome.js";
