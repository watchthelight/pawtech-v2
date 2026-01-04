/**
 * Pawtropolis Tech -- src/commands/stats/reset.ts
 * WHAT: Handler for /stats reset - clear and rebuild statistics.
 * WHY: Allows admins to clear corrupted/stale cache with proper security.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  logger,
  requireMinRole,
  ROLE_IDS,
} from "./shared.js";

/**
 * In-memory rate limiter for /stats reset password attempts.
 * 30-second cooldown after each failed attempt (per user).
 */
const resetRateLimiter = new Map<string, number>();
const RESET_RATE_LIMIT_MS = 30000;
const RESET_COOLDOWN_TTL_MS = 24 * 60 * 60 * 1000;

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
 */
export function cleanupStatsRateLimiter(): void {
  if (resetRateLimiterInterval) {
    clearInterval(resetRateLimiterInterval);
    resetRateLimiterInterval = null;
  }
  resetRateLimiter.clear();
}

/**
 * Handle /stats reset subcommand.
 * Clears and rebuilds moderator statistics (password required).
 */
export async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
  // Require Senior Administrator+
  if (!requireMinRole(interaction, ROLE_IDS.SENIOR_ADMIN, {
    command: "stats reset",
    description: "Resets moderator statistics.",
    requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.SENIOR_ADMIN }],
  })) return;

  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const now = Date.now();

  // Check rate limit
  const lastAttempt = resetRateLimiter.get(userId);
  if (lastAttempt && now - lastAttempt < RESET_RATE_LIMIT_MS) {
    await interaction.editReply({
      content: "Too many attempts. Please wait 30 seconds before trying again.",
    });
    return;
  }

  const providedPassword = interaction.options.getString("password", true);

  const { RESET_PASSWORD } = await import("../../config.js");

  if (!RESET_PASSWORD) {
    await interaction.editReply({
      content: "Reset not configured. Contact server administrator.",
    });
    logger.warn({ userId }, "[stats:reset] attempted but RESET_PASSWORD not set");
    return;
  }

  const { secureCompare } = await import("../../lib/secureCompare.js");
  const passwordMatches = secureCompare(providedPassword, RESET_PASSWORD);

  if (!passwordMatches) {
    resetRateLimiter.set(userId, now);

    await interaction.editReply({
      content: "Unauthorized. Reset password invalid.",
    });

    if (interaction.guild) {
      const { postAuditEmbed } = await import("../../features/logger.js");
      await postAuditEmbed(interaction.guild, {
        action: "stats_reset",
        userId,
        userTag: interaction.user.tag,
        result: "denied",
      });
    }

    logger.warn({ userId, userTag: interaction.user.tag }, "[stats:reset] unauthorized attempt");
    return;
  }

  try {
    const { db } = await import("../../db/db.js");
    const { resetModstats } = await import("../../features/modstats/reset.js");
    const result = await resetModstats(db, logger, {});

    await interaction.editReply({
      content: `**Modstats cache reset complete**\n\n` +
        `- Cache cleared: ${result.cacheDropped ? "Yes" : "No"}\n` +
        `- Guilds affected: ${result.guildsAffected}\n` +
        `- Recomputation: Will occur lazily on next \`/stats\` call\n\n` +
        `${result.errors && result.errors.length > 0 ? `Warnings:\n${result.errors.map(e => `- ${e}`).join('\n')}` : ''}`,
    });

    if (interaction.guild) {
      const { postAuditEmbed } = await import("../../features/logger.js");
      await postAuditEmbed(interaction.guild, {
        action: "stats_reset",
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
      "[stats:reset] cache reset successful"
    );

    resetRateLimiter.delete(userId);
  } catch (err) {
    logger.error({ err, userId }, "[stats:reset] reset failed");

    await interaction.editReply({
      content: "Reset failed. Check logs for details.",
    });

    if (interaction.guild) {
      const { postAuditEmbed } = await import("../../features/logger.js");
      await postAuditEmbed(interaction.guild, {
        action: "stats_reset",
        userId,
        userTag: interaction.user.tag,
        result: "error",
        details: (err as Error).message,
      });
    }
  }
}
