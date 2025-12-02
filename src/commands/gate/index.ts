/**
 * Pawtropolis Tech -- src/commands/gate/index.ts
 * WHAT: Barrel file for gate command modules.
 * WHY: Re-exports all gate commands for buildCommands.ts compatibility.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// Main /gate command
export { data, execute, handleResetModal } from "./gateMain.js";

// Individual action commands
export { acceptData, executeAccept } from "./accept.js";
export { rejectData, executeReject } from "./reject.js";
export { kickData, executeKick } from "./kick.js";
export { unclaimData, executeUnclaim } from "./unclaim.js";
