/**
 * Pawtropolis Tech -- src/commands/stats/shared.ts
 * WHAT: Shared types, helpers, and re-exports for /stats command.
 * WHY: Centralizes common dependencies and utilities for all stats subcommands.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// Re-export common dependencies
export {
  ChatInputCommandInteraction,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type GuildMember,
} from "discord.js";

export type { CommandContext } from "../../lib/cmdWrap.js";
export { withStep, withSql, ensureDeferred, replyOrEdit } from "../../lib/cmdWrap.js";
export { db } from "../../db/db.js";
export { nowUtc } from "../../lib/time.js";
export { logger } from "../../lib/logger.js";
export { requireMinRole, ROLE_IDS, hasStaffPermissions, getConfig } from "../../lib/config.js";
export { classifyError, userFriendlyMessage } from "../../lib/errors.js";
export { isOwner } from "../../lib/owner.js";
export { isGuildMember } from "../../lib/typeGuards.js";
export { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";
export { captureException } from "../../lib/sentry.js";

// Helpers ported from modstats/helpers.ts
/**
 * Actions that count as "decisions" for moderator metrics.
 */
export const DECISION_ACTIONS = ["approve", "reject", "perm_reject", "kick", "modmail_open"];

/**
 * WHAT: Format duration in seconds as human-readable string.
 * WHY: Consistent time formatting for avg claim→decision displays.
 * FORMAT: "Xm" if < 1h, else "Hh Mm"
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) {
    return "—";
  }

  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (hours === 0) {
    return `${mins}m`;
  }

  return `${hours}h ${mins}m`;
}

/**
 * WHAT: Calculate average claim→decision time for a moderator.
 * WHY: Key performance metric for review speed and moderator efficiency.
 */
export function getAvgClaimToDecision(
  guildId: string,
  actorId: string,
  windowStartS: number
): number | null {
  const { db } = require("../../db/db.js");
  const result = db
    .prepare(
      `
      WITH decisions AS (
        SELECT app_id, created_at_s as decision_time
        FROM action_log
        WHERE guild_id = ? AND actor_id = ?
          AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
          AND created_at_s >= ?
          AND app_id IS NOT NULL
      ),
      claims AS (
        SELECT app_id, MAX(created_at_s) as claim_time
        FROM action_log
        WHERE guild_id = ? AND actor_id = ? AND action = 'claim'
        GROUP BY app_id
      )
      SELECT AVG(d.decision_time - c.claim_time) as avg_time
      FROM decisions d
      INNER JOIN claims c ON d.app_id = c.app_id
      WHERE c.claim_time < d.decision_time
    `
    )
    .get(guildId, actorId, windowStartS, guildId, actorId) as { avg_time: number | null };

  if (result?.avg_time === null || result?.avg_time === undefined) {
    return null;
  }

  return Math.floor(result.avg_time);
}

/**
 * WHAT: Calculate server average submit→first claim time.
 * WHY: Context metric for understanding review queue responsiveness.
 */
export function getAvgSubmitToFirstClaim(guildId: string, windowStartS: number): number | null {
  const { db } = require("../../db/db.js");
  const result = db
    .prepare(
      `
      WITH submissions AS (
        SELECT app_id, created_at_s as submit_time
        FROM action_log
        WHERE guild_id = ? AND action = 'app_submitted' AND created_at_s >= ?
          AND app_id IS NOT NULL
      ),
      first_claims AS (
        SELECT app_id, MIN(created_at_s) as claim_time
        FROM action_log
        WHERE guild_id = ? AND action = 'claim'
        GROUP BY app_id
      )
      SELECT AVG(c.claim_time - s.submit_time) as avg_time
      FROM submissions s
      INNER JOIN first_claims c ON s.app_id = c.app_id
      WHERE c.claim_time > s.submit_time
    `
    )
    .get(guildId, windowStartS, guildId) as { avg_time: number | null };

  if (result?.avg_time === null || result?.avg_time === undefined) {
    return null;
  }

  return Math.floor(result.avg_time);
}
