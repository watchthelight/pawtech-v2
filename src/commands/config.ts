/**
 * Pawtropolis Tech — src/commands/config.ts
 * WHAT: Barrel file re-exporting config command modules.
 * WHY: Backward compatibility for buildCommands.ts.
 * SEE: config/ directory for individual handler implementations.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

export { data, execute } from "./config/index.js";
