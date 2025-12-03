/**
 * Pawtropolis Tech -- src/commands/gate/index.ts
 * WHAT: Barrel file for gate command modules.
 * WHY: Re-exports all gate commands for buildCommands.ts compatibility.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// Main /gate command
// GOTCHA: handleResetModal must be exported here or the modal handler in index.ts won't find it.
// Ask me how I know. (I spent 45 minutes debugging a "modal not found" error.)
export { data, execute, handleResetModal } from "./gateMain.js";

/*
 * Individual action commands
 * WHY separate files: Each action has enough modal handling and validation logic
 * that cramming them all into gateMain.ts would create a 1000-line monster.
 * This way you can actually find the reject logic without ctrl+f.
 */
export { acceptData, executeAccept } from "./accept.js";
export { rejectData, executeReject } from "./reject.js";
export { kickData, executeKick } from "./kick.js";
export { unclaimData, executeUnclaim } from "./unclaim.js";
