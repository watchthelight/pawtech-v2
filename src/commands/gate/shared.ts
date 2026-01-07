/**
 * Pawtropolis Tech -- src/commands/gate/shared.ts
 * WHAT: Shared imports and utilities for gate-related commands.
 * WHY: Avoids duplication across accept, reject, kick, unclaim commands.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// Re-export commonly used functions and types
export {
  requireStaff,
  requireGatekeeper,
  getConfig,
  hasRoleOrAbove,
  ROLE_IDS,
  shouldBypass,
} from "../../lib/config.js";

export {
  findAppByShortCode,
} from "../../features/appLookup.js";

export {
  findPendingAppByUserId,
  ensureReviewMessage,
  approveTx,
  approveFlow,
  deliverApprovalDm,
  updateReviewActionMeta,
  kickTx,
  kickFlow,
  rejectTx,
  rejectFlow,
  getClaim,
  clearClaim,
  claimGuard,
  CLAIMED_MESSAGE,
  type ApplicationRow,
} from "../../features/review.js";

export {
  postWelcomeCard,
} from "../../features/welcome.js";

export {
  closeModmailForApplication,
} from "../../features/modmail.js";

export {
  type CommandContext,
  ensureDeferred,
  replyOrEdit,
} from "../../lib/cmdWrap.js";

export { shortCode } from "../../lib/ids.js";
export { logger } from "../../lib/logger.js";
export type { GuildMember } from "discord.js";
