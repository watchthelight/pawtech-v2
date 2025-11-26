// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/features/panicStore.ts
 * WHAT: In-memory panic state for role automation emergency shutoff
 * WHY: Instant kill switch for role rewards during testing/emergencies
 * FLOWS:
 *  - /panic → setPanicMode(guildId, true) → all role automation stops
 *  - /panic off → setPanicMode(guildId, false) → resume normal operation
 */

import { logger } from "../lib/logger.js";

// In-memory store for instant response (no DB delay)
const panicState = new Map<string, boolean>();

/**
 * Check if panic mode is active for a guild
 */
export function isPanicMode(guildId: string): boolean {
  return panicState.get(guildId) ?? false;
}

/**
 * Set panic mode for a guild
 */
export function setPanicMode(guildId: string, enabled: boolean): void {
  panicState.set(guildId, enabled);
  logger.warn({
    evt: enabled ? "panic_enabled" : "panic_disabled",
    guildId,
  }, `Role automation panic mode ${enabled ? "ENABLED" : "disabled"}`);
}

/**
 * Get all guilds currently in panic mode
 */
export function getPanicGuilds(): string[] {
  return Array.from(panicState.entries())
    .filter(([_, enabled]) => enabled)
    .map(([guildId]) => guildId);
}
