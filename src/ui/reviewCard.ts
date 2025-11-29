/**
 * Review Card UI Builder (Q&A Code Block Format)
 * Generates Discord embeds and action rows for application reviews
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type GuildMember,
  type ChatInputCommandInteraction,
  type AttachmentBuilder,
} from "discord.js";
import { shortCode } from "../lib/ids.js";
import { formatAbsolute, formatAbsoluteUtc, fmtAgeShort, toDiscordAbs, toDiscordRel } from "../lib/timefmt.js";
import { ts } from "../utils/dt.js";

// ============================================================================
// Types
// ============================================================================

export type ApplicationStatus = "draft" | "submitted" | "approved" | "rejected" | "needs_info" | "kicked";

export interface ReviewCardApplication {
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
}

export interface ReviewAnswer {
  q_index: number;
  question: string;
  answer: string;
}

export interface AvatarScanRow {
  finalPct: number;
  furryScore: number;
  scalieScore: number;
  reason: string;
  evidence: {
    hard: Array<{ tag: string; p?: number }>;
    soft: Array<{ tag: string; p?: number }>;
    safe: Array<{ tag: string; p?: number }>;
  };
}

export interface ReviewClaimRow {
  reviewer_id: string;
  claimed_at: string | number; // string (ISO) from DB, or number (epoch seconds) after conversion
}

export interface ModmailTicket {
  id: number;
  thread_id: string | null;
  status: string;
  log_channel_id: string | null;
  log_message_id: string | null;
}

export interface ReviewAction {
  action: string;
  moderator_id: string;
  reason: string | null;
  created_at: number;
}

export interface PreviousApplication {
  id: string;
  status: string;
  submitted_at: string | null;
  resolved_at: string | null;
  resolution_reason: string | null;
}

export interface BuildEmbedOptions {
  answers?: ReviewAnswer[];
  flags?: string[];
  avatarScan?: AvatarScanRow | null;
  claim?: ReviewClaimRow | null;
  accountCreatedAt?: number | null;
  modmailTicket?: ModmailTicket | null;
  member?: GuildMember | null;
  recentActions?: ReviewAction[] | null;
  previousApps?: PreviousApplication[] | null;
  appNumber?: number | null;
  isSample?: boolean;
  reasonAttachment?: AttachmentBuilder | null;
}

// ============================================================================
// Color Palette
// ============================================================================

const COLORS = {
  primary: 0x1e293b, // slate-800
  ok: 0x10b981, // green-500
  err: 0xef4444, // red-500
  muted: 0x94a3b8, // slate-400
  warning: 0xf97316, // orange-500
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Escape markdown characters to prevent abuse
 */
export function escapeMd(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/~/g, "\\~")
    .replace(/`/g, "\\`")
    .replace(/\|/g, "\\|")
    .replace(/>/g, "\\>")
    .replace(/@/g, "@\u200b"); // zero-width space to prevent mentions
}

/**
 * Wrap text in code block with word wrapping at specified width
 */
export function wrapCode(text: string, width: number = 72): string {
  if (!text || text.trim().length === 0) return "```text\n(no response)\n```";

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    // If word itself is longer than width, split it
    if (word.length > width) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }
      // Split long word into chunks
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }

    // Check if adding this word would exceed width
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length > width) {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return "```text\n" + lines.join("\n") + "\n```";
}

/**
 * Truncate answer with indicator
 */
export function truncateAnswer(text: string, maxLen: number = 200): string {
  if (!text) return "(no response)";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + " (truncated)";
}

/**
 * Format timestamp as relative (e.g., "2h ago")
 */
export function fmtRel(epochSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  return fmtAgeShort(epochSec, now);
}

/**
 * Parse claimed_at timestamp from database (handles multiple formats)
 * Supports: Unix timestamps (numeric strings), SQLite datetime, ISO 8601
 */
function parseClaimedAt(value: string | number): number | null {
  if (typeof value === 'number') {
    return value; // Already in seconds
  }

  const trimmed = value.trim();

  // Try parsing as numeric string first (e.g., "1764002084.0")
  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
    // Heuristic: > 1e12 is milliseconds, otherwise seconds
    return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }

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

/**
 * Format timestamp as UTC string
 */
export function fmtUtc(epochSec: number): string {
  return formatAbsoluteUtc(epochSec);
}

/**
 * Format local date
 */
export function fmtLocal(epochSec: number): string {
  const date = new Date(epochSec * 1000);
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Get status color for embed
 */
export function getStatusColor(status: ApplicationStatus): number {
  switch (status) {
    case "approved":
      return COLORS.ok;
    case "rejected":
    case "kicked":
      return COLORS.err;
    default:
      return COLORS.primary;
  }
}

/**
 * Get embed color considering both status and member presence
 * Returns orange if member has left (regardless of status)
 */
export function getEmbedColor(status: ApplicationStatus, memberHasLeft: boolean): number {
  // If member has left, always show orange warning
  if (memberHasLeft) {
    return COLORS.warning;
  }
  return getStatusColor(status);
}

/**
 * Format Discord timestamp tag
 * Formats: F = Full date/time, R = Relative, f = Short date/time
 */
export function discordTimestamp(epochSec: number, format: "F" | "f" | "R" = "R"): string {
  return `<t:${epochSec}:${format}>`;
}

/**
 * Google reverse image search URL
 */
export function googleReverseImageUrl(avatarUrl: string): string {
  return `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(avatarUrl)}`;
}

export function buildActionRowsV2(
  app: ReviewCardApplication,
  claim: ReviewClaimRow | null,
  options: { memberHasLeft?: boolean } = {}
): ActionRowBuilder<ButtonBuilder>[] {
  const { memberHasLeft = false } = options;
  const terminal = app.status === "approved" || app.status === "rejected" || app.status === "kicked";
  const idSuffix = `code${shortCode(app.id)}`;
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  // If member has left server, disable all review actions
  // They must re-apply when they rejoin
  if (memberHasLeft && !terminal) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`review:reject:${idSuffix}`)
        .setLabel("Reject (Member Left)")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`review:copy_uid:${idSuffix}:user${app.user_id}`)
        .setLabel("Copy UID")
        .setStyle(ButtonStyle.Secondary)
    );
    rows.push(row);
    return rows;
  }

  if (claim && !terminal) {
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`review:accept:${idSuffix}`).setLabel("Accept").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`review:reject:${idSuffix}`).setLabel("Reject").setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`review:perm_reject:${idSuffix}`)
        .setLabel("Perm Reject")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`review:kick:${idSuffix}`).setLabel("Kick").setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`review:modmail:${idSuffix}`).setLabel("Modmail").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`review:copy_uid:${idSuffix}:user${app.user_id}`)
        .setLabel("Copy UID")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`review:ping_unverified:${idSuffix}:user${app.user_id}`)
        .setLabel("Ping in Unverified")
        .setStyle(ButtonStyle.Secondary)
    );
    rows.push(row1, row2);
  } else if (!terminal) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`review:claim:${idSuffix}`).setLabel("Claim Application").setStyle(ButtonStyle.Primary)
      )
    );
  }

  return rows;
}

/**
 * Estimate embed size for Discord limits
 */
function estimateEmbedSize(embed: EmbedBuilder): number {
  let size = 0;

  if (embed.data.title) size += embed.data.title.length;
  if (embed.data.description) size += embed.data.description.length;
  if (embed.data.footer?.text) size += embed.data.footer.text.length;

  if (embed.data.fields) {
    for (const field of embed.data.fields) {
      size += field.name.length + field.value.length;
    }
  }

  return size;
}

// ============================================================================
// Visual Design Constants
// ============================================================================

// Use heavy box-drawing character to avoid Discord hyphen rendering bug
const DIVIDER = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
// Zero-width space for empty lines (prevents Discord auto-hyphen)
const EMPTY = "\u200b";

// Status badges with emoji
const STATUS_BADGE = {
  approved: "✅ **Approved**",
  rejected: "❌ **Rejected**",
  kicked: "🚫 **Kicked**",
  submitted: "⏳ **Pending Review**",
  draft: "📝 **Draft**",
  needs_info: "❓ **Needs Info**",
} as const;

// Action icons for history timeline
const ACTION_ICONS = {
  approve: "✅",
  reject: "❌",
  kick: "🚫",
  claim: "📋",
  unclaim: "📤",
  perm_reject: "⛔",
  copy_uid: "📎",
  ping: "🔔",
  modmail: "✉️",
} as const;

/**
 * Get risk badge with color indicator
 */
function getRiskBadge(pct: number): string {
  if (pct >= 50) return `🔴 **${pct}%** High Risk`;
  if (pct >= 25) return `🟡 **${pct}%** Medium Risk`;
  if (pct > 0) return `🟢 **${pct}%** Low Risk`;
  return `✅ **${pct}%** Clean`;
}

/**
 * Format action verb with icon
 */
function formatActionWithIcon(action: string): string {
  const normalized = action.toLowerCase().replace(/\s+/g, "_");
  const icon = ACTION_ICONS[normalized as keyof typeof ACTION_ICONS] || "•";
  const verb = action.replace(/_/g, " ");
  return `${icon} ${verb}`;
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, 4th, etc.)
 */
function getOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ============================================================================
// Mobile-first builder (V3) — consolidates all content into description
// ============================================================================

export function buildReviewEmbedV3(
  app: ReviewCardApplication,
  opts: BuildEmbedOptions = {}
): EmbedBuilder {
  const {
    answers = [],
    flags = [],
    avatarScan = null,
    claim = null,
    accountCreatedAt = null,
    modmailTicket = null,
    member = null,
    recentActions = null,
    previousApps = null,
    appNumber = null,
    isSample = false,
  } = opts;

  const code = shortCode(app.id);
  const username = app.userTag.replace(/@/g, "@\u200b");
  const submittedDate = app.submitted_at ? new Date(app.submitted_at) : new Date(app.created_at);

  // Format title with application number if available
  const appNumStr = appNumber ? ` (${getOrdinal(appNumber)} Application)` : "";
  const embed = new EmbedBuilder()
    .setTitle(`New Application • ${username} • App #${code}${appNumStr}`)
    .setColor(getEmbedColor(app.status, member === null));
  if (app.avatarUrl) embed.setThumbnail(app.avatarUrl);

  const lines: string[] = [];

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION: Alerts & Flags (if any)
  // ═══════════════════════════════════════════════════════════════════════════
  if (member === null || flags.length > 0) {
    if (member === null) {
      lines.push("⚠️ **ALERT: Member has left the server**");
    }
    for (const flag of flags) {
      lines.push(flag);
    }
    lines.push(EMPTY);
    lines.push(DIVIDER);
    lines.push(EMPTY);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION: Decision (only for resolved applications)
  // ═══════════════════════════════════════════════════════════════════════════
  if (app.status === "approved" || app.status === "rejected" || app.status === "kicked") {
    const badge = STATUS_BADGE[app.status] || app.status;
    lines.push(`**Decision**`);
    lines.push(badge);

    if (app.resolution_reason) {
      const label = app.status === "approved" ? "Note" : "Reason";
      lines.push(EMPTY);
      lines.push(`**${label}**`);
      // Use quote block instead of code block for cleaner look
      const reasonLines = app.resolution_reason.split("\n");
      for (const line of reasonLines) {
        lines.push(`> ${line}`);
      }
    }
    lines.push(EMPTY);
    lines.push(DIVIDER);
    lines.push(EMPTY);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION: Application Info (grouped metadata)
  // ═══════════════════════════════════════════════════════════════════════════
  lines.push("**Application**");
  lines.push(`**Applicant:**  <@${app.user_id}>`);
  lines.push(`**Submitted:**  ${ts(submittedDate, 'f')} • ${ts(submittedDate, 'R')}`);

  // Claim status
  if (claim) {
    const claimEpoch = parseClaimedAt(claim.claimed_at);
    if (claimEpoch) {
      const claimTs = claimEpoch * 1000;
      lines.push(`**Claimed by:**  <@${claim.reviewer_id}> • ${ts(claimTs, 'R')}`);
    } else {
      lines.push(`**Claimed by:**  <@${claim.reviewer_id}>`);
    }
  } else {
    lines.push(`**Claimed by:** Unclaimed`);
  }

  // Account age
  if (typeof accountCreatedAt === 'number' && Number.isFinite(accountCreatedAt) && accountCreatedAt > 0) {
    lines.push(`**Account created:**  ${ts(accountCreatedAt, 'f')} • ${ts(accountCreatedAt, 'R')}`);
  }

  lines.push(EMPTY);
  lines.push(DIVIDER);
  lines.push(EMPTY);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION: Status (modmail, member, avatar)
  // ═══════════════════════════════════════════════════════════════════════════
  lines.push("**Status**");

  // Modmail status with icon
  if (modmailTicket) {
    if (modmailTicket.status === "open" && modmailTicket.thread_id) {
      lines.push(`✉️ **Modmail:** [Open Thread](https://discord.com/channels/${app.guild_id}/${modmailTicket.thread_id})`);
    } else if (modmailTicket.status === "closed" && modmailTicket.log_channel_id && modmailTicket.log_message_id) {
      lines.push(`📨 **Modmail:** [View Log](https://discord.com/channels/${app.guild_id}/${modmailTicket.log_channel_id}/${modmailTicket.log_message_id})`);
    } else if (modmailTicket.status === "closed") {
      lines.push("📨 **Modmail:** Closed");
    } else {
      lines.push("✉️ **Modmail:** Open");
    }
  } else {
    lines.push("📭 **Modmail:** None");
  }

  // Member status with icon
  const memberIcon = member === null ? "🚪" : "✅";
  const memberStatus = member === null ? "Left server" : "In server";
  lines.push(`${memberIcon} **Member status:** ${memberStatus}`);

  // Avatar risk with colored badge
  if (avatarScan) {
    const pct = avatarScan.finalPct ?? 0;
    const reverse = app.avatarUrl ? googleReverseImageUrl(app.avatarUrl) : "#";
    const riskBadge = getRiskBadge(pct);
    lines.push(`🖼️ **Avatar risk:** ${riskBadge} • [Reverse Search](${reverse})`);
    lines.push("-# *NSFW Detection API is ~75% Accurate. Always manually verify.*");
  }

  lines.push(EMPTY);
  lines.push(DIVIDER);
  lines.push(EMPTY);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION: Application History (all past applications from this user)
  // ═══════════════════════════════════════════════════════════════════════════
  if (previousApps && previousApps.length > 1) {
    // Only show if there are other applications besides this one
    const otherApps = previousApps.filter(a => a.id !== app.id);
    if (otherApps.length > 0) {
      lines.push(`**Application History** (${previousApps.length} total)`);
      for (const pastApp of otherApps) {
        const statusIcon = pastApp.status === 'approved' ? '✅' :
                          pastApp.status === 'rejected' ? '❌' :
                          pastApp.status === 'kicked' ? '🚫' :
                          pastApp.status === 'submitted' ? '⏳' : '📝';
        const appCode = shortCode(pastApp.id);
        const submittedTs = pastApp.submitted_at ? new Date(pastApp.submitted_at) : null;
        const timeStr = submittedTs ? ts(submittedTs, 'R') : 'unknown';
        let line = `${statusIcon} #${appCode} • ${pastApp.status} • ${timeStr}`;
        if (pastApp.resolution_reason) {
          const truncatedReason = pastApp.resolution_reason.length > 50
            ? pastApp.resolution_reason.slice(0, 47) + '...'
            : pastApp.resolution_reason;
          line += ` — "${truncatedReason}"`;
        }
        lines.push(line);
      }
      lines.push(EMPTY);
      lines.push(DIVIDER);
      lines.push(EMPTY);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION: Action History Timeline (last 7 actions on THIS application)
  // ═══════════════════════════════════════════════════════════════════════════
  if (recentActions && recentActions.length > 0) {
    lines.push(`**Action History (Last ${Math.min(recentActions.length, 7)})**`);
    for (const a of recentActions.slice(0, 7)) {
      const actionDisplay = formatActionWithIcon(a.action);
      lines.push(`${actionDisplay} by <@${a.moderator_id}> — ${ts(a.created_at * 1000, 'R')}`);
    }
    lines.push(EMPTY);
    lines.push(DIVIDER);
    lines.push(EMPTY);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION: Answers (clean arrow format)
  // ═══════════════════════════════════════════════════════════════════════════
  const orderedAnswers = [...answers].sort((a, b) => a.q_index - b.q_index);
  lines.push("**Answers:**");
  lines.push(EMPTY);

  if (orderedAnswers.length > 0) {
    for (let i = 0; i < orderedAnswers.length; i++) {
      const qa = orderedAnswers[i];
      const qNum = i + 1;
      const question = qa.question || `Question ${qNum}`;
      const answer = qa.answer?.trim() || "*(no response)*";

      // Question label
      lines.push(`**Q${qNum}: ${question}**`);

      // Answer with arrow format and quote styling
      const answerLines = answer.split("\n");
      for (const line of answerLines) {
        lines.push(`> ${line}`);
      }

      // Add spacing between questions (except last)
      if (i < orderedAnswers.length - 1) {
        lines.push(EMPTY);
      }
    }
  } else {
    lines.push("*(no answers recorded)*");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Footer
  // ═══════════════════════════════════════════════════════════════════════════
  const footerText = isSample ? `Sample Preview • App ID: ${app.id.slice(0, 8)}` : `App ID: ${app.id.slice(0, 8)}`;
  embed.setFooter({ text: footerText });
  embed.setTimestamp(submittedDate.getTime());

  // Join lines and check size (Discord description limit: 4096 chars)
  let description = lines.join("\n");

  // If too long, try removing history sections first
  if (description.length > 4000) {
    // Try removing action history first
    const actionHistoryStart = description.indexOf("**Action History");
    const answersStart = description.indexOf("**Answers:**");
    if (actionHistoryStart !== -1 && answersStart !== -1 && actionHistoryStart < answersStart) {
      description = description.slice(0, actionHistoryStart) + description.slice(answersStart);
      description = description.replace(/\n{3,}/g, "\n\n");
    }
  }

  // If still too long, try removing application history
  if (description.length > 4000) {
    const appHistoryStart = description.indexOf("**Application History");
    const actionHistoryStart = description.indexOf("**Action History");
    const nextSection = actionHistoryStart !== -1 ? actionHistoryStart : description.indexOf("**Answers:**");
    if (appHistoryStart !== -1 && nextSection !== -1 && appHistoryStart < nextSection) {
      description = description.slice(0, appHistoryStart) + description.slice(nextSection);
      description = description.replace(/\n{3,}/g, "\n\n");
    }
  }

  // If still too long, truncate answers
  if (description.length > 4000) {
    description = description.slice(0, 3950) + "\n\n*...content truncated for Discord limits*";
  }

  embed.setDescription(description);

  return embed;
}
