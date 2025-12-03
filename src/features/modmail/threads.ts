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

/*
 * GOTCHA: If you're looking for the actual implementation, you're in the wrong file.
 * This is just the facade. The real logic is scattered across 5 other files because
 * someone (correctly) decided 800 lines in one file was a war crime.
 * Import from here, not the individual modules - saves you from caring when things move around.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// Re-export thread state management
// WHY in-memory? Because querying the DB every time a message arrives
// would make Discord's rate limits look like a suggestion rather than a threat.
export {
  OPEN_MODMAIL_THREADS,
  hydrateOpenModmailThreadsOnStartup,
  addOpenThread,
  removeOpenThread,
  isOpenModmailThread,
} from "./threadState.js";

// Re-export permission functions
// Discord thread permissions are a special kind of hell. These functions exist
// because "inherit from parent" means something different every other Tuesday.
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
// Two ways to close: by thread, or by application. The application route exists
// because sometimes users get rejected and you need to clean up their mess automatically.
export { closeModmailThread, closeModmailForApplication } from "./threadClose.js";

// Re-export thread reopen function
// For when someone closes a thread and immediately realizes they had one more thing to say.
export { reopenModmailThread } from "./threadReopen.js";
