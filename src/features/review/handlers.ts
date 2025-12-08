/**
 * Pawtropolis Tech -- src/features/review/handlers.ts
 * WHAT: Barrel file re-exporting review handlers from handlers/ directory.
 * WHY: Maintains backward compatibility while code is organized in subdirectory.
 *
 * NOTE: This file was decomposed into smaller modules in handlers/ directory.
 * All exports are re-exported from handlers/index.ts for backward compatibility.
 *
 * @see handlers/helpers.ts - Helper functions and modal openers
 * @see handlers/actionRunners.ts - Action runner functions (approve/reject/kick)
 * @see handlers/claimHandlers.ts - Claim/unclaim handlers
 * @see handlers/buttons.ts - Button interaction handlers
 * @see handlers/modals.ts - Modal submission handlers
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// Re-export everything from the handlers directory
export {
  // Button handlers
  handleReviewButton,
  handleModmailButton,
  handlePermRejectButton,
  handleCopyUidButton,
  handlePingInUnverified,
  handleDeletePing,
  // Modal handlers
  handleRejectModal,
  handleAcceptModal,
  handlePermRejectModal,
  handleKickModal,
  // Helpers (for internal use by other modules)
  isStaff,
  requireInteractionStaff,
  resolveApplication,
  openRejectModal,
  openAcceptModal,
  openPermRejectModal,
  openKickModal,
  BUTTON_RE,
  MODAL_RE,
  ACCEPT_MODAL_RE,
  // Action runners (for internal use)
  runApproveAction,
  runRejectAction,
  runPermRejectAction,
  runKickAction,
  // Claim handlers (for internal use)
  handleClaimToggle,
  handleUnclaimAction,
} from "./handlers/index.js";
