/**
 * Pawtropolis Tech -- src/features/modmail/index.ts
 * WHAT: Barrel file for modmail module - re-exports all public APIs.
 * WHY: Maintains backwards compatibility with existing imports from "./features/modmail.js"
 * DOCS: https://basarat.gitbook.io/typescript/main-1/barrel
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// Re-export types
export type {
  ModmailTicketStatus,
  ModmailTicket,
  TranscriptLine,
  ModmailMessageMap,
  StaffToUserEmbedArgs,
  UserToStaffEmbedArgs,
  OpenPublicModmailThreadParams,
  CloseModmailThreadParams,
  ReopenModmailThreadParams,
} from "./types.js";

// Re-export tickets
export {
  createTicket,
  getOpenTicketByUser,
  getTicketByThread,
  getTicketById,
  findModmailTicketForApplication,
  updateTicketThread,
  closeTicket,
  reopenTicket,
  insertModmailMessage,
  getThreadIdForDmReply,
  getDmIdForThreadReply,
} from "./tickets.js";

// Re-export transcript functions
export {
  appendTranscript,
  getTranscriptBuffer,
  clearTranscriptBuffer,
  formatTranscript,
  formatContentWithAttachments,
  flushTranscript,
} from "./transcript.js";

// Re-export routing functions
export {
  // Embed builders
  buildStaffToUserEmbed,
  buildUserToStaffEmbed,
  // Message forwarding tracking
  isForwarded,
  markForwarded,
  // Routing
  routeThreadToDm,
  routeDmToThread,
  // Inbound message handlers
  handleInboundDmForModmail,
  handleInboundThreadMessageForModmail,
} from "./routing.js";

// Re-export thread operations
export {
  // Constants
  OPEN_MODMAIL_THREADS,
  // Startup/hydration
  hydrateOpenModmailThreadsOnStartup,
  retrofitAllGuildsOnStartup,
  retrofitModmailParentsForGuild,
  ensureParentPermsForMods,
  // Thread operations
  openPublicModmailThreadFor,
  closeModmailThread,
  reopenModmailThread,
  closeModmailForApplication,
} from "./threads.js";

// Re-export handlers (button, context menu)
export {
  handleModmailOpenButton,
  handleModmailCloseButton,
  handleModmailContextMenu,
} from "./handlers.js";

// Re-export commands
export {
  modmailCommand,
  executeModmailCommand,
  modmailContextMenu,
} from "./commands.js";

// Note: The parent modmail.ts now re-exports from this index file.
// Import from either "../modmail.js" or "./modmail/index.js" for the same API.
