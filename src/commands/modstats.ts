/**
 * Pawtropolis Tech -- src/commands/modstats.ts
 * WHAT: Barrel file re-exporting modstats command from modstats/ directory.
 * WHY: Maintains backward compatibility while code is organized in subdirectory.
 *
 * NOTE: This file was decomposed into smaller modules in modstats/ directory:
 * @see modstats/index.ts - Command definition and execute router
 * @see modstats/helpers.ts - Time formatting and database query utilities
 * @see modstats/leaderboard.ts - Leaderboard and export handlers
 * @see modstats/userStats.ts - Individual moderator statistics
 * @see modstats/reset.ts - Reset handler with rate limiting
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// Re-export everything from the modstats directory
export { data, execute, cleanupModstatsRateLimiter } from "./modstats/index.js";
