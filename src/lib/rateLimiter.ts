/**
 * Pawtropolis Tech — src/lib/rateLimiter.ts
 * WHAT: Simple in-memory rate limiter for expensive command operations.
 * WHY: Prevents abuse of resource-intensive commands like /audit and /database.
 * FLOWS:
 *   - checkCooldown(): Check if command can run, return remaining time if blocked
 *   - clearCooldown(): Manually clear a cooldown (for admin override)
 * DOCS:
 *   - CWE-770: https://cwe.mitre.org/data/definitions/770.html
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { logger } from "./logger.js";

// Map of command name -> Map of scope (userId or guildId) -> last used timestamp
const cooldowns = new Map<string, Map<string, number>>();

// Cleanup interval to prevent unbounded memory growth
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_COOLDOWN_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Check if a command is on cooldown for a given scope.
 *
 * @param commandName - Name of the command (e.g., "audit:nsfw")
 * @param scopeId - User ID or Guild ID depending on scope type
 * @param cooldownMs - Cooldown duration in milliseconds
 * @returns Object with allowed (boolean) and remainingMs (if blocked)
 *
 * @example
 * const result = checkCooldown("audit:nsfw", guildId, 60 * 60 * 1000); // 1 hour
 * if (!result.allowed) {
 *   await interaction.reply(`Please wait ${Math.ceil(result.remainingMs! / 60000)} minutes.`);
 *   return;
 * }
 */
export function checkCooldown(
  commandName: string,
  scopeId: string,
  cooldownMs: number
): { allowed: boolean; remainingMs?: number } {
  const now = Date.now();
  const scopeCooldowns = cooldowns.get(commandName) ?? new Map<string, number>();
  const lastUsed = scopeCooldowns.get(scopeId) ?? 0;

  const elapsed = now - lastUsed;
  if (elapsed < cooldownMs) {
    const remainingMs = cooldownMs - elapsed;
    logger.debug(
      { commandName, scopeId, remainingMs },
      "[rateLimiter] Command on cooldown"
    );
    return { allowed: false, remainingMs };
  }

  // Update last used timestamp
  scopeCooldowns.set(scopeId, now);
  cooldowns.set(commandName, scopeCooldowns);

  return { allowed: true };
}

/**
 * Clear a cooldown for a specific command and scope.
 * Useful for admin overrides or testing.
 */
export function clearCooldown(commandName: string, scopeId: string): void {
  const scopeCooldowns = cooldowns.get(commandName);
  if (scopeCooldowns) {
    scopeCooldowns.delete(scopeId);
    logger.debug({ commandName, scopeId }, "[rateLimiter] Cooldown cleared");
  }
}

/**
 * Format remaining cooldown time as human-readable string.
 */
export function formatCooldown(remainingMs: number): string {
  const seconds = Math.ceil(remainingMs / 1000);
  if (seconds < 60) {
    return `${seconds} seconds`;
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (remainingMins === 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${hours}h ${remainingMins}m`;
}

// Periodic cleanup of old cooldown entries
function cleanupOldCooldowns(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [commandName, scopeCooldowns] of cooldowns) {
    for (const [scopeId, timestamp] of scopeCooldowns) {
      if (now - timestamp > MAX_COOLDOWN_AGE_MS) {
        scopeCooldowns.delete(scopeId);
        cleaned++;
      }
    }
    // Remove empty command maps
    if (scopeCooldowns.size === 0) {
      cooldowns.delete(commandName);
    }
  }

  if (cleaned > 0) {
    logger.debug({ cleaned }, "[rateLimiter] Cleaned up old cooldown entries");
  }
}

// Start cleanup interval
setInterval(cleanupOldCooldowns, CLEANUP_INTERVAL_MS);

// Export cooldown constants for commands to use
export const COOLDOWNS = {
  /** NSFW audit: 1 hour per guild (expensive API calls) */
  AUDIT_NSFW_MS: 60 * 60 * 1000,
  /** Members audit: 1 hour per guild (scans all members) */
  AUDIT_MEMBERS_MS: 60 * 60 * 1000,
  /** Database check: 5 minutes per user */
  DATABASE_CHECK_MS: 5 * 60 * 1000,
  /** Sync commands: 10 minutes per guild */
  SYNC_MS: 10 * 60 * 1000,
} as const;
