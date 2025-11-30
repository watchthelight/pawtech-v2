/**
 * Pawtropolis Tech -- src/features/review/card.ts
 * WHAT: Review card rendering, button components, and card lifecycle management.
 * WHY: Centralizes all review card display logic for the moderation interface.
 * FLOWS:
 *  - renderReviewEmbed(): builds the embed with application data, answers, flags, history
 *  - buildDecisionComponents(): builds action button rows based on claim/status
 *  - ensureReviewMessage(): creates or updates the review card in Discord
 * DOCS:
 *  - Discord Embeds: https://discord.js.org/#/docs/discord.js/main/class/EmbedBuilder
 *  - Action Rows: https://discord.js.org/#/docs/discord.js/main/class/ActionRowBuilder
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  type Client,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type TextChannel,
} from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { captureException } from "../../lib/sentry.js";
import { getConfig } from "../../lib/config.js";
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";
import { getScan, googleReverseImageUrl, type ScanResult } from "../avatarScan.js";
import { GATE_SHOW_AVATAR_RISK } from "../../lib/env.js";
import { shortCode } from "../../lib/ids.js";
import { formatUtc, formatRelative } from "../../lib/time.js";
import { toDiscordAbs, toDiscordRel } from "../../lib/timefmt.js";
import {
  buildReviewEmbedV3 as buildReviewEmbed,
  buildActionRowsV2 as buildActionRows,
} from "../../ui/reviewCard.js";

import type {
  ApplicationStatus,
  ReviewAnswer,
  ReviewActionMeta,
  ReviewActionKind,
  ReviewActionSnapshot,
  ReviewClaimRow,
  ReviewCardApplication,
  ReviewCardRow,
  AvatarScanRow,
} from "./types.js";
import { getClaim } from "./claims.js";

// ===== Constants =====

// In-memory set to track warned users for missing account age
// Design: Prevents log spam when the same user's account age is unavailable across multiple card renders.
// Now bounded with LRU-style eviction to prevent memory growth in long-running bot instances.
const MAX_WARNED_SET_SIZE = 10000;
const missingAccountAgeWarned = new Set<string>();

// Bounded add helper - evicts oldest entries when set grows too large
function addToBoundedSet(set: Set<string>, value: string, maxSize: number): void {
  if (set.size >= maxSize) {
    // Evict oldest entries (first 10% of the set) - Set maintains insertion order
    const entriesToDelete = Math.ceil(maxSize * 0.1);
    let deleted = 0;
    for (const item of set) {
      if (deleted >= entriesToDelete) break;
      set.delete(item);
      deleted++;
    }
    logger.debug(
      { setSize: set.size, evicted: deleted },
      "[review] bounded set eviction triggered"
    );
  }
  set.add(value);
}

// ===== Helper Functions =====

/**
 * Robustly convert various timestamp formats into Unix seconds (integer) or null.
 * Handles Date objects, milliseconds, seconds, numeric strings, and ISO strings.
 * Returns null for invalid/unparseable inputs.
 *
 * Heuristic for ms vs s: values > 1e12 are treated as milliseconds (that's year 33658+ in seconds).
 * Edge case: SQLite datetime strings ("YYYY-MM-DD HH:MM:SS") are normalized to ISO 8601 before parsing.
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
      lines.push(`Approved by ${actorDisplay} * ${actionTime}`);
      if (reason) lines.push(`Note: ${truncate(reason, 200)}`);
      break;
    }
    case "rejected": {
      const dmDelivered = meta?.dmDelivered;
      const dmStatus = dmDelivered === false ? "X" : dmDelivered === true ? "OK" : "?";
      lines.push(`Rejected by ${actorDisplay} * DM: ${dmStatus} * ${actionTime}`);
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
        `Kicked by ${actorDisplay} * ${actionTime}${kickDetail ? ` * ${kickDetail}` : ""}`
      );
      if (reason) lines.push(`Reason: ${truncate(reason, 200)}`);
      break;
    }
    default: {
      lines.push(`${app.status} * ${actionTime}`);
      break;
    }
  }

  if (claim) {
    const claimTime = formatTimestamp(claim.claimed_at, "t");
    lines.push(`Claimed by <@${claim.reviewer_id}> * ${claimTime}`);
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

// Discord's discriminator migration (2023): new users have discriminator "0".
// Legacy users may still have 4-digit discriminators. This formats correctly for both.
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

// ===== Main Exports =====

/**
 * renderReviewEmbed
 * WHAT: Builds the review card embed with all application data.
 * WHY: Central rendering function for consistent review card display.
 * PARAMS: Application data, answers, flags, avatar scan, claim status, account age, modmail ticket, member, action history
 */
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
    const footerText = `Submitted: ${abs} * ${rel} * App ID: ${app.id.slice(0, 8)}`;
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
    const claimLine = `*Claimed by <@${claim.reviewer_id}> -- ${toDiscordRel(claimEpoch)}*`;

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

      let line = `* ${actionLabel} by ${modMention} -- ${timeRel} (${timeAbs})`;

      // Append reason if exists (truncate to 80 chars for display)
      if (action.reason && action.reason.trim().length > 0) {
        const reasonTrunc =
          action.reason.length > 80 ? action.reason.slice(0, 77) + "..." : action.reason;
        line += ` -- "${reasonTrunc}"`;
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
      value: "--",
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
        `NSFW Avatar Chance: **${pct}%**  [Reverse Search Avatar](${reverseLink})`,
      ];

      if (reason !== "hard_evidence" && furryScore > 0.35) {
        lines.push(" Furry traits likely");
      }
      if (reason !== "hard_evidence" && scalieScore > 0.35) {
        lines.push(" Scalie traits likely");
      }

      if (reason !== "none") {
        const evidenceTags = [...evidenceBuckets.hard, ...evidenceBuckets.soft]
          .sort((a, b) => (b.p ?? 0) - (a.p ?? 0))
          .map((entry) => entry.tag)
          .filter((tag, idx, arr) => tag && arr.indexOf(tag) === idx)
          .slice(0, 2);

        if (evidenceTags.length > 0) {
          const reasonLabel = reason.replaceAll("_", " ");
          lines.push(` _Evidence (${reasonLabel}): ${evidenceTags.join(", ")}_`);
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

/**
 * buildDecisionComponents
 * WHAT: Builds the action button rows for review cards.
 * WHY: Button layout depends on claim status and application state.
 * DESIGN:
 *  - Unclaimed apps get "Claim" only
 *  - Claimed apps get full action row (Approve/Reject/Kick/etc)
 *  - Terminal states get no buttons - the card becomes read-only
 *  - Force claim-first workflow prevents accidental actions and provides audit trail
 */
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

/**
 * ensureReviewMessage
 * WHAT: Central function for review card lifecycle management.
 * WHY: Creates card if missing, edits if exists. Handles all the data fetching.
 * RETURNS: Object with channelId and messageId, or empty object on error.
 * PERFORMANCE: Makes multiple Discord API calls and DB queries. Consider caching for high-traffic servers.
 */
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
        addToBoundedSet(missingAccountAgeWarned, warnKey, MAX_WARNED_SET_SIZE);
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
            `WARNING **FLAGGED: Manual Detection** -- ${reason} (flagged <t:${flaggedRow.flagged_at}:R>)`
          );
        } else {
          // Automatic flag by Silent-Since-Join detection
          if (flaggedRow.first_message_at) {
            const silentSeconds = flaggedRow.first_message_at - flaggedRow.joined_at;
            const silentDays = Math.floor(silentSeconds / 86400);
            flags.push(
              `WARNING **FLAGGED: Silent-Since-Join Detection** -- This user was silent for **${silentDays} days** before posting their first message (flagged <t:${flaggedRow.flagged_at}:R>).`
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

    // Fetch recent action history for the card (show last 7)
    const { getRecentActionsForApp } = await import("./queries.js");
    const recentActions = getRecentActionsForApp(appId, 7);

    // Fetch all previous applications from this user for history display
    const previousApps = db.prepare(`
      SELECT id, status, submitted_at, resolved_at, resolution_reason
      FROM application
      WHERE guild_id = ? AND user_id = ?
      ORDER BY submitted_at DESC
    `).all(appRow.guild_id, appRow.user_id) as Array<{
      id: string;
      status: string;
      submitted_at: string | null;
      resolved_at: string | null;
      resolution_reason: string | null;
    }>;

    // Calculate which number application this is (1st, 2nd, etc.)
    const appIndex = previousApps.findIndex(a => a.id === appId);
    const appNumber = previousApps.length - appIndex; // Oldest is #1

    // Defensive logging: warn if history is unexpectedly empty
    if (recentActions.length === 0) {
      const totalActions = db
        .prepare(`SELECT COUNT(*) as count FROM review_action WHERE app_id = ?`)
        .get(appId) as { count: number };
      logger.debug({ appId, totalActions: totalActions.count }, "[review] history_empty");
    }

    // Render embed with observability and Sentry span
    const renderStart = Date.now();
    const { inSpan } = await import("../../lib/sentry.js");

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
        previousApps,
        appNumber,
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

    // Build components - disable actions if member has left server
    components = buildActionRows(app, claim, { memberHasLeft: member === null });

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
        .edit({ embeds: [embed], components, allowedMentions: SAFE_ALLOWED_MENTIONS })
        .catch((err) => {
          logger.warn({ err, messageId: message?.id }, "Failed to edit review card message");
          throw err;
        });
    } else {
      // Create new card - include one-time Gatekeeper ping
      const code = shortCode(app.id);
      const gatekeeperRoleId = guildCfg?.gatekeeper_role_id;

      // Build role mentions and allowedMentions
      const rolesToPing: string[] = [];
      const roleMentions: string[] = [];

      if (gatekeeperRoleId) {
        rolesToPing.push(gatekeeperRoleId);
        roleMentions.push(`<@&${gatekeeperRoleId}>`);
      }

      const mentionPrefix = roleMentions.length > 0 ? `${roleMentions.join(" ")} ` : "";
      const content = `${mentionPrefix}New application from <@${app.user_id}> • App #${code}`;

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
        gatekeeperRoleId: gatekeeperRoleId ?? null,
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
