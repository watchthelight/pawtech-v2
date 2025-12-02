/**
 * Pawtropolis Tech -- src/features/modmail/threads.ts
 * WHAT: Barrel file re-exporting modmail thread management functions.
 * WHY: Maintains backward compatibility while code is organized in separate modules.
 *
 * NOTE: This file was decomposed into smaller modules:
 * @see threadState.ts - In-memory tracking of open threads
 * @see threadPerms.ts - Permission checks and setup
 * @see threadOpen.ts - Thread opening logic
 * @see threadClose.ts - Thread closing logic
 * @see threadReopen.ts - Thread reopening logic
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// Re-export thread state management
export {
  OPEN_MODMAIL_THREADS,
  hydrateOpenModmailThreadsOnStartup,
  addOpenThread,
  removeOpenThread,
  isOpenModmailThread,
} from "./threadState.js";

// Re-export permission functions
export {
  NEEDED_FOR_PUBLIC_THREAD_FROM_MESSAGE,
  missingPermsForStartThread,
  ensureModsCanSpeakInThread,
  ensureParentPermsForMods,
  retrofitModmailParentsForGuild,
  retrofitAllGuildsOnStartup,
} from "./threadPerms.js";

// Re-export thread open function
export { openPublicModmailThreadFor } from "./threadOpen.js";

// Re-export thread close functions
export { closeModmailThread, closeModmailForApplication } from "./threadClose.js";

// Re-export thread reopen function
export { reopenModmailThread } from "./threadReopen.js";
