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

export interface BuildEmbedOptions {
  answers?: ReviewAnswer[];
  flags?: string[];
  avatarScan?: AvatarScanRow | null;
  claim?: ReviewClaimRow | null;
  accountCreatedAt?: number | null;
  modmailTicket?: ModmailTicket | null;
  member?: GuildMember | null;
  recentActions?: ReviewAction[] | null;
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
 * Returns orange if member has left for pending apps
 */
export function getEmbedColor(status: ApplicationStatus, memberHasLeft: boolean): number {
  // If member has left and app is still pending, show orange warning
  if (memberHasLeft && (status === "draft" || status === "submitted")) {
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

// ============================================================================
// Main Embed Builder
// ============================================================================

export function buildReviewEmbed(
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
    isSample = false,
    reasonAttachment = null,
  } = opts;

  const code = shortCode(app.id);
  const username = app.userTag.replace(/@/g, "@\u200b"); // prevent mention
  const hr = "\n────────────────\n";

  // Parse timestamps
  const submittedEpoch = app.submitted_at
    ? Math.floor(new Date(app.submitted_at).getTime() / 1000)
    : Math.floor(new Date(app.created_at).getTime() / 1000);

  // Build embed
  const embed = new EmbedBuilder()
    .setTitle(`New Application • ${username} • App #${code}`)
    .setColor(getEmbedColor(app.status, member === null));

  // Thumbnail
  if (app.avatarUrl) {
    embed.setThumbnail(app.avatarUrl);
  }

  // Description: Decision + Reason (mobile-first, single block)
  const topSections: string[] = [];

  // Show prominent notice if member has left
  if (member === null && (app.status === "draft" || app.status === "submitted")) {
    topSections.push(`⚠️ **Member left server.**`);
  }

  if (app.status === "rejected" && app.resolution_reason) {
    const reason = app.resolution_reason;
    topSections.push(`**Decision**\nRejected`);
    if (reason.length > 3800) {
      topSections.push(`**Reason**\nAttached as rejection-reason.txt (too long to display)`);
    } else {
      topSections.push(`**Reason**\n\`\`\`text\n${reason}\n\`\`\``);
    }
  } else if (app.status === "approved") {
    topSections.push(`**Decision**\nApproved`);
  }
  if (topSections.length > 0) {
    embed.setDescription(topSections.join(hr));
  }

  // Field: Application Info
  const metaLines: string[] = [];

  // Submitted time with full date (absolute, copy-pasteable)
  metaLines.push(`Submitted: ${formatAbsolute(submittedEpoch, { hour12: false })}`);

  // Claim status
  if (claim) {
    const claimEpoch = parseClaimedAt(claim.claimed_at);
    if (claimEpoch) {
      metaLines.push(`**Claimed by:** <@${claim.reviewer_id}> • ${discordTimestamp(claimEpoch, "R")}`);
    } else {
      metaLines.push(`**Claimed by:** <@${claim.reviewer_id}> • (timestamp parse error)`);
    }
  } else {
    metaLines.push(`Claimed by: Unclaimed`);
  }

  // Account age with full date
  if (typeof accountCreatedAt === 'number' && Number.isFinite(accountCreatedAt) && accountCreatedAt > 0) {
    const accountSec = Math.floor(accountCreatedAt / 1000);
    if (Number.isFinite(accountSec) && accountSec > 0) {
      metaLines.push(`**Account created:** ${discordTimestamp(accountSec, "F")} (${discordTimestamp(accountSec, "R")})`);
    }
  }

  embed.addFields({
    name: "──────────── Application ────────────",
    value: metaLines.join("\n"),
    inline: false,
  });

  // Fields: Questions + Answers (each in code block)
  const orderedAnswers = [...answers].sort((a, b) => a.q_index - b.q_index);

  // Add Q&A section header
  embed.addFields({
    name: "────────────── Q&A ──────────────",
    value: orderedAnswers.length === 0 ? "No answers submitted yet" : "\u200b", // Zero-width space for separator
    inline: false,
  });

  if (orderedAnswers.length > 0) {
    for (const qa of orderedAnswers) {
      const question = qa.question || `Question ${qa.q_index + 1}`;
      // Don't truncate answers - show full text
      const answer = qa.answer || "(no response)";
      const wrappedAnswer = wrapCode(answer, 72);

      embed.addFields({
        name: `Q${qa.q_index + 1}: ${question}`,
        value: wrappedAnswer,
        inline: false,
      });
    }
  }

  // Field: Status
  const statusLines: string[] = [];

  // Modmail status
  if (modmailTicket) {
    if (modmailTicket.status === "open" && modmailTicket.thread_id) {
      statusLines.push(
        `**Modmail:** [Open Thread](https://discord.com/channels/${app.guild_id}/${modmailTicket.thread_id})`
      );
    } else if (
      modmailTicket.status === "closed" &&
      modmailTicket.log_channel_id &&
      modmailTicket.log_message_id
    ) {
      statusLines.push(
        `**Modmail:** [View Log](https://discord.com/channels/${app.guild_id}/${modmailTicket.log_channel_id}/${modmailTicket.log_message_id})`
      );
    } else if (modmailTicket.status === "closed") {
      statusLines.push(`**Modmail:** Closed`);
    }
  } else {
    statusLines.push(`**Modmail:** None`);
  }

  // Member status
  if (member === null) {
    statusLines.push(`**Member status:** Left server`);
  } else {
    statusLines.push(`**Member status:** In server`);
  }

  // Avatar risk
  if (avatarScan) {
    const pct = avatarScan.finalPct ?? 0;
    const reverseLink = app.avatarUrl ? googleReverseImageUrl(app.avatarUrl) : "#";
    statusLines.push(`**Avatar risk:** ${pct}% • [Reverse Search](${reverseLink})`);
    statusLines.push(`*Google Vision API - 75% accuracy estimate*`);
  }

  embed.addFields({
    name: "─────────────── Status ───────────────",
    value: statusLines.join("\n"),
    inline: false,
  });

  // Field: History (last 3 actions with full timestamps)
  if (recentActions && recentActions.length > 0) {
    const historyLines = recentActions.slice(0, 3).map((action) => {
      // Use Discord timestamp formatting for consistency
      const timestamp = `${discordTimestamp(action.created_at, "F")}`;
      let line = `• **${action.action}** by <@${action.moderator_id}>\n  ${timestamp}`;
      return line;
    });

    embed.addFields({
      name: "───────────── History (Last 3) ─────────────",
      value: historyLines.join("\n\n"), // Double newline for spacing
      inline: false,
    });
  } else if (recentActions) {
    embed.addFields({
      name: "───────────── History (Last 3) ─────────────",
      value: "No recent history",
      inline: false,
    });
  }

  // Flags (if any)
  if (flags.length > 0) {
    embed.addFields({
      name: "──────────────── Flags ────────────────",
      value: flags.join("\n"),
      inline: false,
    });
  }

  // Footer
  const todayLocal = fmtLocal(Math.floor(Date.now() / 1000));
  const footerText = isSample
    ? `Sample Preview • Submitted: ${fmtUtc(submittedEpoch)} • App ID: ${app.id.slice(0, 8)} • ${todayLocal}`
    : `Submitted: ${fmtUtc(submittedEpoch)} • App ID: ${app.id.slice(0, 8)} • ${todayLocal}`;

  embed.setFooter({ text: footerText });
  embed.setTimestamp(submittedEpoch * 1000);

  // Check total size and truncate if needed
  const totalSize = estimateEmbedSize(embed);
  if (totalSize > 5500) {
    // Remove history to save space
    const fields = embed.data.fields || [];
    const historyIndex = fields.findIndex((f) => f.name.startsWith("History"));
    if (historyIndex >= 0) {
      fields.splice(historyIndex, 1);
    }

    // Add truncation notice
    if (embed.data.description) {
      embed.setDescription(embed.data.description + "\n\n*Some content truncated for mobile.*");
    } else {
      embed.setDescription("*Some content truncated for mobile.*");
    }
  }

  return embed;
}

// ============================================================================
// Mobile-first builder (V2)
// ============================================================================

export function buildReviewEmbedV2(
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
    isSample = false,
  } = opts;

  const code = shortCode(app.id);
  const username = app.userTag.replace(/@/g, "@\u200b");
  const submittedEpoch = app.submitted_at
    ? Math.floor(new Date(app.submitted_at).getTime() / 1000)
    : Math.floor(new Date(app.created_at).getTime() / 1000);

  const embed = new EmbedBuilder()
    .setTitle(`New Application • ${username} • App #${code}`)
    .setColor(getEmbedColor(app.status, member === null));
  if (app.avatarUrl) embed.setThumbnail(app.avatarUrl);

  const hr = "\n────────────────\n";
  const sections: string[] = [];

  // Show prominent notice if member has left
  if (member === null && (app.status === "draft" || app.status === "submitted")) {
    sections.push(`⚠️ **Member left server.**`);
  }

  if (app.status === "rejected" && app.resolution_reason) {
    sections.push(`**Decision**\nRejected`);
    const reason = app.resolution_reason;
    if (reason.length > 3800) {
      sections.push(`**Reason**\nAttached as rejection-reason.txt (too long to display)`);
    } else {
      sections.push(`**Reason**\n\`\`\`text\n${reason}\n\`\`\``);
    }
  } else if (app.status === "approved") {
    sections.push(`**Decision**\nApproved`);
  }

  // Application meta
  const claimed = claim ? `<@${claim.reviewer_id}>` : "Unclaimed";
  const metaLines: string[] = [`Submitted: ${toDiscordAbs(submittedEpoch)}; Claimed by: ${claimed}`];
  if (claim) {
    const claimEpoch = parseClaimedAt(claim.claimed_at);
    metaLines[0] = `Submitted: ${toDiscordAbs(submittedEpoch)}`; // keep Submitted first line
    if (claimEpoch) {
      metaLines.push(`Claimed by: ${claimed} • ${toDiscordRel(claimEpoch)}`);
    } else {
      metaLines.push(`Claimed by: ${claimed} • (timestamp parse error)`);
    }
  }
  if (typeof accountCreatedAt === 'number' && Number.isFinite(accountCreatedAt) && accountCreatedAt > 0) {
    const accountSec = Math.floor(accountCreatedAt / 1000);
    if (Number.isFinite(accountSec) && accountSec > 0) {
      metaLines.push(`Account created: ${toDiscordAbs(accountSec)} (${toDiscordRel(accountSec)})`);
    }
  }
  sections.push(`**Application**\n${metaLines.join("\n")}`);

  // Q&A header as a field adjacent to answers
  const orderedAnswers = [...answers].sort((a, b) => a.q_index - b.q_index);
  if (orderedAnswers.length > 0) {
    embed.addFields({ name: "Q&A", value: "\u200b", inline: false });
  }
  for (const qa of orderedAnswers) {
    const question = qa.question || `Question ${qa.q_index + 1}`;
    const wrapped = wrapCode(qa.answer || "(no response)", 72);
    embed.addFields({ name: `Q${qa.q_index + 1}: ${question}`, value: wrapped, inline: false });
  }

  // Status
  const statusLines: string[] = [];
  if (modmailTicket) {
    if (modmailTicket.status === "open") statusLines.push("Modmail: Open");
    else if (modmailTicket.status === "closed") statusLines.push("Modmail: Closed");
  } else {
    statusLines.push("Modmail: None");
  }
  statusLines.push(member === null ? "Member status: Left server" : "Member status: In server");
  if (avatarScan) {
    const pct = avatarScan.finalPct ?? 0;
    const reverse = app.avatarUrl ? googleReverseImageUrl(app.avatarUrl) : "#";
    statusLines.push(`Avatar risk: ${pct}% • [Reverse Search](${reverse})`);
    statusLines.push(`*Model estimates — verify manually.*`);
  }
  sections.push(`**Status**\n${statusLines.join("\n")}`);

  if (recentActions && recentActions.length > 0) {
    const lines = recentActions.slice(0, 3).map((a) => {
      const when = formatAbsolute(a.created_at, { hour12: false });
      const verb = a.action.replace(/_/g, " ");
      return `• ${verb} by <@${a.moderator_id}> — ${when}`;
    });
    sections.push(`**History (Last 3)**\n${lines.join("\n")}`);
  }

  if (flags && flags.length > 0) {
    sections.push(`**Flags**\n${flags.join("\n")}`);
  }

  const footerText = isSample
    ? `Sample Preview • Submitted: ${formatAbsoluteUtc(submittedEpoch)} • App ID: ${app.id.slice(0, 8)}`
    : `Submitted: ${formatAbsoluteUtc(submittedEpoch)} • App ID: ${app.id.slice(0, 8)}`;
  embed.setFooter({ text: footerText });
  embed.setTimestamp(submittedEpoch * 1000);

  if (sections.length > 0) embed.setDescription(sections.join("\n\n"));
  return embed;
}

export function buildActionRowsV2(
  app: ReviewCardApplication,
  claim: ReviewClaimRow | null
): ActionRowBuilder<ButtonBuilder>[] {
  const terminal = app.status === "approved" || app.status === "rejected" || app.status === "kicked";
  const idSuffix = `code${shortCode(app.id)}`;
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

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
// Mobile-first builder (V3) — consolidates all content into description
// ============================================================================

export function buildReviewEmbedV3(
  app: ReviewCardApplication,
  opts: BuildEmbedOptions = {}
): EmbedBuilder {
  const {
    answers = [],
    avatarScan = null,
    claim = null,
    accountCreatedAt = null,
    modmailTicket = null,
    member = null,
    recentActions = null,
    isSample = false,
  } = opts;

  const code = shortCode(app.id);
  const username = app.userTag.replace(/@/g, "@\u200b");
  const submittedDate = app.submitted_at ? new Date(app.submitted_at) : new Date(app.created_at);

  const embed = new EmbedBuilder()
    .setTitle(`New Application • ${username} • App #${code}`)
    .setColor(getEmbedColor(app.status, member === null));
  if (app.avatarUrl) embed.setThumbnail(app.avatarUrl);

  const lines: string[] = [];

  // Show prominent notice if member has left
  if (member === null && (app.status === "draft" || app.status === "submitted")) {
    lines.push("⚠️ **Member left server.**");
    lines.push("");
  }

  // Decision + Reason
  if (app.status === "rejected" && app.resolution_reason) {
    lines.push("**Decision**");
    lines.push("Rejected");
    lines.push("");
    lines.push("**Reason**");
    lines.push("```");
    lines.push(app.resolution_reason);
    lines.push("```");
    lines.push("");
  } else if (app.status === "approved") {
    lines.push("**Decision**");
    lines.push("Approved");
    lines.push("");
  }

  // Application
  lines.push("**Application**");
  lines.push(`Submitted: ${ts(submittedDate, 'f')} • ${ts(submittedDate, 'R')}`);
  const claimedText = claim ? `<@${claim.reviewer_id}>` : "Unclaimed";
  if (claim) {
    const claimEpoch = parseClaimedAt(claim.claimed_at);
    if (claimEpoch) {
      const claimTs = claimEpoch * 1000;  // Convert seconds to milliseconds
      lines.push(`Claimed by: ${claimedText} • ${ts(claimTs, 'f')}`);
    } else {
      lines.push(`Claimed by: ${claimedText} • (timestamp parse error)`);
    }
  } else {
    lines.push(`Claimed by: ${claimedText}`);
  }
  if (typeof accountCreatedAt === 'number' && Number.isFinite(accountCreatedAt) && accountCreatedAt > 0) {
    lines.push(`Account created: ${ts(accountCreatedAt, 'f')} • ${ts(accountCreatedAt, 'R')}`);
  }
  lines.push("");

  // Status
  lines.push("**Status**");
  if (modmailTicket) {
    lines.push(modmailTicket.status === "open" ? "Modmail: Open" : "Modmail: Closed");
  } else {
    lines.push("Modmail: None");
  }
  lines.push(member === null ? "Member status: Left server" : "Member status: In server");
  if (avatarScan) {
    const pct = avatarScan.finalPct ?? 0;
    const reverse = app.avatarUrl ? googleReverseImageUrl(app.avatarUrl) : "#";
    lines.push(`Avatar risk: ${pct}% • [Reverse Search](${reverse})`);
    lines.push("*NSFW Detection API is ~75% Accurate. Always manually verify.*");
  }
  lines.push("");

  // History
  if (recentActions && recentActions.length > 0) {
    lines.push("**History (Last 3)**");
    for (const a of recentActions.slice(0, 3)) {
      const verb = a.action.replace(/_/g, " ");
      lines.push(`• ${verb} by <@${a.moderator_id}> — ${ts(a.created_at * 1000, 'f')}`);
    }
    lines.push("");
  }

  // Answers at bottom
  const orderedAnswers = [...answers].sort((a, b) => a.q_index - b.q_index);
  lines.push("**Answers:**");
  if (orderedAnswers.length > 0) {
    for (let i = 0; i < orderedAnswers.length; i++) {
      const qa = orderedAnswers[i];
      const qNum = i + 1;
      const question = qa.question || `Question ${qNum}`;
      lines.push(`Q${qNum}: ${question}`);
      lines.push("```");
      lines.push(qa.answer || "");
      lines.push("```");
      lines.push("");
    }
  } else {
    lines.push("(no answers)");
    lines.push("");
  }

  // Footer: no submitted in footer
  const footerText = isSample ? `Sample Preview • App ID: ${app.id.slice(0, 8)}` : `App ID: ${app.id.slice(0, 8)}`;
  embed.setFooter({ text: footerText });
  embed.setTimestamp(submittedDate.getTime());
  embed.setDescription(lines.join("\n"));

  return embed;
}

// ============================================================================
// Action Rows Builder
// ============================================================================

export function buildActionRows(
  app: ReviewCardApplication,
  claim: ReviewClaimRow | null
): ActionRowBuilder<ButtonBuilder>[] {
  const status = app.status;
  const terminal = status === "approved" || status === "rejected" || status === "kicked";
  const idSuffix = `code${shortCode(app.id)}`;

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  // Only show action buttons if claimed and not terminal
  if (claim && !terminal) {
    // Row 1: Primary actions (no emojis)
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`v1:decide:approve:${idSuffix}`)
        .setLabel("Accept")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`v1:decide:reject:${idSuffix}`)
        .setLabel("Reject")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`v1:decide:permreject:${idSuffix}`)
        .setLabel("Permanently Reject")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`v1:decide:kick:${idSuffix}`)
        .setLabel("Kick")
        .setStyle(ButtonStyle.Secondary)
    );

    // Row 2: Workflows (no emojis)
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`v1:decide:modmail:${idSuffix}`)
        .setLabel("Modmail")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`v1:decide:copyuid:${idSuffix}:user${app.user_id}`)
        .setLabel("Copy UID")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`v1:ping:${idSuffix}:user${app.user_id}`)
        .setLabel("Ping in Unverified")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`v1:decide:unclaim:${idSuffix}`)
        .setLabel("Unclaim")
        .setStyle(ButtonStyle.Secondary)
    );

    rows.push(row1, row2);
  } else if (!terminal) {
    // Show claim button if not claimed (no emoji)
    const claimRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`v1:decide:claim:${idSuffix}`)
        .setLabel("Claim Application")
        .setStyle(ButtonStyle.Primary)
    );

    rows.push(claimRow);
  }

  return rows;
}
