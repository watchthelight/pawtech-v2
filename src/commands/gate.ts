/**
 * Pawtropolis Tech — src/commands/gate.ts
 * WHAT: Barrel file re-exporting gate command modules.
 * WHY: Backward compatibility for buildCommands.ts.
 * SEE: gate/ directory for individual command implementations.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

export {
  // Main /gate command
  data,
  execute,
  handleResetModal,
  // Individual action commands
  acceptData,
  executeAccept,
  rejectData,
  executeReject,
  kickData,
  executeKick,
  unclaimData,
  executeUnclaim,
} from "./gate/index.js";
