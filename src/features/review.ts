/**
 * Pawtropolis Tech — src/features/review.ts
 * WHAT: Staff review flows: approve/reject/kick, claims, review card helpers, and welcome/DM utilities.
 * WHY: Keeps all moderation actions in one module so interactions wire in cleanly.
 * Dear future me: I'm sorry about the state machine
 * FLOWS:
 *  - Buttons: v1:decide:* routes → run*Action helpers → update DB → refresh review card → reply
 *  - Modals: reject reason and 18+ confirmation → validate → write DB → reply
 *  - Welcome: attempt to post in general channel; fail-soft with hints
 * DOCS:
 *  - CommandInteractions: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction
 *  - Interaction response rules: https://discord.com/developers/docs/interactions/receiving-and-responding
 *  - Permissions model: https://discord.com/developers/docs/topics/permissions
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - SQLite UPSERT: https://sqlite.org/lang_UPSERT.html
 *  - Google Lens by URL: https://lens.google.com/uploadbyurl
 *
 * NOTE: Error handling philosophy — never crash interactions; prefer error cards + logs.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GuildMember,
  GuildTextBasedChannel,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type ChatInputCommandInteraction,
  type Message,
  type TextChannel,
  type User,
} from "discord.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { captureException } from "../lib/sentry.js";
import { getConfig, hasManageGuild, hasStaffPermissions, isReviewer } from "../lib/config.js";
import { getScan, googleReverseImageUrl, type ScanResult } from "./avatarScan.js";
import { GATE_SHOW_AVATAR_RISK } from "../lib/env.js";
import type { GuildConfig } from "../lib/config.js";
import { replyOrEdit, ensureDeferred } from "../lib/cmdWrap.js";
import {
  buildReviewEmbedV3 as buildReviewEmbed,
  buildActionRowsV2 as buildActionRows,
  type BuildEmbedOptions,
} from "../ui/reviewCard.js";
import { shortCode } from "../lib/ids.js";
import { logActionPretty } from "../logging/pretty.js";
import {
  BTN_DECIDE_RE,
  BTN_PERM_REJECT_RE,
  BTN_COPY_UID_RE,
  BTN_MODMAIL_RE,
  MODAL_REJECT_RE,
  MODAL_PERM_REJECT_RE,
} from "../lib/modalPatterns.js";
import { postWelcomeCard } from "./welcome.js";
import { closeModmailForApplication } from "./modmail.js";
import { nowUtc, formatUtc, formatRelative } from "../lib/time.js";
import { toDiscordAbs, toDiscordRel } from "../lib/timefmt.js";
import { autoDelete } from "../utils/autoDelete.js";

// In-memory set to track warned users for missing account age
const missingAccountAgeWarned = new Set<string>();

// Add this helper (or move it to your db layer if you prefer)
export function getReviewClaim(appId: string): ReviewClaimRow | undefined {
  return db
    .prepare("SELECT reviewer_id, claimed_at FROM review_claim WHERE app_id = ? LIMIT 1")
    .get(appId) as ReviewClaimRow | undefined;
}

export type ApplicationStatus = "draft" | "submitted" | "approved" | "rejected" | "needs_info" | "kicked";

export type ApplicationRow = {
  id: string;
  guild_id: string;
  user_id: string;
  status: ApplicationStatus;
};

type ReviewAnswer = {
  q_index: number;
  question: string;
  answer: string;
};

type ReviewActionMeta = {
  dmDelivered?: boolean;
  dmError?: string;
  roleApplied?: boolean;
  kickSucceeded?: boolean;
  kickError?: string;
} | null;

// Union type for review actions - used for type safety throughout review flows
type ReviewActionKind =
  | "approve"
  | "reject"
  | "perm_reject"
  | "need_info"
  | "kick"
  | "copy_uid"
  | "claim";

// Server-side allowlist for review actions (validation in code, no DB CHECK constraint)
// WHAT: Exhaustive list of permitted actions for review_action table writes.
// NOTE: All actions are tracked in history; no filtering in getRecentActionsForApp
// WHY: Prevents unknown actions from being written; extensible without schema changes.
// FLOWS: Validate before every INSERT; reject unknown actions with clear error message.
export const ALLOWED_ACTIONS = new Set<ReviewActionKind>([
  "approve",
  "reject",
  "need_info",
  "kick",
  "perm_reject",
  "copy_uid",
  "claim",
] as const);

type ReviewActionSnapshot = {
  action: ReviewActionKind;
  moderator_id: string;
  moderatorTag?: string;
  reason?: string | null;
  created_at: number; // Unix epoch seconds (consistent with review_action.created_at)
  meta: ReviewActionMeta;
};

type ReviewCardApplication = {
  id: string;
  guild_id: string;
  user_id: string;
  status: ApplicationStatus;
  created_at: string;
  submitted_at: string | null;
  updated_at: string | null;
  resolved_at: string | null;
  resolver_id: string | null;
  resolution_reason: string | null;
  userTag: string;
  avatarUrl?: string | null;
  lastAction?: ReviewActionSnapshot | null;
};

type AvatarScanRow = {
  finalPct: number;
  nsfwScore: number | null;
  edgeScore: number;
  furry_score: number;
  scalie_score: number;
  reason: string;
  evidence: {
    hard: Array<{ tag: string; p: number }>;
    soft: Array<{ tag: string; p: number }>;
    safe: Array<{ tag: string; p: number }>;
  };
};

type ReviewCardRow = {
  channel_id: string;
  message_id: string;
};

export type ReviewClaimRow = {
  reviewer_id: string;
  claimed_at: string;
};

/**
 * isClaimable
 * WHAT: Helper to determine if an application is in a claimable state.
 * WHY: Prevents claim attempts on terminal states (kicked, approved, rejected).
 * @param status - The application status
 * @returns true if the application can be claimed
 */
function isClaimable(status: ApplicationStatus): boolean {
  return status === "submitted" || status === "needs_info";
}

type TxResult =
  | { kind: "changed"; reviewActionId: number }
  | { kind: "already"; status: string }
  | { kind: "terminal"; status: string }
  | { kind: "invalid"; status: string };

export const CLAIMED_MESSAGE = (userId: string) =>
  `This application is claimed by <@${userId}>. Ask them to finish or unclaim it.`;

// deny politely; chaos later is worse
export function claimGuard(claim: ReviewClaimRow | null, userId: string): string | null {
  if (claim && claim.reviewer_id !== userId) {
    return CLAIMED_MESSAGE(claim.reviewer_id);
  }
  return null;
}

const BUTTON_RE = BTN_DECIDE_RE;
const MODAL_RE = MODAL_REJECT_RE;
type ReviewStaffInteraction =
  | ButtonInteraction
  | ModalSubmitInteraction
  | ChatInputCommandInteraction;
type ReviewActionInteraction = ButtonInteraction | ChatInputCommandInteraction;
function isStaff(guildId: string, member: GuildMember | null) {
  return hasStaffPermissions(member, guildId);
}

function loadApplication(appId: string): ApplicationRow | undefined {
  return db
    .prepare(
      `
    SELECT id, guild_id, user_id, status
    FROM application
    WHERE id = ?
  `
    )
    .get(appId) as ApplicationRow | undefined;
}

/**
 * WHAT: Find an application row by its HEX6 short code.
 * WHY: Commands like /reject need to reliably resolve short codes to applications.
 *
 * BEHAVIOR:
 * - Normalizes input (trim, uppercase, strips non-hex characters)
 * - Scans ALL applications in the guild (not just recent 200)
 * - Returns first exact match or null
 *
 * PERFORMANCE NOTE:
 * - This is O(N) in number of apps for the guild
 * - For large guilds (>10k apps), consider adding app_short_codes mapping table
 * - Current implementation prioritizes correctness over speed
 *
 * @param guildId - Guild ID to search within
 * @param code - HEX6 short code (accepts any casing, spacing, or non-hex chars which get stripped)
 * @returns ApplicationRow if found, null otherwise
 */
export function findAppByShortCode(guildId: string, code: string): ApplicationRow | null {
  if (!guildId) return null;

  // Normalize: strip non-hex, uppercase
  const cleaned = String(code || "").toUpperCase().replace(/[^0-9A-F]/g, "");

  // Validate: must be exactly 6 hex characters
  if (!/^[0-9A-F]{6}$/.test(cleaned)) {
    return null;
  }

  try {
    // Query ALL app ids for the guild and compute shortCode in JS
    // This fixes the "No application with code X" bug where apps existed but were outside the LIMIT 200 window
    const rows = db
      .prepare(
        `
        SELECT id, guild_id, user_id, status, submitted_at, updated_at, created_at
        FROM application
        WHERE guild_id = ?
      `
      )
      .all(guildId) as ApplicationRow[];

    // Scan for exact match
    for (const row of rows) {
      try {
        if (shortCode(row.id) === cleaned) {
          return row;
        }
      } catch (err) {
        // Skip rows with malformed IDs
        continue;
      }
    }

    return null;
  } catch (err) {
    logger.warn({ err, guildId, code: cleaned }, "[findAppByShortCode] DB scan failed");
    return null;
  }
}

export function findPendingAppByUserId(guildId: string, userId: string): ApplicationRow | null {
  /**
   * findPendingAppByUserId
   * WHAT: Finds a pending (submitted or needs_info) application for a user in a guild.
   * WHY: Enables UID-based targeting for /accept and /reject slash commands.
   * RETURNS: ApplicationRow | null
   */
  return db
    .prepare(
      `
    SELECT id, guild_id, user_id, status
    FROM application
    WHERE guild_id = ? AND user_id = ? AND status IN ('submitted', 'needs_info')
    ORDER BY created_at DESC
    LIMIT 1
  `
    )
    .get(guildId, userId) as ApplicationRow | null;
}

async function resolveApplication(
  interaction: ReviewStaffInteraction,
  code: string
): Promise<ApplicationRow | null> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await replyOrEdit(interaction, { content: "Guild only." }).catch(() => undefined);
    return null;
  }

  const row = findAppByShortCode(guildId, code);
  if (!row) {
    await replyOrEdit(interaction, { content: `No application with code ${code}.` }).catch(
      () => undefined
    );
    return null;
  }

  const app = loadApplication(row.id);
  if (!app) {
    await replyOrEdit(interaction, { content: "Application not found." }).catch(() => undefined);
    return null;
  }
  if (app.guild_id !== guildId) {
    await replyOrEdit(interaction, { content: "Guild mismatch for application." }).catch(
      () => undefined
    );
    return null;
  }

  return app;
}

function requireInteractionStaff(interaction: ButtonInteraction | ModalSubmitInteraction) {
  if (!interaction.inGuild() || !interaction.guildId) {
    interaction
      .reply({ flags: MessageFlags.Ephemeral, content: "Guild only." })
      .catch(() => undefined);
    return false;
  }
  const member = interaction.member as GuildMember | null;
  if (!isStaff(interaction.guildId, member)) {
    interaction
      .reply({ flags: MessageFlags.Ephemeral, content: "You do not have permission for this." })
      .catch(() => undefined);
    return false;
  }
  return true;
}

export function updateReviewActionMeta(id: number, meta: unknown) {
  db.prepare(`UPDATE review_action SET meta = json(?) WHERE id = ?`).run(JSON.stringify(meta), id);
}

export function getClaim(appId: string): ReviewClaimRow | null {
  const row = db
    .prepare(`SELECT reviewer_id, claimed_at FROM review_claim WHERE app_id = ?`)
    .get(appId) as ReviewClaimRow | undefined;
  return row ?? null;
}

export function upsertClaim(appId: string, reviewerId: string) {
  // claim it before someone else does (Battle Royale mode)
  db.prepare(
    `
    INSERT INTO review_claim (app_id, reviewer_id, claimed_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(app_id) DO UPDATE SET
      reviewer_id = excluded.reviewer_id,
      claimed_at = excluded.claimed_at
  `
  ).run(appId, reviewerId);
}

export function clearClaim(appId: string) {
  db.prepare(`DELETE FROM review_claim WHERE app_id = ?`).run(appId);
}

// idempotent on purpose; double-clickers exist
export function approveTx(appId: string, moderatorId: string): TxResult {
  return db.transaction(() => {
    const row = db.prepare(`SELECT status FROM application WHERE id = ?`).get(appId) as
      | { status: ApplicationRow["status"] }
      | undefined;
    if (!row) throw new Error("Application not found");
    if (row.status === "approved") return { kind: "already" as const, status: row.status };
    if (row.status === "rejected" || row.status === "kicked") {
      return { kind: "terminal" as const, status: row.status };
    }
    if (row.status !== "submitted" && row.status !== "needs_info") {
      return { kind: "invalid" as const, status: row.status };
    }
    const insert = db
      .prepare(
        `
        INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, meta)
        VALUES (?, ?, 'approve', ?, NULL, NULL)
      `
      )
      .run(appId, moderatorId, nowUtc());
    db.prepare(
      `
      UPDATE application
      SET status = 'approved',
          updated_at = datetime('now'),
          resolved_at = datetime('now'),
          resolver_id = ?,
          resolution_reason = NULL
      WHERE id = ?
    `
    ).run(moderatorId, appId);
    return { kind: "changed" as const, reviewActionId: Number(insert.lastInsertRowid) };
  })();
}

export function rejectTx(
  appId: string,
  moderatorId: string,
  reason: string,
  permanent = false
): TxResult {
  return db.transaction(() => {
    const row = db.prepare(`SELECT status FROM application WHERE id = ?`).get(appId) as
      | { status: ApplicationRow["status"] }
      | undefined;
    if (!row) throw new Error("Application not found");
    if (row.status === "rejected") return { kind: "already" as const, status: row.status };
    if (row.status === "approved" || row.status === "kicked") {
      return { kind: "terminal" as const, status: row.status };
    }
    if (row.status === "draft") {
      return { kind: "invalid" as const, status: row.status };
    }
    // Insert a snapshot row for moderation audit trail.
    // Table: review_action(app_id, moderator_id, action, created_at, reason, meta)
    // Reason is free text; meta is JSON for per-flow flags.
    const action = permanent ? "perm_reject" : "reject";
    const insert = db
      .prepare(
        `
        INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, meta)
        VALUES (?, ?, ?, ?, ?, NULL)
      `
      )
      .run(appId, moderatorId, action, nowUtc(), reason);
    // Mark the application terminal state and resolver in application table.
    db.prepare(
      `
      UPDATE application
      SET status = 'rejected',
          updated_at = datetime('now'),
          resolved_at = datetime('now'),
          resolver_id = ?,
          resolution_reason = ?,
          permanently_rejected = ?,
          permanent_reject_at = CASE WHEN ? = 1 THEN datetime('now') ELSE permanent_reject_at END
      WHERE id = ?
    `
    ).run(moderatorId, reason, permanent ? 1 : 0, permanent ? 1 : 0, appId);
    return { kind: "changed" as const, reviewActionId: Number(insert.lastInsertRowid) };
  })();
}

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

type ApproveFlowResult = {
  roleApplied: boolean;
  member: GuildMember | null;
  roleError?: {
    code?: number;
    message?: string;
  } | null;
};

export async function approveFlow(
  guild: Guild,
  memberId: string,
  cfg: GuildConfig
): Promise<ApproveFlowResult> {
  const result: ApproveFlowResult = {
    roleApplied: false,
    member: null,
    roleError: null,
  };
  try {
    result.member = await guild.members.fetch(memberId);
  } catch (err) {
    logger.warn({ err, guildId: guild.id, memberId }, "Failed to fetch member for approval");
    captureException(err, { area: "approveFlow:fetchMember", guildId: guild.id, userId: memberId });
    return result;
  }

  const roleId = cfg.accepted_role_id;
  if (roleId && result.member) {
    const role =
      guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
    if (role) {
      if (!result.member.roles.cache.has(role.id)) {
        try {
          // Bot must be above the target role; otherwise 50013 Missing Permissions.
          // Permissions model: https://discord.com/developers/docs/topics/permissions
          await result.member.roles.add(role, "Gate approval");
          result.roleApplied = true;
        } catch (err) {
          const code = (err as { code?: number }).code;
          const message = err instanceof Error ? err.message : undefined;
          result.roleError = { code, message };
          logger.warn(
            { err, guildId: guild.id, memberId, roleId },
            "Failed to grant approval role"
          );
          if (!isMissingPermissionError(err)) {
            captureException(err, {
              area: "approveFlow:grantRole",
              guildId: guild.id,
              userId: memberId,
              roleId,
            });
          }
        }
      } else {
        result.roleApplied = true;
      }
    }
  }

  return result;
}

export async function deliverApprovalDm(member: GuildMember, guildName: string): Promise<boolean> {
  try {
    // DM may fail if recipient has privacy settings enabled; we fail-soft and do not block approval.
    await member.send({
      content: `Hi, welcome to ${guildName}! Your application has been approved. Enjoy your stay.`,
    });
    return true;
  } catch (err) {
    logger.warn({ err, userId: member.id }, "Failed to DM applicant after approval");
    return false;
  }
}

export async function rejectFlow(
  user: User,
  options: { guildName: string; reason: string; permanent?: boolean }
) {
  // DM might fail. we tried.
  const result = { dmDelivered: false };
  const lines = options.permanent
    ? [
        `You've been permanently rejected from **${options.guildName}** and cannot apply again. Thanks for stopping by.`,
      ]
    : [
        `Hello, thanks for applying to ${options.guildName}. The moderation team was not able to approve this application. You can submit a new one anytime!`,
        `Reason: ${options.reason}.`,
      ];
  try {
    // DM can fail; we record dmDelivered=false and continue moderation flow.
    await user.send({ content: lines.join("\n") });
    result.dmDelivered = true;
  } catch (err) {
    logger.warn({ err, userId: user.id }, "Failed to DM applicant about rejection");
  }
  return result;
}

export async function kickFlow(guild: Guild, memberId: string, reason?: string | null) {
  /**
   * kickFlow
   * WHAT: Kicks a member from the guild with optional DM notification.
   * WHY: Removes users who violate rules or are rejected from applications.
   * HIERARCHY: Bot must have KICK_MEMBERS permission and target must be below bot in role hierarchy.
   * DOCS:
   *  - GuildMember.kick: https://discord.js.org/#/docs/discord.js/main/class/GuildMember?scrollTo=kick
   *  - Role hierarchy: https://discordjs.guide/popular-topics/permissions.html#role-hierarchy
   *  - Permission errors (50013): Missing Permissions
   *  - Hierarchy errors (50013): Cannot kick users with equal/higher role
   */
  const result = {
    dmDelivered: false,
    kickSucceeded: false,
    error: undefined as string | undefined,
  };
  let member: GuildMember | null = null;

  // Fetch member from guild
  try {
    member = await guild.members.fetch(memberId);
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
    await member.send({ content: dmLines.join("\n") });
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
    await member.kick(reason ?? undefined);
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

async function runApproveAction(interaction: ReviewActionInteraction, app: ApplicationRow) {
  const guild = interaction.guild as Guild | null;
  if (!guild) {
    await replyOrEdit(interaction, { content: "Guild not found." }).catch(() => undefined);
    return;
  }
  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch(() => undefined);
    return;
  }
  const result = approveTx(app.id, interaction.user.id);
  if (result.kind === "already") {
    await replyOrEdit(interaction, { content: "Already approved." }).catch(() => undefined);
    return;
  }
  if (result.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${result.status}).` }).catch(
      () => undefined
    );
    return;
  }
  if (result.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application is not ready for approval." }).catch(
      () => undefined
    );
    return;
  }

  const cfg = getConfig(guild.id);
  let approvedMember: GuildMember | null = null;
  let roleApplied = false;
  let roleError: ApproveFlowResult["roleError"] = null;
  if (cfg) {
    const flow = await approveFlow(guild, app.user_id, cfg);
    approvedMember = flow.member;
    roleApplied = flow.roleApplied;
    roleError = flow.roleError ?? null;
  }

  clearClaim(app.id);

  // Log approve action to action_log (analytics + pretty embed to logging channel)
  // Non-blocking: .catch() prevents logging failures from affecting approval flow
  if (guild) {
    await logActionPretty(guild, {
      appId: app.id,
      appCode: shortCode(app.id),
      actorId: interaction.user.id,
      subjectId: app.user_id,
      action: "approve",
    }).catch((err) => {
      logger.warn({ err, appId: app.id }, "[review] failed to log approve action");
    });
  }

  try {
    await ensureReviewMessage(interaction.client, app.id);
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after approval");
    captureException(err, { area: "approve:ensureReviewMessage", appId: app.id });
  }

  let dmDelivered = false;
  if (approvedMember) {
    dmDelivered = await deliverApprovalDm(approvedMember, guild.name);
  }

  let welcomeNote: string | null = null;
  let roleNote: string | null = null;
  if (cfg && approvedMember && (cfg.accepted_role_id ? roleApplied : true)) {
    try {
      await postWelcomeCard({
        guild,
        user: approvedMember,
        config: cfg,
        memberCount: guild.memberCount,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "unknown error";
      logger.warn(
        { err, guildId: guild.id, userId: approvedMember.id },
        "[approve] failed to post welcome card"
      );
      if (errorMessage.includes("not configured")) {
        welcomeNote = "Welcome message failed: general channel not configured.";
      } else if (errorMessage.includes("missing permissions")) {
        const channelMention = cfg.general_channel_id
          ? `<#${cfg.general_channel_id}>`
          : "the channel";
        welcomeNote = `Welcome message failed: missing permissions in ${channelMention}.`;
      } else {
        welcomeNote = `Welcome message failed: ${errorMessage}`;
      }
    }
  } else if (!cfg?.general_channel_id) {
    welcomeNote = "Welcome message not posted: general channel not configured.";
  }

  if (cfg?.accepted_role_id && roleError) {
    const roleMention = `<@&${cfg.accepted_role_id}>`;
    if (roleError.code === 50013) {
      roleNote = `Failed to grant verification role ${roleMention} (missing permissions).`;
    } else {
      const reason = roleError.message ?? "Unknown error";
      roleNote = `Failed to grant verification role ${roleMention}: ${reason}.`;
    }
  }

  updateReviewActionMeta(result.reviewActionId, { roleApplied, dmDelivered });

  // Auto-close modmail on approval
  const code = shortCode(app.id);
  try {
    await closeModmailForApplication(guild.id, app.user_id, code, {
      reason: "approved",
      client: interaction.client,
      guild,
    });
    logger.info({ code, reason: "approved" }, "[review] decision → modmail auto-close");
  } catch (err) {
    logger.warn({ err, code }, "[review] failed to auto-close modmail on approval");
  }

  // Refresh review card after modmail close
  let reviewMessageId: string | undefined;
  try {
    const result = await ensureReviewMessage(interaction.client, app.id);
    reviewMessageId = result.messageId;
    logger.info({ code, appId: app.id }, "[review] card refreshed");
  } catch (err) {
    logger.warn({ err, appId: app.id }, "[review] failed to refresh card after modmail close");
  }

  // Post public approval message as a reply to the review card
  const messages = ["Application approved."];
  if (roleNote) messages.push(roleNote);
  if (welcomeNote) messages.push(welcomeNote);

  if (interaction.channel && "send" in interaction.channel) {
    try {
      await interaction.channel.send({
        content: messages.join("\n"),
        allowedMentions: { parse: [] },
        reply: reviewMessageId ? { messageReference: reviewMessageId } : undefined,
      });
    } catch (err) {
      logger.warn({ err, appId: app.id }, "[review] failed to post public approval message");
    }
  }
}

async function openRejectModal(interaction: ButtonInteraction, app: ApplicationRow) {
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:reject:code${shortCode(app.id)}`)
    .setTitle("Reject application");
  const reasonInput = new TextInputBuilder()
    .setCustomId("v1:modal:reject:reason")
    .setLabel("Reason (max 500 chars)")
    .setRequired(true)
    .setMaxLength(500)
    .setStyle(TextInputStyle.Paragraph);
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
  modal.addComponents(row);

  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved." }).catch(
      () => undefined
    );
    return;
  }

  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch(() => undefined);
    return;
  }

  await interaction.showModal(modal).catch((err) => {
    logger.warn({ err, appId: app.id }, "Failed to show reject modal");
  });
}

async function handleClaimToggle(interaction: ButtonInteraction, app: ApplicationRow) {
  // Import atomic claim function
  const { claimTx, ClaimError: ClaimTxError } = await import("./reviewActions.js");

  // Note: deferUpdate() already called by parent handleReviewButton, so don't call again

  // Attempt atomic claim (includes validation and transaction)
  try {
    claimTx(app.id, interaction.user.id, app.guild_id);
  } catch (err) {
    if (err instanceof ClaimTxError) {
      let msg = "❌ Failed to claim application";
      if (err.code === "ALREADY_CLAIMED") {
        msg = "❌ This application is already claimed by another moderator.";
      } else if (err.code === "INVALID_STATUS") {
        msg = `❌ Cannot claim: application is already **${err.message.split(" ")[2]}**.`;

        // Refresh card to show current state
        try {
          await ensureReviewMessage(interaction.client, app.id);
        } catch (refreshErr) {
          logger.warn({ err: refreshErr, appId: app.id }, "[review] failed to refresh card after blocked claim");
        }
      } else if (err.code === "APP_NOT_FOUND") {
        msg = "❌ Application not found.";
      }

      await replyOrEdit(interaction, {
        content: msg,
        flags: MessageFlags.Ephemeral,
      }).catch(() => undefined);

      return;
    }

    // Unexpected error
    logger.error({ err, appId: app.id }, "[review] unexpected claim error");
    await replyOrEdit(interaction, {
      content: "❌ An unexpected error occurred. Please try again.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => undefined);
    return;
  }

  // Check if user is permanently rejected (additional validation)
  const permRejectCheck = db
    .prepare(
      `SELECT permanently_rejected FROM application WHERE guild_id = ? AND user_id = ? AND permanently_rejected = 1`
    )
    .get(app.guild_id, app.user_id) as { permanently_rejected: number } | undefined;

  if (permRejectCheck) {
    await replyOrEdit(interaction, {
      content: `This user has been permanently rejected from **${interaction.guild?.name ?? "this server"}** and cannot reapply.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => undefined);
    logger.info(
      { userId: app.user_id, guildId: app.guild_id, moderatorId: interaction.user.id },
      "[review] Claim attempt blocked - user permanently rejected"
    );
    return;
  }

  // Insert review_action for audit trail (legacy table)
  try {
    db.prepare(
      `INSERT INTO review_action (app_id, moderator_id, action, created_at) VALUES (?, ?, 'claim', ?)`
    ).run(app.id, interaction.user.id, Math.floor(Date.now() / 1000));
  } catch (err) {
    logger.warn({ err, appId: app.id }, "[review] failed to insert review_action (non-fatal)");
  }

  logger.info(
    {
      appId: app.id,
      claimerId: interaction.user.id,
      guildId: app.guild_id,
    },
    "[review] application claimed successfully"
  );

  // Log claim action via pretty embed
  if (interaction.guild) {
    await logActionPretty(interaction.guild, {
      appId: app.id,
      appCode: shortCode(app.id),
      actorId: interaction.user.id,
      subjectId: app.user_id,
      action: "claim",
    }).catch((err) => {
      logger.warn({ err, appId: app.id }, "[review] failed to log claim action");
    });
  }

  // Refresh the review card to show the claim
  try {
    await ensureReviewMessage(interaction.client, app.id);
    logger.info({ appId: app.id }, "[review] card refreshed after claim");
  } catch (err) {
    logger.warn({ err, appId: app.id }, "[review] failed to refresh review card after claim");
    captureException(err, { area: "claim:ensureReviewMessage", appId: app.id });
  }

  // Send single ephemeral feedback to confirm claim (no public message)
  await replyOrEdit(interaction, {
    content: "✅ Application claimed successfully.",
    flags: MessageFlags.Ephemeral,
  }).catch(() => undefined);
}

async function handleUnclaimAction(interaction: ButtonInteraction, app: ApplicationRow) {
  // Import atomic unclaim function
  const { unclaimTx, ClaimError: ClaimTxError } = await import("./reviewActions.js");

  // Note: deferUpdate() already called by parent handleReviewButton, so don't call again

  // Attempt atomic unclaim (includes validation and transaction)
  try {
    unclaimTx(app.id, interaction.user.id, app.guild_id);
  } catch (err) {
    if (err instanceof ClaimTxError) {
      let msg = "❌ Failed to unclaim application";
      if (err.code === "NOT_CLAIMED") {
        msg = "❌ This application is not currently claimed.";
      } else if (err.code === "NOT_OWNER") {
        msg = "❌ You did not claim this application. Only the claim owner can unclaim it.";
      } else if (err.code === "APP_NOT_FOUND") {
        msg = "❌ Application not found.";
      }

      await replyOrEdit(interaction, {
        content: msg,
        flags: MessageFlags.Ephemeral,
      }).catch(() => undefined);

      return;
    }

    // Unexpected error
    logger.error({ err, appId: app.id }, "[review] unexpected unclaim error");
    await replyOrEdit(interaction, {
      content: "❌ An unexpected error occurred. Please try again.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => undefined);
    return;
  }

  // Insert review_action for audit trail (legacy table)
  try {
    db.prepare(
      `INSERT INTO review_action (app_id, moderator_id, action, created_at) VALUES (?, ?, 'unclaim', ?)`
    ).run(app.id, interaction.user.id, Math.floor(Date.now() / 1000));
  } catch (err) {
    logger.warn({ err, appId: app.id }, "[review] failed to insert review_action (non-fatal)");
  }

  logger.info(
    {
      appId: app.id,
      moderatorId: interaction.user.id,
      guildId: app.guild_id,
    },
    "[review] application unclaimed successfully"
  );

  // Log unclaim action via pretty embed
  if (interaction.guild) {
    await logActionPretty(interaction.guild, {
      appId: app.id,
      appCode: shortCode(app.id),
      actorId: interaction.user.id,
      subjectId: app.user_id,
      action: "unclaim",
      meta: { type: "unclaim" },
    }).catch((err) => {
      logger.warn({ err, appId: app.id }, "[review] failed to log unclaim action");
    });
  }

  // Refresh the review card to show unclaimed state
  try {
    await ensureReviewMessage(interaction.client, app.id);
    logger.info({ appId: app.id }, "[review] card refreshed after unclaim");
  } catch (err) {
    logger.warn({ err, appId: app.id }, "[review] failed to refresh review card after unclaim");
    captureException(err, { area: "unclaim:ensureReviewMessage", appId: app.id });
  }

  // Send single ephemeral feedback to confirm unclaim (no public message)
  await replyOrEdit(interaction, {
    content: `✅ Application \`${shortCode(app.id)}\` unclaimed successfully.`,
    flags: MessageFlags.Ephemeral,
  }).catch(() => undefined);
}

async function runKickAction(
  interaction: ReviewActionInteraction,
  app: ApplicationRow,
  reason: string | null
) {
  const guild = interaction.guild as Guild | null;
  if (!guild) {
    await replyOrEdit(interaction, { content: "Guild not found." }).catch(() => undefined);
    return;
  }
  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch(() => undefined);
    return;
  }
  const tx = kickTx(app.id, interaction.user.id, reason);
  if (tx.kind === "already") {
    await replyOrEdit(interaction, { content: "Already kicked." }).catch(() => undefined);
    return;
  }
  if (tx.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${tx.status}).` }).catch(
      () => undefined
    );
    return;
  }
  if (tx.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application not in a kickable state." }).catch(
      () => undefined
    );
    return;
  }

  const flow = await kickFlow(guild, app.user_id, reason ?? undefined);
  updateReviewActionMeta(tx.reviewActionId, flow);

  clearClaim(app.id);

  const code = shortCode(app.id);

  // Log kick action
  await logActionPretty(guild, {
    appId: app.id,
    appCode: code,
    actorId: interaction.user.id,
    subjectId: app.user_id,
    action: "kick",
    reason: reason || undefined,
  }).catch((err) => {
    logger.warn({ err, appId: app.id }, "[review] failed to log kick action");
  });

  // Auto-close modmail on kick
  try {
    await closeModmailForApplication(guild.id, app.user_id, code, {
      reason: "kicked",
      client: interaction.client,
      guild,
    });
    logger.info({ code, reason: "kicked" }, "[review] decision → modmail auto-close");
  } catch (err) {
    logger.warn({ err, code }, "[review] failed to auto-close modmail on kick");
  }

  // Refresh review card after modmail close
  let reviewMessageId: string | undefined;
  try {
    const result = await ensureReviewMessage(interaction.client, app.id);
    reviewMessageId = result.messageId;
    logger.info({ code, appId: app.id }, "[review] card refreshed");
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after kick");
    captureException(err, { area: "kick:ensureReviewMessage", appId: app.id });
  }

  // Post public kick message as a reply to the review card
  const message = flow.kickSucceeded ? "Member kicked." : "Kick attempted; check logs for details.";

  if (interaction.channel && "send" in interaction.channel) {
    try {
      await interaction.channel.send({
        content: message,
        allowedMentions: { parse: [] },
        reply: reviewMessageId ? { messageReference: reviewMessageId } : undefined,
      });
    } catch (err) {
      logger.warn({ err, appId: app.id }, "[review] failed to post public kick message");
    }
  }
}

async function runRejectAction(
  interaction: ReviewStaffInteraction,
  app: ApplicationRow,
  reason: string
) {
  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved." }).catch(
      () => undefined
    );
    return;
  }

  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch(() => undefined);
    return;
  }

  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    await replyOrEdit(interaction, { content: "Reason is required." }).catch(() => undefined);
    return;
  }

  const tx = rejectTx(app.id, interaction.user.id, trimmed);
  if (tx.kind === "already") {
    await replyOrEdit(interaction, { content: "Already rejected." }).catch(() => undefined);
    return;
  }
  if (tx.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${tx.status}).` }).catch(
      () => undefined
    );
    return;
  }
  if (tx.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application not submitted yet." }).catch(
      () => undefined
    );
    return;
  }

  const user = await interaction.client.users.fetch(app.user_id).catch(() => null);
  const guildName = interaction.guild?.name ?? "this server";
  let dmDelivered = false;
  if (user) {
    const dmResult = await rejectFlow(user, { guildName, reason: trimmed });
    dmDelivered = dmResult.dmDelivered;
    updateReviewActionMeta(tx.reviewActionId, dmResult);
  } else {
    logger.warn({ userId: app.user_id }, "Failed to fetch user for rejection DM");
    updateReviewActionMeta(tx.reviewActionId, { dmDelivered });
  }

  clearClaim(app.id);

  // Auto-close modmail on rejection
  const guild = interaction.guild;
  const code = shortCode(app.id);

  // Log reject action
  if (guild) {
    await logActionPretty(guild, {
      appId: app.id,
      appCode: code,
      actorId: interaction.user.id,
      subjectId: app.user_id,
      action: "reject",
      reason: trimmed,
    }).catch((err) => {
      logger.warn({ err, appId: app.id }, "[review] failed to log reject action");
    });
  }

  if (guild) {
    try {
      await closeModmailForApplication(guild.id, app.user_id, code, {
        reason: "rejected",
        client: interaction.client,
        guild,
      });
      logger.info({ code, reason: "rejected" }, "[review] decision → modmail auto-close");
    } catch (err) {
      logger.warn({ err, code }, "[review] failed to auto-close modmail on rejection");
    }
  }

  // Refresh review card after modmail close
  let reviewMessageId: string | undefined;
  try {
    const result = await ensureReviewMessage(interaction.client, app.id);
    reviewMessageId = result.messageId;
    logger.info({ code, appId: app.id }, "[review] card refreshed");
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after rejection");
    captureException(err, { area: "reject:ensureReviewMessage", appId: app.id });
  }

  // Post public rejection message as a reply to the review card
  const publicContent = dmDelivered
    ? "Application rejected."
    : "Application rejected. (DM delivery failed)";
  if (interaction.channel && "send" in interaction.channel) {
    try {
      await interaction.channel.send({
        content: publicContent,
        allowedMentions: { parse: [] },
        reply: reviewMessageId ? { messageReference: reviewMessageId } : undefined,
      });
    } catch (err) {
      logger.warn({ err, appId: app.id }, "[review] failed to post public rejection message");
    }
  }
}

async function runPermRejectAction(
  interaction: ReviewStaffInteraction,
  app: ApplicationRow,
  reason: string
) {
  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved." }).catch(
      () => undefined
    );
    return;
  }

  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError }).catch(() => undefined);
    return;
  }

  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    await replyOrEdit(interaction, { content: "Reason is required." }).catch(() => undefined);
    return;
  }

  const tx = rejectTx(app.id, interaction.user.id, trimmed, true); // permanent = true
  if (tx.kind === "already") {
    await replyOrEdit(interaction, { content: "Already rejected." }).catch(() => undefined);
    return;
  }
  if (tx.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${tx.status}).` }).catch(
      () => undefined
    );
    return;
  }
  if (tx.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application not submitted yet." }).catch(
      () => undefined
    );
    return;
  }

  const user = await interaction.client.users.fetch(app.user_id).catch(() => null);
  const guildName = interaction.guild?.name ?? "this server";
  let dmDelivered = false;
  if (user) {
    const dmResult = await rejectFlow(user, { guildName, reason: trimmed, permanent: true });
    dmDelivered = dmResult.dmDelivered;
    updateReviewActionMeta(tx.reviewActionId, dmResult);
  } else {
    logger.warn({ userId: app.user_id }, "Failed to fetch user for permanent rejection DM");
    updateReviewActionMeta(tx.reviewActionId, { dmDelivered });
  }

  // Log permanent rejection
  logger.info(
    {
      moderatorId: interaction.user.id,
      userId: app.user_id,
      appId: app.id,
      guildId: interaction.guild?.id,
      reason: trimmed,
    },
    "[review] Permanent rejection applied"
  );

  clearClaim(app.id);

  const guild = interaction.guild;
  const code = shortCode(app.id);

  // Log perm_reject action
  if (guild) {
    await logActionPretty(guild, {
      appId: app.id,
      appCode: code,
      actorId: interaction.user.id,
      subjectId: app.user_id,
      action: "perm_reject",
      reason: trimmed,
    }).catch((err) => {
      logger.warn({ err, appId: app.id }, "[review] failed to log perm_reject action");
    });
  }

  // Auto-close modmail on permanent rejection
  if (guild) {
    try {
      await closeModmailForApplication(guild.id, app.user_id, code, {
        reason: "permanently rejected",
        client: interaction.client,
        guild,
      });
      logger.info(
        { code, reason: "permanently rejected" },
        "[review] decision → modmail auto-close"
      );
    } catch (err) {
      logger.warn({ err, code }, "[review] failed to auto-close modmail on permanent rejection");
    }
  }

  // Refresh review card after modmail close
  let reviewMessageId: string | undefined;
  try {
    const result = await ensureReviewMessage(interaction.client, app.id);
    reviewMessageId = result.messageId;
    logger.info({ code, appId: app.id }, "[review] card refreshed");
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after permanent rejection");
    captureException(err, { area: "permreject:ensureReviewMessage", appId: app.id });
  }

  // Post public permanent rejection message as a reply to the review card
  const publicContent = dmDelivered
    ? "Application permanently rejected."
    : "Application permanently rejected. (DM delivery failed)";
  if (interaction.channel && "send" in interaction.channel) {
    try {
      await interaction.channel.send({
        content: publicContent,
        allowedMentions: { parse: [] },
        reply: reviewMessageId ? { messageReference: reviewMessageId } : undefined,
      });
    } catch (err) {
      logger.warn(
        { err, appId: app.id },
        "[review] failed to post public permanent rejection message"
      );
    }
  }
}

async function runUnclaimAction(interaction: ReviewActionInteraction, app: ApplicationRow) {
  const claim = getClaim(app.id);
  if (!claim) {
    await replyOrEdit(interaction, { content: "This application is not currently claimed." }).catch(
      () => undefined
    );
    return;
  }
  if (claim.reviewer_id !== interaction.user.id) {
    await replyOrEdit(interaction, { content: CLAIMED_MESSAGE(claim.reviewer_id) }).catch(
      () => undefined
    );
    return;
  }

  clearClaim(app.id);
  try {
    await ensureReviewMessage(interaction.client, app.id);
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after unclaim");
    captureException(err, { area: "unclaim:ensureReviewMessage", appId: app.id });
  }

  await replyOrEdit(interaction, { content: "Claim removed." }).catch(() => undefined);
}

export async function handleReviewButton(interaction: ButtonInteraction) {
  const match = BUTTON_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  const [, action, code] = match;

  try {
    // reject opens modal; no defer needed yet
    if (action === "reject") {
      const app = await resolveApplication(interaction, code);
      if (!app) return;
      await openRejectModal(interaction, app);
      return;
    }

    // Acknowledge button without visible bubble for approve/kick/claim
    // https://discord.js.org/#/docs/discord.js/main/class/Interaction?scrollTo=deferUpdate
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => undefined);
    }

    const app = await resolveApplication(interaction, code);
    if (!app) return;

    if (action === "approve" || action === "accept") {
      await runApproveAction(interaction, app);
    } else if (action === "kick") {
      await runKickAction(interaction, app, null);
    } else if (action === "claim") {
      await handleClaimToggle(interaction, app);
    } else if (action === "unclaim") {
      await handleUnclaimAction(interaction, app);
    }
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, action, code, traceId }, "Review button handling failed");
    captureException(err, { area: "handleReviewButton", action, code, traceId });
    if (!interaction.deferred && !interaction.replied && action !== "reject") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    await replyOrEdit(interaction, {
      content: `Failed to process action (trace: ${traceId}). Try again or check logs.`,
    }).catch(() => undefined);
  }
}

export async function handleRejectModal(interaction: ModalSubmitInteraction) {
  const match = MODAL_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  // Acknowledge modal without visible bubble
  // https://discord.js.org/#/docs/discord.js/main/class/Interaction?scrollTo=deferUpdate
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(() => undefined);
  }

  const code = match[1];

  try {
    const app = await resolveApplication(interaction, code);
    if (!app) return;

    const reasonRaw = interaction.fields.getTextInputValue("v1:modal:reject:reason") ?? "";
    const reason = reasonRaw.trim().slice(0, 500);

    await runRejectAction(interaction, app, reason);
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, code, traceId }, "Reject modal handling failed");
    captureException(err, { area: "handleRejectModal", code, traceId });
    await replyOrEdit(interaction, {
      content: `Failed to process rejection (trace: ${traceId}).`,
    }).catch(() => undefined);
  }
}

export async function handleModmailButton(interaction: ButtonInteraction) {
  const match = BTN_MODMAIL_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  const code = match[1];

  // Defer update to acknowledge button
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(() => undefined);
  }

  try {
    const app = await resolveApplication(interaction, code);
    if (!app) return;

    // Import and call modmail function
    const { openPublicModmailThreadFor } = await import("./modmail.js");
    const result = await openPublicModmailThreadFor({
      interaction,
      userId: app.user_id,
      appCode: code,
      appId: app.id,
    });

    // Provide feedback
    if (result.success) {
      // Public confirmation in the review channel if available
      if (interaction.channel && "send" in interaction.channel) {
        try {
          await interaction.channel.send({
            content: result.message ?? "Modmail thread created.",
            allowedMentions: { parse: [] },
          });
        } catch (err) {
          logger.warn({ err, code }, "[modmail] failed to post public thread creation message");
        }
      }
    } else {
      // Ephemeral explanation to the clicking moderator
      const msg = result.message || "Failed to create modmail thread. Check bot permissions.";
      await interaction
        .followUp({
          flags: MessageFlags.Ephemeral,
          content: `⚠️ ${msg}`,
          allowedMentions: { parse: [] },
        })
        .catch(() => undefined);
    }
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, code, traceId }, "Modmail button handling failed");
    captureException(err, { area: "handleModmailButton", code, traceId });
    await replyOrEdit(interaction, {
      content: `Failed to open modmail (trace: ${traceId}).`,
    }).catch(() => undefined);
  }
}

export async function handlePermRejectButton(interaction: ButtonInteraction) {
  const match = BTN_PERM_REJECT_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  const code = match[2];

  try {
    const app = await resolveApplication(interaction, code);
    if (!app) return;
    await openPermRejectModal(interaction, app);
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, code, traceId }, "Permanent reject button handling failed");
    captureException(err, { area: "handlePermRejectButton", code, traceId });
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    await replyOrEdit(interaction, {
      content: `Failed to open permanent reject modal (trace: ${traceId}).`,
    }).catch(() => undefined);
  }
}

async function openPermRejectModal(interaction: ButtonInteraction, app: ApplicationRow) {
  const claim = getClaim(app.id);
  if (claim && claim.reviewer_id !== interaction.user.id) {
    await replyOrEdit(interaction, {
      content: "You did not claim this application.",
    }).catch(() => undefined);
    return;
  }

  const code = shortCode(app.id);
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:permreject:code${code}`)
    .setTitle("Permanently Reject");
  const input = new TextInputBuilder()
    .setCustomId("v1:modal:permreject:reason")
    .setLabel("Rejection reason")
    .setPlaceholder("Provide a detailed reason for permanent rejection...")
    .setRequired(true)
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(500);
  const modalRow = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  modal.addComponents(modalRow);

  await interaction.showModal(modal).catch((err) => {
    logger.warn({ err, appId: app.id }, "[review] failed to show permanent reject modal");
  });
}

export async function handlePermRejectModal(interaction: ModalSubmitInteraction) {
  const match = MODAL_PERM_REJECT_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  // Acknowledge modal without visible bubble
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(() => undefined);
  }

  const code = match[1];

  try {
    const app = await resolveApplication(interaction, code);
    if (!app) return;

    const reasonRaw = interaction.fields.getTextInputValue("v1:modal:permreject:reason") ?? "";
    const reason = reasonRaw.trim().slice(0, 500);

    await runPermRejectAction(interaction, app, reason);
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, code, traceId }, "Permanent reject modal handling failed");
    captureException(err, { area: "handlePermRejectModal", code, traceId });
    await replyOrEdit(interaction, {
      content: `Failed to process permanent rejection (trace: ${traceId}).`,
    }).catch(() => undefined);
  }
}

export async function handleCopyUidButton(interaction: ButtonInteraction) {
  const match = BTN_COPY_UID_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  const [, code, userId] = match;

  try {
    // Verify the application exists for security
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Guild context required.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const appRow = findAppByShortCode(interaction.guildId, code);
    if (!appRow) {
      await interaction.reply({
        content: `No application with code ${code}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Reply with UID only (no title) for easy mobile copying
    await interaction.reply({
      content: userId,
      flags: MessageFlags.Ephemeral,
    });

    // Log the action to audit trail
    logger.info(
      { moderatorId: interaction.user.id, userId, appId: appRow.id, guildId: interaction.guildId },
      "[review] Moderator copied user ID"
    );

    // Insert audit trail
    try {
      db.prepare(
        `
        INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, message_link, meta)
        VALUES (?, ?, 'copy_uid', ?, NULL, NULL, NULL)
        `
      ).run(appRow.id, interaction.user.id, nowUtc());
    } catch (auditErr: any) {
      logger.error({ err: auditErr, appId: appRow.id }, "[review] Failed to log copy_uid action");
    }
  } catch (err) {
    const traceId = interaction.id.slice(-8).toUpperCase();
    logger.error({ err, code, userId, traceId }, "Copy UID button handling failed");
    captureException(err, { area: "handleCopyUidButton", code, userId, traceId });
    await interaction
      .reply({
        content: `Failed to copy UID (trace: ${traceId}).`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined);
  }
}

type WelcomeFailureReason =
  | "missing_channel"
  | "invalid_channel"
  | "missing_permissions"
  | "fetch_failed"
  | "send_failed";

type WelcomeResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: WelcomeFailureReason; error?: unknown };

export const DEFAULT_WELCOME_TEMPLATE = "Welcome {applicant.mention} to {guild.name}! 👋";
const invalidWelcomeTemplateWarned = new Set<string>();
const emojiCacheFetched = new Set<string>();

function warnInvalidTemplateOnce(guildId: string, detail: string) {
  if (invalidWelcomeTemplateWarned.has(guildId)) return;
  invalidWelcomeTemplateWarned.add(guildId);
  logger.warn({ guildId, detail }, "[welcome] invalid custom template; using default embed");
}

async function resolveGuildEmoji(
  guild: Guild,
  candidateNames: string[],
  fallback: string
): Promise<string> {
  const lowerCandidates = candidateNames.map((name) => name.toLowerCase());
  try {
    if (!emojiCacheFetched.has(guild.id)) {
      await guild.emojis.fetch();
      emojiCacheFetched.add(guild.id);
    }
  } catch (err) {
    emojiCacheFetched.add(guild.id);
    logger.debug({ err, guildId: guild.id }, "[welcome] emoji fetch failed; using fallback");
  }

  const cache = guild.emojis.cache as { find?: (fn: (emoji: any) => boolean) => any };
  if (cache?.find) {
    const match = cache.find((emoji) => {
      const name = (emoji?.name ?? "").toLowerCase();
      return lowerCandidates.includes(name);
    });
    if (match && match.id && match.name) {
      const prefix = match.animated ? "a" : "";
      return `<${prefix}:${match.name}:${match.id}>`;
    }
  }

  return fallback;
}

type DefaultWelcomeOptions = {
  guild: Guild;
  member: GuildMember;
  socialChannelId?: string | null;
  helpChannelId?: string | null;
};

async function buildDefaultWelcomeMessage(
  options: DefaultWelcomeOptions
): Promise<{ content: string; embeds: EmbedBuilder[] }> {
  const { guild, member, socialChannelId, helpChannelId } = options;
  const content = `<@${member.id}>`;

  const waveEmoji = await resolveGuildEmoji(guild, ["nitro_hand", "nitro-hand", "pawwave"], "👋");
  const checkEmoji = await resolveGuildEmoji(
    guild,
    ["blue_check_mark", "bluecheck", "pawcheck"],
    "✅"
  );
  const includeSocialLine = Boolean(socialChannelId && helpChannelId);
  const linkEmoji = includeSocialLine
    ? await resolveGuildEmoji(guild, ["sociallink", "social_link", "pawlink"], "🔗")
    : null;

  const embed = new EmbedBuilder()
    .setColor(0x22ccaa)
    .setTitle("Welcome to Pawtropolis 🐾")
    .setFooter({ text: "Bot by watchthelight." });

  const botAvatar = guild.client?.user?.displayAvatarURL({ size: 128, forceStatic: false });
  if (botAvatar) {
    embed.setAuthor({ name: "Paw Guardian (Pawtropolis)", iconURL: botAvatar });
  } else {
    embed.setAuthor({ name: "Paw Guardian (Pawtropolis)" });
  }

  const thumbnail = member.displayAvatarURL({ size: 128, forceStatic: false });
  if (thumbnail) {
    embed.setThumbnail(thumbnail);
  }

  const applicantTag = member.user?.tag ?? member.user?.username ?? member.id;
  const descriptionLines = [
    `${waveEmoji} Welcome to Pawtropolis, ${applicantTag}!`,
    `This server now has **${guild.memberCount} Users**!`,
  ];

  if (includeSocialLine && socialChannelId && helpChannelId) {
    const emoji = linkEmoji ?? "🔗";
    descriptionLines.push(
      `${emoji} Be sure to check out our <#${socialChannelId}> or reach out in <#${helpChannelId}>.`
    );
  }

  descriptionLines.push(`${checkEmoji} Enjoy your stay!`, "Pawtropolis Moderation Team");
  embed.setDescription(descriptionLines.join("\n"));

  return { content, embeds: [embed] };
}

function snapshotEmbeds(embeds: EmbedBuilder[]): Array<Record<string, unknown>> {
  return embeds.map((embed) => {
    const json = embed.toJSON();
    const snapshot: Record<string, unknown> = {};
    if (json.title) snapshot.title = json.title;
    if (json.description) snapshot.description = json.description;
    if (json.color !== undefined) snapshot.color = json.color;
    if (json.author?.name) {
      snapshot.author = { name: json.author.name, icon_url: json.author.icon_url };
    }
    if (json.thumbnail?.url) {
      snapshot.thumbnail = { url: json.thumbnail.url };
    }
    if (json.footer?.text) {
      snapshot.footer = { text: json.footer.text };
    }
    if (Array.isArray(json.fields) && json.fields.length > 0) {
      snapshot.fields = json.fields.map((field) => ({
        name: field.name,
        value: field.value,
        inline: field.inline ?? false,
      }));
    }
    return snapshot;
  });
}

export type RenderWelcomeTemplateOptions = {
  template: string | null | undefined;
  guildName: string;
  applicant: {
    id: string;
    tag?: string | null;
    display?: string | null;
  };
};

const WELCOME_TEMPLATE_TOKEN_RE = /\{(applicant\.(?:mention|tag|display)|guild\.name)\}/g;

export function renderWelcomeTemplate(options: RenderWelcomeTemplateOptions): string {
  const base =
    typeof options.template === "string" && options.template.trim().length > 0
      ? options.template
      : DEFAULT_WELCOME_TEMPLATE;

  const applicantTag =
    options.applicant.tag && options.applicant.tag.trim().length > 0
      ? options.applicant.tag
      : options.applicant.id;
  const applicantDisplay =
    options.applicant.display && options.applicant.display.trim().length > 0
      ? options.applicant.display
      : applicantTag;

  return base.replace(WELCOME_TEMPLATE_TOKEN_RE, (token) => {
    switch (token) {
      case "{applicant.mention}":
        return `<@${options.applicant.id}>`;
      case "{applicant.tag}":
        return applicantTag;
      case "{applicant.display}":
        return applicantDisplay;
      case "{guild.name}":
        return options.guildName;
      default:
        return token;
    }
  });
}

export async function postWelcomeMessage(options: {
  guild: Guild;
  generalChannelId: string | null;
  member: GuildMember;
  template: string | null | undefined;
}): Promise<WelcomeResult> {
  const { guild, generalChannelId, member, template } = options;
  if (!generalChannelId) {
    return { ok: false, reason: "missing_channel" };
  }

  let channel: GuildTextBasedChannel;
  try {
    const fetched = await guild.channels.fetch(generalChannelId);
    if (!fetched || !fetched.isTextBased()) {
      return { ok: false, reason: "invalid_channel" };
    }
    channel = fetched as GuildTextBasedChannel;
  } catch (err) {
    return { ok: false, reason: "fetch_failed", error: err };
  }

  const me = guild.members.me;
  if (me) {
    const perms = channel.permissionsFor(me);
    const canView = perms?.has(PermissionFlagsBits.ViewChannel) ?? false;
    const canSend = perms?.has(PermissionFlagsBits.SendMessages) ?? false;
    if (!canView || !canSend) {
      return { ok: false, reason: "missing_permissions" };
    }
  }

  const templateIsString = typeof template === "string";
  const trimmedTemplate = templateIsString ? template.trim() : "";
  const hasCustomTemplate = templateIsString && trimmedTemplate.length > 0;

  if (templateIsString && trimmedTemplate.length === 0) {
    warnInvalidTemplateOnce(guild.id, "empty_template");
  } else if (!templateIsString && template !== null && template !== undefined) {
    warnInvalidTemplateOnce(guild.id, "non_string_template");
  }

  let content = "";
  let embeds: EmbedBuilder[] = [];

  if (hasCustomTemplate) {
    const avatarUrl = member.displayAvatarURL({ size: 128, forceStatic: false }) ?? null;
    if (avatarUrl) {
      embeds.push(new EmbedBuilder().setTitle("Welcome!").setThumbnail(avatarUrl));
    }
    content = renderWelcomeTemplate({
      template,
      guildName: guild.name,
      applicant: {
        id: member.id,
        tag: member.user?.tag ?? member.user.username,
        display: member.displayName,
      },
    });
  } else {
    const payload = await buildDefaultWelcomeMessage({
      guild,
      member,
    });
    content = payload.content;
    embeds = payload.embeds;
  }

  const snapshots = snapshotEmbeds(embeds);

  const basePayload = {
    content,
    allowedMentions: { users: [member.id] },
  };

  const payloadWithEmbeds = embeds.length > 0 ? { ...basePayload, embeds } : basePayload;

  try {
    const message = await channel.send(payloadWithEmbeds);
    const meta = {
      guildId: guild.id,
      channelId: generalChannelId,
      userId: member.id,
      messageId: message.id,
    };
    logger.info(meta, "[welcome] posted");
    logger.debug({ ...meta, embeds: snapshots }, "[welcome] embed snapshot");
    return { ok: true, messageId: message.id };
  } catch (err) {
    if (embeds.length > 0) {
      try {
        const message = await channel.send(basePayload);
        const meta = {
          guildId: guild.id,
          channelId: generalChannelId,
          userId: member.id,
          messageId: message.id,
        };
        logger.info({ ...meta, mode: "fallback_no_embed" }, "[welcome] posted");
        logger.debug({ ...meta, embeds: [] }, "[welcome] embed snapshot");
        return { ok: true, messageId: message.id };
      } catch (fallbackErr) {
        const fallbackReason = isMissingPermissionError(fallbackErr)
          ? "missing_permissions"
          : "send_failed";
        return { ok: false, reason: fallbackReason, error: fallbackErr };
      }
    }
    const reason: WelcomeFailureReason = isMissingPermissionError(err)
      ? "missing_permissions"
      : "send_failed";
    return { ok: false, reason, error: err };
  }
}

function isMissingPermissionError(err: unknown): boolean {
  return (err as { code?: unknown })?.code === 50013;
}

export function buildWelcomeNotice(reason: WelcomeFailureReason): string {
  switch (reason) {
    case "missing_channel":
      return "Welcome message not posted: general channel not configured.";
    case "invalid_channel":
      return "Welcome message not posted: configured general channel is unavailable.";
    case "missing_permissions":
      return "Welcome message not posted: missing permissions in the configured channel.";
    case "fetch_failed":
      return "Welcome message not posted: failed to resolve the configured general channel.";
    case "send_failed":
    default:
      return "Welcome message not posted: failed to send to the configured general channel.";
  }
}

export function logWelcomeFailure(
  reason: WelcomeFailureReason,
  context: { guildId: string; channelId: string | null; error?: unknown }
) {
  const code = (context.error as { code?: unknown })?.code;
  const errInfo =
    context.error instanceof Error
      ? { name: context.error.name, message: context.error.message }
      : undefined;

  const payload: Record<string, unknown> = {
    guildId: context.guildId,
    channelId: context.channelId ?? undefined,
  };
  if (code !== undefined) payload.code = code;
  if (errInfo?.message) payload.message = errInfo.message;
  if (errInfo?.name) payload.errorName = errInfo.name;

  switch (reason) {
    case "missing_channel":
      logger.warn(payload, "[welcome] general channel missing");
      break;
    case "invalid_channel":
      logger.warn(payload, "[welcome] configured general channel unavailable");
      break;
    case "missing_permissions":
      logger.warn(payload, "[welcome] missing permission to send welcome message");
      break;
    case "fetch_failed":
      logger.warn(payload, "[welcome] failed to fetch general channel");
      break;
    case "send_failed":
    default:
      logger.warn(payload, "[welcome] failed to post welcome message");
      break;
  }
}

/**
 * Robustly convert various timestamp formats into Unix seconds (integer) or null.
 * Handles Date objects, milliseconds, seconds, numeric strings, and ISO strings.
 * Returns null for invalid/unparseable inputs.
 */
function toUnixSeconds(value: string | number | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  // Date objects
  if (value instanceof Date) {
    const ms = value.getTime();
    if (!Number.isFinite(ms)) return null;
    return Math.floor(ms / 1000);
  }

  // Numbers (could be seconds or milliseconds)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // Negative timestamps are invalid
    if (value < 0) return null;
    // Heuristic: timestamps > 1e12 are likely milliseconds (>= year 33658)
    // Timestamps between 1e9 and 1e12 are seconds (roughly 2001-33658)
    // Timestamps < 1e9 are likely invalid (before 2001) but we'll allow them
    if (value > 1e12) {
      return Math.floor(value / 1000);
    }
    return Math.floor(value);
  }

  // Strings: try numeric parse first, then ISO date parse
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;

    // Try numeric string first
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
      return toUnixSeconds(numeric);
    }

    // Try ISO string or other date formats
    // SQLite datetime format: "YYYY-MM-DD HH:MM:SS" -> convert to ISO 8601
    const normalized = trimmed.includes(' ') && !trimmed.includes('T')
      ? trimmed.replace(' ', 'T') + 'Z'
      : trimmed;

    const parsed = Date.parse(normalized);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }

    return null;
  }

  return null;
}

export function formatSubmittedFooter(
  submittedAt: string | number | Date | null | undefined,
  codeHex: string
): string | null {
  const seconds = toUnixSeconds(submittedAt);
  if (seconds === null) {
    return null;
  }
  return `Submitted: <t:${seconds}:f> • App #${codeHex}`;
}

function formatTimestamp(value: string | number | null | undefined, style: "f" | "R" | "t" = "R") {
  const seconds = toUnixSeconds(value);
  if (seconds === null) return "unknown";
  return `<t:${seconds}:${style}>`;
}

function truncate(value: string, max = 180) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}.`;
}

function buildStatusField(app: ReviewCardApplication, claim: ReviewClaimRow | null) {
  const action = app.lastAction ?? null;
  const actedAtIso = action?.created_at ?? app.updated_at ?? app.submitted_at ?? app.created_at;
  const actionTime = formatTimestamp(actedAtIso, "t");
  const actorId = action?.moderator_id ?? app.resolver_id ?? null;
  const actorDisplay = actorId ? `<@${actorId}>` : (action?.moderatorTag ?? "unknown reviewer");
  const reason = action?.reason ?? app.resolution_reason ?? undefined;
  const meta = action?.meta ?? null;
  const submittedDisplay = formatTimestamp(app.submitted_at ?? app.created_at, "f");

  const lines: string[] = [];

  switch (app.status) {
    case "submitted": {
      lines.push("Pending review", `Submitted: ${submittedDisplay}`);
      break;
    }
    case "approved": {
      lines.push(`Approved by ${actorDisplay} • ${actionTime}`);
      if (reason) lines.push(`Note: ${truncate(reason, 200)}`);
      break;
    }
    case "rejected": {
      const dmDelivered = meta?.dmDelivered;
      const dmStatus = dmDelivered === false ? "❌" : dmDelivered === true ? "✅" : "❔";
      lines.push(`Rejected by ${actorDisplay} • DM: ${dmStatus} • ${actionTime}`);
      if (reason) lines.push(`Reason: ${truncate(reason, 300)}`);
      break;
    }
    case "kicked": {
      let kickDetail: string | null = null;
      if (meta?.kickSucceeded === false) {
        kickDetail = "Kick failed";
      } else if (meta?.kickSucceeded) {
        kickDetail = "Kick completed";
      }
      lines.push(
        `Kicked by ${actorDisplay} • ${actionTime}${kickDetail ? ` • ${kickDetail}` : ""}`
      );
      if (reason) lines.push(`Reason: ${truncate(reason, 200)}`);
      break;
    }
    default: {
      lines.push(`${app.status} • ${actionTime}`);
      break;
    }
  }

  if (claim) {
    const claimTime = formatTimestamp(claim.claimed_at, "t");
    lines.push(`Claimed by <@${claim.reviewer_id}> • ${claimTime}`);
  }

  return lines.join("\n");
}

function statusColor(status: ApplicationStatus) {
  switch (status) {
    case "approved":
      return 0x57f287;
    case "rejected":
      return 0xed4245;
    case "kicked":
      return 0x992d22;
    case "needs_info":
      return 0xf1c40f;
    case "submitted":
      return 0x5865f2;
    default:
      return 0x2f3136;
  }
}

export function renderReviewEmbed(
  app: ReviewCardApplication,
  answers: ReviewAnswer[],
  flags: string[] = [],
  avatarScan?: AvatarScanRow | null,
  claim?: ReviewClaimRow | null,
  accountCreatedAt?: number | null,
  modmailTicket?: {
    id: number;
    thread_id: string | null;
    status: string;
    log_channel_id: string | null;
    log_message_id: string | null;
  } | null,
  member?: GuildMember | null,
  recentActions?: Array<{
    action: string;
    moderator_id: string;
    reason: string | null;
    created_at: number;
  }> | null
) {
  const code = shortCode(app.id);

  const embed = new EmbedBuilder()
    .setTitle(`New application from @${app.userTag} • App #${code}`)
    .setColor(statusColor(app.status));

  if (app.avatarUrl) {
    embed.setThumbnail(app.avatarUrl);
  }

  // Add footer with unified timestamps (plain text - Discord doesn't render <t:...> in footers)
  if (app.created_at) {
    // Parse app.created_at - could be ISO string or epoch seconds
    const createdEpoch =
      typeof app.created_at === "number"
        ? app.created_at
        : Math.floor(new Date(app.created_at).getTime() / 1000);

    // Use plain text timestamps for footers (not Discord <t:...> tags)
    const abs = formatUtc(createdEpoch);
    const rel = formatRelative(createdEpoch);
    const footerText = `Submitted: ${abs} • ${rel} • App ID: ${app.id.slice(0, 8)}`;
    embed.setFooter({ text: footerText });
  }

  const orderedAnswers = [...answers].sort((a, b) => a.q_index - b.q_index);
  if (orderedAnswers.length === 0) {
    embed.addFields({
      name: "**No responses recorded**",
      value: "_blank_",
      inline: false,
    });
  } else {
    for (const row of orderedAnswers) {
      const value = row.answer.trim().length > 0 ? row.answer : "_blank_";
      embed.addFields({
        name: `**Q${row.q_index + 1}: ${row.question}**`,
        value,
        inline: false,
      });
    }
  }

  embed.addFields({
    name: "Status",
    value: buildStatusField(app, claim ?? null),
    inline: false,
  });

  // Add claim state if claimed
  if (claim) {
    const claimEpoch =
      typeof claim.claimed_at === "number"
        ? claim.claimed_at
        : Math.floor(new Date(claim.claimed_at).getTime() / 1000);
    const claimLine = `*Claimed by <@${claim.reviewer_id}> — ${toDiscordRel(claimEpoch)}*`;

    embed.addFields({
      name: "Claim Status",
      value: claimLine,
      inline: false,
    });
  }

  // Add action history (last 4)
  if (recentActions && recentActions.length > 0) {
    const historyLines = recentActions.map((action) => {
      const actionLabel = action.action;
      const modMention = `<@${action.moderator_id}>`;
      const timeRel = toDiscordRel(action.created_at);
      const timeAbs = toDiscordAbs(action.created_at);

      let line = `• ${actionLabel} by ${modMention} — ${timeRel} (${timeAbs})`;

      // Append reason if exists (truncate to 80 chars for display)
      if (action.reason && action.reason.trim().length > 0) {
        const reasonTrunc =
          action.reason.length > 80 ? action.reason.slice(0, 77) + "..." : action.reason;
        line += ` — "${reasonTrunc}"`;
      }

      return line;
    });

    embed.addFields({
      name: "History (last 4)",
      value: historyLines.join("\n"),
      inline: false,
    });
  } else if (recentActions) {
    // recentActions was fetched but empty
    embed.addFields({
      name: "History (last 4)",
      value: "—",
      inline: false,
    });
  }

  // Add modmail status if exists
  if (modmailTicket) {
    let modmailStatus: string;
    if (modmailTicket.status === "open" && modmailTicket.thread_id) {
      modmailStatus = `[Open thread](https://discord.com/channels/${app.guild_id}/${modmailTicket.thread_id})`;
    } else if (
      modmailTicket.status === "closed" &&
      modmailTicket.log_channel_id &&
      modmailTicket.log_message_id
    ) {
      modmailStatus = `[View log](https://discord.com/channels/${app.guild_id}/${modmailTicket.log_channel_id}/${modmailTicket.log_message_id})`;
    } else if (modmailTicket.status === "closed") {
      modmailStatus = "Closed";
    } else {
      modmailStatus = "No modmail opened";
    }
    embed.addFields({
      name: "Modmail",
      value: modmailStatus,
      inline: true,
    });
  }
  if (
    typeof accountCreatedAt === "number" &&
    Number.isFinite(accountCreatedAt) &&
    accountCreatedAt > 0
  ) {
    const accountSeconds = Math.floor(accountCreatedAt / 1000);
    let accountValue = `Created <t:${accountSeconds}:f> • <t:${accountSeconds}:R>`;

    // Check if member left server
    if (member === null) {
      accountValue += "\n*(Left server)*";
    }

    embed.addFields({
      name: "Account",
      value: accountValue,
      inline: true,
    });
  }

  if (app.avatarUrl) {
    const reverseLink = googleReverseImageUrl(app.avatarUrl);

    if (!GATE_SHOW_AVATAR_RISK) {
      embed.addFields({
        name: "Avatar",
        value: `[Reverse Search Avatar](${reverseLink})`,
      });
    } else {
      const pct = avatarScan?.finalPct ?? 0;
      const furryScore = avatarScan?.furry_score ?? 0;
      const scalieScore = avatarScan?.scalie_score ?? 0;
      const reason = avatarScan?.reason ?? "none";
      const evidenceBuckets = avatarScan?.evidence ?? { hard: [], soft: [], safe: [] };

      const lines: string[] = [
        `NSFW Avatar Chance: **${pct}%**  [Reverse Search Avatar](${reverseLink})`,
      ];

      if (reason !== "hard_evidence" && furryScore > 0.35) {
        lines.push(" Furry traits likely");
      }
      if (reason !== "hard_evidence" && scalieScore > 0.35) {
        lines.push(" Scalie traits likely");
      }

      if (reason !== "none") {
        const evidenceTags = [...evidenceBuckets.hard, ...evidenceBuckets.soft]
          .sort((a, b) => (b.p ?? 0) - (a.p ?? 0))
          .map((entry) => entry.tag)
          .filter((tag, idx, arr) => tag && arr.indexOf(tag) === idx)
          .slice(0, 2);

        if (evidenceTags.length > 0) {
          const reasonLabel = reason.replaceAll("_", " ");
          lines.push(` _Evidence (${reasonLabel}): ${evidenceTags.join(", ")}_`);
        }
      }

      // Add API disclaimer
      lines.push("*Google Vision API - 75% accuracy on NSFW content*");

      embed.addFields({
        name: "Avatar Risk",
        value: lines.join("\n"),
      });
    }
  }

  if (flags.length > 0) {
    embed.addFields({
      name: "Flags",
      value: flags.join("\n"),
    });
  }

  return embed;
}

// show the scary buttons after someone owns it
export function buildDecisionComponents(
  status: ApplicationStatus,
  appId: string,
  userId: string,
  claim: ReviewClaimRow | null,
  messageId?: string
) {
  const terminal = status === "approved" || status === "rejected" || status === "kicked";
  const idSuffix = `code${shortCode(appId)}`;

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (claim && !terminal) {
    const approve = new ButtonBuilder()
      .setCustomId(`v1:decide:approve:${idSuffix}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success);
    const reject = new ButtonBuilder()
      .setCustomId(`v1:decide:reject:${idSuffix}`)
      .setLabel("Reject")
      .setStyle(ButtonStyle.Danger);
    const permReject = new ButtonBuilder()
      .setCustomId(`v1:decide:permreject:${idSuffix}`)
      .setLabel("Permanently Reject")
      .setStyle(ButtonStyle.Danger);
    const kick = new ButtonBuilder()
      .setCustomId(`v1:decide:kick:${idSuffix}`)
      .setLabel("Kick")
      .setStyle(ButtonStyle.Secondary);
    const modmail = new ButtonBuilder()
      .setCustomId(`v1:modmail:open:${idSuffix}${messageId ? `:msg${messageId}` : ""}`)
      .setLabel("Modmail")
      .setStyle(ButtonStyle.Primary);
    const copyUid = new ButtonBuilder()
      .setCustomId(`v1:decide:copyuid:${idSuffix}:user${userId}`)
      .setLabel("Copy UID")
      .setStyle(ButtonStyle.Secondary);
    const pingUnverified = new ButtonBuilder()
      .setCustomId(`v1:ping:${idSuffix}:user${userId}`)
      .setLabel("Ping in Unverified")
      .setStyle(ButtonStyle.Secondary);

    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(approve, reject, permReject, kick)
    );
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(modmail, copyUid, pingUnverified)
    );
  } else if (!terminal) {
    const claimButton = new ButtonBuilder()
      .setCustomId(`v1:decide:claim:${idSuffix}`)
      .setLabel("Claim")
      .setStyle(ButtonStyle.Secondary);
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(claimButton));
  }

  return rows;
}

function parseMeta(raw: string | null | undefined): ReviewActionMeta {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed as ReviewActionMeta;
  } catch (err) {
    logger.warn({ err }, "Failed to parse review action meta");
    return null;
  }
}

function formatUserTag(username: string, discriminator?: string | null) {
  if (discriminator && discriminator !== "0") {
    return `${username}#${discriminator}`;
  }
  return username;
}

async function pingGatekeeperOnNewCard(channel: TextChannel, appId: string) {
  const cfg = getConfig(channel.guildId);
  if (!cfg?.gatekeeper_role_id) return;

  const roleMention = `<@&${cfg.gatekeeper_role_id}>`;
  const code = shortCode(appId);
  const content = `${roleMention} New application #${code} ready for review.`;

  try {
    await channel.send({ content });
    logger.info({ appId, channelId: channel.id }, "[review] gatekeeper ping sent for new card");
  } catch (err) {
    logger.warn(
      { err, appId, channelId: channel.id },
      "[review] failed to ping gatekeeper for new card"
    );
  }
}

export async function ensureReviewMessage(
  client: Client,
  appId: string
): Promise<{ channelId?: string; messageId?: string }> {
  try {
    const appRow = db
      .prepare(
        `
    SELECT
      a.id,
      a.guild_id,
      a.user_id,
      a.status,
      a.created_at,
      a.submitted_at,
      a.updated_at,
      a.resolved_at,
      a.resolver_id,
      a.resolution_reason,
      g.review_channel_id
    FROM application a
    JOIN guild_config g ON g.guild_id = a.guild_id
    WHERE a.id = ?
  `
      )
      .get(appId) as (ReviewCardApplication & { review_channel_id: string | null }) | undefined;
    if (!appRow) {
      throw new Error(`Application ${appId} not found`);
    }
    if (!appRow.review_channel_id) {
      throw new Error(`Guild ${appRow.guild_id} has no review channel configured`);
    }

    const answers = db
      .prepare(
        `
    SELECT q_index, question, answer
    FROM application_response
    WHERE app_id = ?
    ORDER BY q_index ASC
  `
      )
      .all(appId) as ReviewAnswer[];

    const lastActionRow = db
      .prepare(
        `
    SELECT action, moderator_id, reason, message_link, meta, created_at
    FROM review_action
    WHERE app_id = ?
    ORDER BY id DESC
    LIMIT 1
  `
      )
      .get(appId) as
      | {
          action: string; // All action types: approve, reject, perm_reject, claim, kick, copy_uid, etc.
          moderator_id: string;
          reason: string | null;
          meta: string | null;
          created_at: number; // Unix epoch seconds
        }
      | undefined;

    const user = await client.users.fetch(appRow.user_id).catch((err) => {
      logger.warn({ err, userId: appRow.user_id }, "Failed to fetch applicant user");
      return null;
    });
    let accountCreatedAt: number | null = null;
    if (user && typeof user.createdTimestamp === "number") {
      accountCreatedAt = user.createdTimestamp;
    } else if (user) {
      const warnKey = `${appRow.guild_id}:${user.id}`;
      if (!missingAccountAgeWarned.has(warnKey)) {
        missingAccountAgeWarned.add(warnKey);
        logger.warn(
          { guildId: appRow.guild_id, userId: user.id },
          "[review] account age unavailable"
        );
      }
    }

    // Fetch guild member for role information
    const guild = await client.guilds.fetch(appRow.guild_id).catch(() => null);
    const member = guild
      ? await guild.members.fetch(appRow.user_id).catch((err) => {
          logger.debug(
            { err, userId: appRow.user_id },
            "[review] failed to fetch member (may have left)"
          );
          return null;
        })
      : null;

    const reviewChannel = await client.channels.fetch(appRow.review_channel_id).catch((err) => {
      logger.warn({ err, channelId: appRow.review_channel_id }, "Failed to fetch review channel");
      return null;
    });

    if (!reviewChannel || !reviewChannel.isTextBased() || reviewChannel.type === ChannelType.DM) {
      throw new Error(`Review channel ${appRow.review_channel_id} is unavailable`);
    }

    const lastAction: ReviewActionSnapshot | null = lastActionRow
      ? {
          action: lastActionRow.action as ReviewActionKind,
          moderator_id: lastActionRow.moderator_id,
          reason: lastActionRow.reason,
          created_at: lastActionRow.created_at,
          meta: parseMeta(lastActionRow.meta),
        }
      : null;

    if (lastAction) {
      const modUser = await client.users.fetch(lastAction.moderator_id).catch((err) => {
        logger.warn({ err, moderatorId: lastAction.moderator_id }, "Failed to fetch reviewer user");
        return null;
      });
      if (modUser) {
        lastAction.moderatorTag = formatUserTag(modUser.username, modUser.discriminator);
      }
    }

    const avatarUrl = user?.displayAvatarURL({ size: 256 }) ?? undefined;
    const applicantTag = user
      ? formatUserTag(user.username, user.discriminator)
      : `Unknown (${appRow.user_id})`;

    const claim = getClaim(appId);

    const flags: string[] = [];
    if (lastAction?.meta?.dmDelivered === false) {
      flags.push("Applicant DM failed - follow up manually.");
    }
    if (lastAction?.meta?.kickSucceeded === false && lastAction?.action === "kick") {
      flags.push("Kick failed - check permissions.");
    }

    // Check if user was flagged (automatic or manual)
    try {
      const flaggedRow = db
        .prepare(
          `SELECT joined_at, first_message_at, flagged_at, flagged_reason, manual_flag FROM user_activity WHERE guild_id = ? AND user_id = ? AND flagged_at IS NOT NULL`
        )
        .get(appRow.guild_id, appRow.user_id) as
        | {
            joined_at: number;
            first_message_at: number | null;
            flagged_at: number;
            flagged_reason: string | null;
            manual_flag: number;
          }
        | undefined;

      if (flaggedRow) {
        if (flaggedRow.manual_flag === 1) {
          // Manual flag by moderator
          const reason = flaggedRow.flagged_reason || "Manually flagged as a bot";
          flags.push(
            `⚠️ **FLAGGED: Manual Detection** — ${reason} (flagged <t:${flaggedRow.flagged_at}:R>)`
          );
        } else {
          // Automatic flag by Silent-Since-Join detection
          if (flaggedRow.first_message_at) {
            const silentSeconds = flaggedRow.first_message_at - flaggedRow.joined_at;
            const silentDays = Math.floor(silentSeconds / 86400);
            flags.push(
              `⚠️ **FLAGGED: Silent-Since-Join Detection** — This user was silent for **${silentDays} days** before posting their first message (flagged <t:${flaggedRow.flagged_at}:R>).`
            );
          }
        }
      }
    } catch (err) {
      // Gracefully handle missing table (pre-migration databases)
      logger.debug({ err, appId }, "[review] failed to check user_activity for flag status");
    }

    const app: ReviewCardApplication = {
      id: appRow.id,
      guild_id: appRow.guild_id,
      user_id: appRow.user_id,
      status: appRow.status,
      created_at: appRow.created_at,
      submitted_at: appRow.submitted_at,
      updated_at: appRow.updated_at,
      resolved_at: appRow.resolved_at,
      resolver_id: appRow.resolver_id,
      resolution_reason: appRow.resolution_reason,
      userTag: applicantTag,
      avatarUrl,
      lastAction,
    };

    const guildCfg = getConfig(app.guild_id);
    // card first, fancy later
    let avatarScan: ScanResult | null = null;
    try {
      avatarScan = getScan(appId) ?? null;
    } catch (err) {
      logger.warn({ err, appId }, "[review] scan lookup failed; continuing without avatar data");
    }

    // Get modmail ticket status
    const modmailTicket = db
      .prepare(
        `SELECT id, thread_id, status, log_channel_id, log_message_id FROM modmail_ticket WHERE user_id = ? AND guild_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(app.user_id, app.guild_id) as
      | {
          id: number;
          thread_id: string | null;
          status: string;
          log_channel_id: string | null;
          log_message_id: string | null;
        }
      | undefined;

    // Get existing review card mapping (needed for messageId in buttons)
    const mapping = db
      .prepare(`SELECT channel_id, message_id FROM review_card WHERE app_id = ?`)
      .get(appId) as ReviewCardRow | undefined;

    // Fetch recent action history for the card
    const { getRecentActionsForApp } = await import("./review/queries.js");
    const recentActions = getRecentActionsForApp(appId, 4);

    // Defensive logging: warn if history is unexpectedly empty
    if (recentActions.length === 0) {
      const totalActions = db
        .prepare(`SELECT COUNT(*) as count FROM review_action WHERE app_id = ?`)
        .get(appId) as { count: number };
      logger.debug({ appId, totalActions: totalActions.count }, "[review] history_empty");
    }

    // Render embed with observability and Sentry span
    const renderStart = Date.now();
    const { inSpan } = await import("../lib/sentry.js");

    const embed = await inSpan("review.card.render", () => {
      return buildReviewEmbed(app, {
        answers,
        flags,
        avatarScan,
        claim,
        accountCreatedAt: accountCreatedAt ?? undefined,
        modmailTicket,
        member,
        recentActions,
      });
    });

    const renderMs = Date.now() - renderStart;

    logger.info(
      {
        app: appId,
        actions: recentActions.length,
        ms: renderMs,
      },
      "[review] card_render"
    );

    // Components built after message/channel resolution
    let components: ActionRowBuilder<ButtonBuilder>[] = [];

    // Build components
    components = buildActionRows(app, claim);

    const nowIso = new Date().toISOString();
    let message: Message | null = null;

    const channel = reviewChannel as GuildTextBasedChannel;

    if (mapping) {
      message = await channel.messages.fetch(mapping.message_id).catch(() => null);
    }

    const isCreate = !mapping || !message;

    if (message) {
      // Edit existing card - no ping
      await message
        .edit({ embeds: [embed], components, allowedMentions: { parse: [] } })
        .catch((err) => {
          logger.warn({ err, messageId: message?.id }, "Failed to edit review card message");
          throw err;
        });
    } else {
      // Create new card - include one-time Gatekeeper ping (and optionally Bot Dev)
      const code = shortCode(app.id);
      const gatekeeperRoleId = guildCfg?.gatekeeper_role_id ?? "896070888762535969";
      const botDevRoleId = "1120074045883420753";
      const pingDevEnabled = guildCfg?.ping_dev_on_app ?? true; // Default to true

      // Build role mentions and allowedMentions
      const rolesToPing = [gatekeeperRoleId];
      const roleMentions = [`<@&${gatekeeperRoleId}>`];

      if (pingDevEnabled) {
        rolesToPing.push(botDevRoleId);
        roleMentions.push(`<@&${botDevRoleId}>`);
      }

      const content = `${roleMentions.join(" ")} New application from <@${app.user_id}> • App #${code}`;

      message = await channel
        .send({
          content,
          embeds: [embed],
          components,
          allowedMentions: { parse: [], roles: rolesToPing },
        })
        .catch((err) => {
          logger.warn({ err, channelId: channel.id }, "Failed to send review card message");
          throw err;
        });

      logger.info({
        gatekeeperRoleId,
        botDevRoleId: pingDevEnabled ? botDevRoleId : null,
        guildId: app.guild_id,
        code
      }, "[review] role pings sent");
    }

    const upsert = db.transaction((row: ReviewCardRow | undefined, msg: Message) => {
      if (row) {
        db.prepare(
          `
        UPDATE review_card
        SET channel_id = ?, message_id = ?, updated_at = ?
        WHERE app_id = ?
      `
        ).run(msg.channelId, msg.id, nowIso, appId);
      } else {
        db.prepare(
          `
        INSERT INTO review_card (app_id, channel_id, message_id, updated_at)
        VALUES (?, ?, ?, ?)
      `
        ).run(appId, msg.channelId, msg.id, nowIso);
      }
    });

    upsert(mapping, message);
    return { channelId: message.channelId, messageId: message.id };
  } catch (err) {
    // Never block the flow on review card errors
    logger.error({ err, appId }, "[review] ensureReviewMessage failed");
    captureException(err, { area: "review:ensureReviewMessage", appId });
    // Return minimal response so downstream refreshes don't explode
    return {};
  }
}

/**
 * Handle "Ping in Unverified" button
 * Posts a ping in the unverified channel, replies ephemerally with link
 * Auto-deletes after 30s (staff can also delete manually via button)
 */
export async function handlePingInUnverified(interaction: ButtonInteraction) {
  const legacy = /^v1:ping:(.+)$/.exec(interaction.customId);
  const modern = /^review:ping_unverified:code([0-9A-F]{6})(?::user(\d+))?$/.exec(interaction.customId);
  if (!legacy && !modern) return;

  if (!interaction.guildId || !interaction.guild) {
    await replyOrEdit(interaction, { content: "Guild only." }).catch(() => undefined);
    return;
  }

  // Check staff permissions
  const member = interaction.member as GuildMember | null;
  if (!isStaff(interaction.guildId, member)) {
    await replyOrEdit(interaction, {
      content: "You do not have permission for this.",
    }).catch(() => undefined);
    return;
  }

  await ensureDeferred(interaction);

  let userId: string | null = null;
  if (modern) {
    userId = modern[2] ?? null;
  } else {
    const [, payload] = legacy!;
    const userMatch = /user([0-9]+)/.exec(payload);
    userId = userMatch ? userMatch[1] : null;
  }

  if (!userId) {
    await replyOrEdit(interaction, { content: "Invalid ping button data." }).catch(() => undefined);
    return;
  }
  const cfg = getConfig(interaction.guildId);

  if (!cfg?.unverified_channel_id) {
    await replyOrEdit(interaction, {
      content: "Unverified channel not configured. Run `/gate setup` to configure it.",
    }).catch(() => undefined);
    return;
  }

  try {
    // Fetch the unverified channel
    const channel = await interaction.guild.channels.fetch(cfg.unverified_channel_id);
    if (!channel || !channel.isTextBased()) {
      await replyOrEdit(interaction, {
        content: "Unverified channel is not a valid text channel.",
      }).catch(() => undefined);
      return;
    }

    // Check bot permissions
    const me = interaction.guild.members.me;
    const missingPerms: string[] = [];
    let canManage = false;

    if (me) {
      const perms = channel.permissionsFor(me);
      const canView = perms?.has(PermissionFlagsBits.ViewChannel) ?? false;
      const canSend = perms?.has(PermissionFlagsBits.SendMessages) ?? false;
      const canEmbed = perms?.has(PermissionFlagsBits.EmbedLinks) ?? false;
      canManage = perms?.has(PermissionFlagsBits.ManageMessages) ?? false;

      if (!canView) missingPerms.push("ViewChannel");
      if (!canSend) missingPerms.push("SendMessages");
      if (!canEmbed) missingPerms.push("EmbedLinks");

      // Critical permissions - cannot proceed
      if (missingPerms.length > 0) {
        logger.warn(
          { guildId: interaction.guildId, channelId: channel.id, missingPerms },
          "[review] cannot ping unverified: missing critical permissions"
        );
        await replyOrEdit(interaction, {
          content: `❌ Bot is missing required permissions in <#${cfg.unverified_channel_id}>: **${missingPerms.join(", ")}**\n\nPlease check channel permissions.`,
        }).catch(() => undefined);
        return;
      }

      // Warn if ManageMessages is missing (auto-delete won't work)
      if (!canManage) {
        logger.warn(
          { guildId: interaction.guildId, channelId: channel.id },
          "[review] ping will be sent but cannot auto-delete (missing ManageMessages)"
        );
      }
    }

    // Post the ping message
    // WHY: Notifies user in unverified channel; auto-deletes to keep channel clean
    // SAFETY: allowedMentions restricted to only the target user (no @everyone/@here risk)
    const pingMessage = await channel.send({
      content: `<@${userId}>`,
      allowedMentions: { users: [userId], parse: [] }, // ONLY mention the specific user, no mass pings
    });

    // Schedule auto-deletion after 30 seconds (only if bot has ManageMessages permission)
    // WHY: Keeps channel clean while giving user time to see notification
    // SAFETY: Gracefully handles races and permission errors
    if (canManage) {
      autoDelete(pingMessage, 30_000);
    }

    // Reply with link
    const messageUrl = `https://discord.com/channels/${interaction.guildId}/${channel.id}/${pingMessage.id}`;
    const deleteNote = canManage
      ? "The ping will auto-delete after 30 seconds."
      : "⚠️ Bot lacks ManageMessages permission - ping will not auto-delete.";

    await replyOrEdit(interaction, {
      content: `✅ Ping posted: ${messageUrl}\n\n${deleteNote}`,
    }).catch(() => undefined);

    logger.info(
      {
        userId,
        channelId: channel.id,
        messageId: pingMessage.id,
        moderatorId: interaction.user.id,
        autoDelete: canManage,
      },
      `[review] ping posted in unverified${canManage ? " (auto-deletes after 30s)" : " (no auto-delete)"}`
    );
  } catch (err) {
    const isPermissionError =
      err && typeof err === "object" && "code" in err && (err.code === 50013 || err.code === "50013");

    logger.error(
      {
        err,
        userId,
        guildId: interaction.guildId,
        channelId: cfg.unverified_channel_id,
        isPermissionError,
      },
      "[review] failed to post ping in unverified"
    );

    captureException(err, {
      area: "review:pingInUnverified",
      userId,
      guildId: interaction.guildId,
      channelId: cfg.unverified_channel_id,
    });

    // Provide helpful error message
    let errorMsg = "❌ Failed to post ping in unverified channel.";
    if (isPermissionError) {
      errorMsg +=
        "\n\n**Cause:** Bot is missing permissions in the unverified channel.\n**Fix:** Check channel permissions and ensure the bot has ViewChannel, SendMessages, and EmbedLinks.";
    } else {
      errorMsg += "\n\nCheck bot logs for details.";
    }

    await replyOrEdit(interaction, { content: errorMsg }).catch(() => undefined);
  }
}

/**
 * handleDeletePing
 * WHAT: Deletes a ping message posted in the unverified channel.
 * WHY: Allows staff to clean up ping notifications once user has been notified.
 * DOCS:
 *  - Message.delete: https://discord.js.org/#/docs/discord.js/main/class/Message?scrollTo=delete
 */
export async function handleDeletePing(interaction: ButtonInteraction) {
  const match = /^v1:ping:delete:(.+)$/.exec(interaction.customId);
  if (!match) return;

  if (!interaction.guildId || !interaction.guild) {
    await interaction
      .reply({ content: "Guild only.", flags: MessageFlags.Ephemeral })
      .catch(() => undefined);
    return;
  }

  // Check staff permissions
  const member = interaction.member as GuildMember | null;
  if (!isStaff(interaction.guildId, member)) {
    await interaction
      .reply({
        content: "You do not have permission for this.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined);
    return;
  }

  const [, messageId] = match;

  try {
    // Delete the ping message
    // DOCS: https://discord.js.org/#/docs/discord.js/main/class/Message?scrollTo=delete
    await interaction.message.delete();

    // Acknowledge the deletion ephemerally (can't update a deleted message)
    await interaction
      .reply({
        content: "Ping deleted.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined);

    logger.info(
      { messageId, moderatorId: interaction.user.id, guildId: interaction.guildId },
      "[review] ping message deleted by staff"
    );
  } catch (err) {
    logger.warn({ err, messageId }, "[review] failed to delete ping message");
    await interaction
      .reply({
        content: "Failed to delete ping message (it may have been already deleted).",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined);
  }
}
