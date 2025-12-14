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
// GOTCHA: This is module-level state - hot-reloads in dev will reset all cooldowns.
// Users will absolutely notice and exploit this if they figure it out.
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
  // Defaulting to 0 means "last used at the Unix epoch" which is always older than
  // any reasonable cooldown. Slightly clever, mostly confusing on first read.
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

  /*
   * Update last used timestamp BEFORE returning.
   * This is intentional - we set the timestamp even if the caller never actually
   * runs the command. The alternative (caller calls "recordUsage" after success)
   * would require trusting every caller to remember. They won't.
   */
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
// WHY Math.ceil everywhere: Telling users "0 seconds remaining" when there's 900ms
// left just makes them spam retry. Round up and let them wait an extra second.
export function formatCooldown(remainingMs: number): string {
  const seconds = Math.ceil(remainingMs / 1000);
  if (seconds < 60) {
    return `${seconds} seconds`;
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  // Switch to floor() for hours because "2 hours" when there's 1h 59m left feels wrong
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (remainingMins === 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${hours}h ${remainingMins}m`;
}

/*
 * Periodic cleanup of old cooldown entries.
 * Without this, a bot running for months would slowly accumulate dead entries
 * from users who ran a command once and never came back. Memory death by
 * a thousand paper cuts.
 */
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
// GOTCHA: This interval is never cleared, so this module can't be cleanly unloaded.
// Fine for production, annoying for tests. If tests start hanging, this is why.
setInterval(cleanupOldCooldowns, CLEANUP_INTERVAL_MS);

/*
 * Export cooldown constants for commands to use.
 * These values are somewhat arbitrary but based on operational experience:
 * - 1 hour for audits = long enough that spamming is painful, short enough
 *   that legitimate re-runs aren't blocked for too long
 * - 5 min for database = quick checks are fine, prevents refresh spam
 * - 10 min for sync = Discord's global rate limit is stricter anyway
 */
export const COOLDOWNS = {
  /** NSFW audit: 1 hour per guild (expensive API calls) */
  AUDIT_NSFW_MS: 60 * 60 * 1000,
  /** Members audit: 1 hour per guild (scans all members) */
  AUDIT_MEMBERS_MS: 60 * 60 * 1000,
  /** Database check: 5 minutes per user */
  DATABASE_CHECK_MS: 5 * 60 * 1000,
  /** Sync commands: 10 minutes per guild */
  SYNC_MS: 10 * 60 * 1000,
  /** Avatar NSFW scan: 1 hour per user (prevents API abuse via rapid avatar changes) */
  AVATAR_SCAN_MS: 60 * 60 * 1000,
  /** Backfill: 30 minutes per guild (expensive background process) */
  BACKFILL_MS: 30 * 60 * 1000,
  /** Purge: 5 minutes per user-guild (destructive operation) */
  PURGE_MS: 5 * 60 * 1000,
  /** Flag: 15 seconds per user (prevents spam flagging) */
  FLAG_MS: 15 * 1000,
  /** Password failure: 30 seconds lockout per user (brute force protection) */
  PASSWORD_FAIL_MS: 30 * 1000,
} as const;
