/**
 * Pawtropolis Tech -- src/commands/modstats/reset.ts
 * WHAT: Reset handler and rate limiting for moderator statistics.
 * WHY: Allows admins to clear corrupted/stale cache with proper security.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { ChatInputCommandInteraction } from "discord.js";
import { logger } from "../../lib/logger.js";

/**
 * In-memory rate limiter for /modstats reset password attempts.
 *
 * SECURITY CONSIDERATIONS:
 * - 30-second cooldown after each failed attempt (per user)
 * - In-memory only - resets on bot restart (acceptable for this use case)
 * - Does NOT persist across shards in multi-process deployments
 *
 * For a distributed deployment, you'd want to use Redis or similar.
 * For a single-process bot, this is sufficient to prevent casual brute-forcing.
 *
 * The cooldown applies even to successful attempts conceptually, but we
 * clear the entry on success (line ~630) to avoid penalizing legitimate use.
 *
 * Memory management:
 * - Entry TTL: 24 hours (cleanup removes stale entries)
 * - Cleanup interval: 1 hour
 */
const resetRateLimiter = new Map<string, number>();
const RESET_RATE_LIMIT_MS = 30000; // 30 seconds
const RESET_COOLDOWN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours - entries expire after this

// Track interval for cleanup on shutdown
let resetRateLimiterInterval: NodeJS.Timeout | null = null;

// Cleanup expired entries every hour
resetRateLimiterInterval = setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamp] of resetRateLimiter) {
    if (now - timestamp > RESET_COOLDOWN_TTL_MS) {
      resetRateLimiter.delete(userId);
    }
  }
}, 60 * 60 * 1000);
resetRateLimiterInterval.unref();

/**
 * Cleanup function for graceful shutdown.
 * Clears the interval and the rate limiter map to prevent memory leaks
 * and allow the process to exit cleanly.
 */
export function cleanupModstatsRateLimiter(): void {
  if (resetRateLimiterInterval) {
    clearInterval(resetRateLimiterInterval);
    resetRateLimiterInterval = null;
  }
  resetRateLimiter.clear();
}

/**
 * WHAT: Handle /modstats reset subcommand.
 * WHY: Allows admins to clear corrupted/stale cache and force recomputation.
 * SECURITY: Password-protected, rate-limited, audit-logged.
 */
export async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const now = Date.now();

  // Check rate limit (per user)
  const lastAttempt = resetRateLimiter.get(userId);
  if (lastAttempt && now - lastAttempt < RESET_RATE_LIMIT_MS) {
    await interaction.editReply({
      content: "❌ Too many attempts. Please wait 30 seconds before trying again.",
    });
    return;
  }

  // Get provided password (never log this value!)
  const providedPassword = interaction.options.getString("password", true);

  // Get expected password from config
  const { RESET_PASSWORD } = await import("../../config.js");

  if (!RESET_PASSWORD) {
    await interaction.editReply({
      content: "❌ Reset not configured. Contact server administrator.",
    });
    logger.warn({ userId }, "[modstats:reset] attempted but RESET_PASSWORD not set");
    return;
  }

  // Constant-time password comparison
  const { secureCompare } = await import("../../lib/secureCompare.js");
  const passwordMatches = secureCompare(providedPassword, RESET_PASSWORD);

  if (!passwordMatches) {
    // Record failed attempt for rate limiting
    resetRateLimiter.set(userId, now);

    await interaction.editReply({
      content: "❌ Unauthorized. Reset password invalid.",
    });

    // Audit log (denied)
    if (interaction.guild) {
      const { postAuditEmbed } = await import("../../features/logger.js");
      await postAuditEmbed(interaction.guild, {
        action: "modstats_reset",
        userId,
        userTag: interaction.user.tag,
        result: "denied",
      });
    }

    logger.warn({ userId, userTag: interaction.user.tag }, "[modstats:reset] unauthorized attempt");
    return;
  }

  // Password correct - proceed with reset
  try {
    const { db } = await import("../../db/db.js");
    const { resetModstats } = await import("../../features/modstats/reset.js");
    const result = await resetModstats(db, logger, {});

    await interaction.editReply({
      content: `✅ **Modstats cache reset complete**\n\n` +
        `• Cache cleared: ${result.cacheDropped ? "Yes" : "No"}\n` +
        `• Guilds affected: ${result.guildsAffected}\n` +
        `• Recomputation: Will occur lazily on next \`/modstats\` call\n\n` +
        `${result.errors && result.errors.length > 0 ? `⚠️ Warnings:\n${result.errors.map(e => `- ${e}`).join('\n')}` : ''}`,
    });

    // Audit log (success)
    if (interaction.guild) {
      const { postAuditEmbed } = await import("../../features/logger.js");
      await postAuditEmbed(interaction.guild, {
        action: "modstats_reset",
        userId,
        userTag: interaction.user.tag,
        result: "success",
        details: `Cache cleared, ${result.guildsAffected} guilds affected`,
      });
    }

    logger.info(
      {
        userId,
        userTag: interaction.user.tag,
        guildId: interaction.guildId,
        guildsAffected: result.guildsAffected,
      },
      "[modstats:reset] cache reset successful"
    );

    // Clear rate limit on successful auth
    resetRateLimiter.delete(userId);
  } catch (err) {
    logger.error({ err, userId }, "[modstats:reset] reset failed");

    await interaction.editReply({
      content: "❌ Reset failed. Check logs for details.",
    });

    // Audit log (error)
    if (interaction.guild) {
      const { postAuditEmbed } = await import("../../features/logger.js");
      await postAuditEmbed(interaction.guild, {
        action: "modstats_reset",
        userId,
        userTag: interaction.user.tag,
        result: "error",
        details: (err as Error).message,
      });
    }
  }
}
