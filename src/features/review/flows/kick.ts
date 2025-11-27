/**
 * Pawtropolis Tech -- src/features/review/flows/kick.ts
 * WHAT: Kick transaction and flow logic for application review.
 * WHY: Removes users from the guild with DM notification when applications are rejected with kick.
 * FLOWS:
 *  - kickTx: Database transaction to mark application as kicked
 *  - kickFlow: Discord-side DM and kick execution
 * DOCS:
 *  - GuildMember.kick: https://discord.js.org/#/docs/discord.js/main/class/GuildMember?scrollTo=kick
 *  - Role hierarchy: https://discordjs.guide/popular-topics/permissions.html#role-hierarchy
 *  - Permission errors (50013): Missing Permissions
 *  - Hierarchy errors (50013): Cannot kick users with equal/higher role
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Guild, GuildMember } from "discord.js";
import { db } from "../../../db/db.js";
import { logger } from "../../../lib/logger.js";
import { captureException } from "../../../lib/sentry.js";
import { nowUtc } from "../../../lib/time.js";
import type { ApplicationRow, TxResult } from "../types.js";

// ===== Constants =====

const FLOW_TIMEOUT_MS = 30000;

// ===== Helpers =====

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

// ===== Transaction =====

/**
 * kickTx
 * WHAT: Database transaction to mark an application as kicked.
 * WHY: Records the kick action in audit trail before Discord-side execution.
 * @param appId - Application ID
 * @param moderatorId - Moderator performing the action
 * @param reason - Kick reason (can be null)
 * @returns TxResult indicating success or current state
 */
export function kickTx(appId: string, moderatorId: string, reason: string | null): TxResult {
  return db.transaction(() => {
    const row = db.prepare(`SELECT status FROM application WHERE id = ?`).get(appId) as
      | { status: ApplicationRow["status"] }
      | undefined;
    if (!row) throw new Error("Application not found");
    if (row.status === "kicked") return { kind: "already" as const, status: row.status };
    if (row.status === "approved" || row.status === "rejected") {
      return { kind: "terminal" as const, status: row.status };
    }
    if (row.status === "draft") {
      return { kind: "invalid" as const, status: row.status };
    }
    // Audit trail for kick action
    const insert = db
      .prepare(
        `
        INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, meta)
        VALUES (?, ?, 'kick', ?, ?, NULL)
      `
      )
      .run(appId, moderatorId, nowUtc(), reason);
    // Persist terminal status in the application record
    db.prepare(
      `
      UPDATE application
      SET status = 'kicked',
          updated_at = datetime('now'),
          resolved_at = datetime('now'),
          resolver_id = ?,
          resolution_reason = ?
      WHERE id = ?
    `
    ).run(moderatorId, reason, appId);
    return { kind: "changed" as const, reviewActionId: Number(insert.lastInsertRowid) };
  })();
}

// ===== Flow =====

/**
 * kickFlow
 * WHAT: Kicks a member from the guild with optional DM notification.
 * WHY: Removes users who violate rules or are rejected from applications.
 * HIERARCHY: Bot must have KICK_MEMBERS permission and target must be below bot in role hierarchy.
 * @param guild - Discord guild
 * @param memberId - User ID to kick
 * @param reason - Optional kick reason for audit log
 * @returns Object with dmDelivered, kickSucceeded, and optional error
 */
export async function kickFlow(guild: Guild, memberId: string, reason?: string | null) {
  const result = {
    dmDelivered: false,
    kickSucceeded: false,
    error: undefined as string | undefined,
  };
  let member: GuildMember | null = null;

  // Fetch member from guild
  try {
    member = await withTimeout(
      guild.members.fetch(memberId),
      FLOW_TIMEOUT_MS,
      "kickFlow:fetchMember"
    );
  } catch (err) {
    result.error = "Member not found in guild (may have already left)";
    logger.warn({ err, guildId: guild.id, memberId }, "[review] kick failed: member not found");
    captureException(err, { area: "kickFlow:fetchMember", guildId: guild.id, userId: memberId });
    return result;
  }

  if (!member) {
    result.error = "Member not found in guild";
    return result;
  }

  // Check if member is kickable (hierarchy check)
  // DOCS: https://discordjs.guide/popular-topics/permissions.html#role-hierarchy
  if (!member.kickable) {
    result.error = "Cannot kick this user (role hierarchy or ownership)";
    logger.warn(
      { guildId: guild.id, memberId, memberRoles: member.roles.cache.map((r) => r.id) },
      "[review] kick failed (hierarchy): member has equal or higher role than bot"
    );
    return result;
  }

  // Build DM message
  const dmLines = [
    `Hi, your application with ${guild.name} was reviewed and you were removed from the server. If you believe this was a mistake, you may re-apply in the future.`,
    reason ? `Reason: ${reason}.` : null,
  ].filter(Boolean);

  // Attempt to DM user before kicking (best-effort)
  // WHY: Provides context to user; failure should not block the kick
  try {
    await withTimeout(
      member.send({ content: dmLines.join("\n") }),
      FLOW_TIMEOUT_MS,
      "kickFlow:sendDm"
    );
    result.dmDelivered = true;
    logger.debug({ userId: memberId }, "[review] kick DM delivered");
  } catch (err) {
    logger.warn(
      { err, userId: memberId },
      "[review] failed to DM applicant before kick (DMs may be closed)"
    );
  }

  // Execute kick
  // DOCS: https://discord.js.org/#/docs/discord.js/main/class/GuildMember?scrollTo=kick
  try {
    await withTimeout(
      member.kick(reason ?? undefined),
      FLOW_TIMEOUT_MS,
      "kickFlow:kick"
    );
    result.kickSucceeded = true;
    logger.info(
      { guildId: guild.id, memberId, reason, dmDelivered: result.dmDelivered },
      "[review] member kicked successfully"
    );
  } catch (err) {
    const errorCode = (err as any)?.code;
    const message = err instanceof Error ? err.message : "Unknown error";

    // Check for specific error codes
    // 50013 = Missing Permissions (bot lacks KICK_MEMBERS or hierarchy issue)
    if (errorCode === 50013) {
      result.error = "Missing permissions or role hierarchy prevents kick";
      logger.warn(
        { err, guildId: guild.id, memberId, errorCode },
        "[review] kick failed (hierarchy): bot lacks permissions or member has higher role"
      );
    } else {
      result.error = message;
      logger.warn(
        { err, guildId: guild.id, memberId, errorCode },
        "[review] kick failed with unexpected error"
      );
    }

    captureException(err, { area: "kickFlow:kick", guildId: guild.id, userId: memberId });
  }

  return result;
}
