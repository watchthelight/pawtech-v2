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

// ============================================================================
// Types
// ============================================================================

export type ApplicationStatus = "pending" | "submitted" | "approved" | "rejected" | "kicked";

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
  furry_score: number;
  scalie_score: number;
  reason: string;
  evidence: {
    hard: Array<{ tag: string; p?: number }>;
    soft: Array<{ tag: string; p?: number }>;
    safe: Array<{ tag: string; p?: number }>;
  };
}

export interface ReviewClaimRow {
  reviewer_id: string;
  claimed_at: number;
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
  const diff = now - epochSec;

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

/**
 * Format timestamp as UTC string
 */
export function fmtUtc(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/**
 * Format local date
 */
export function fmtLocal(epochSec: number): string {
  const date = new Date(epochSec * 1000);
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "short",
    timeStyle: "short",
  });
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

  // Parse timestamps
  const submittedEpoch = app.submitted_at
    ? Math.floor(new Date(app.submitted_at).getTime() / 1000)
    : Math.floor(new Date(app.created_at).getTime() / 1000);

  // Build embed
  const embed = new EmbedBuilder()
    .setTitle(`New Application • ${username} • App #${code}`)
    .setColor(getStatusColor(app.status));

  // Thumbnail
  if (app.avatarUrl) {
    embed.setThumbnail(app.avatarUrl);
  }

  // Description: Show rejection reason in full
  if (app.status === "rejected" && app.resolution_reason) {
    const reason = app.resolution_reason;

    if (reason.length > 3800) {
      // Reason attached as file
      embed.setDescription(`**Decision:** Rejected\n\n**Reason:**\nAttached as rejection-reason.txt (too long to display)`);
    } else {
      // Show full reason in code block for better formatting
      embed.setDescription(`**Decision:** Rejected\n\n**Reason:**\n\`\`\`text\n${reason}\n\`\`\``);
    }
  } else if (app.status === "approved") {
    embed.setDescription(`**Decision:** Approved`);
  }

  // Field: Application Info
  const metaLines: string[] = [];

  // Submitted time with full date
  metaLines.push(`**Submitted:** ${discordTimestamp(submittedEpoch, "F")} (${discordTimestamp(submittedEpoch, "R")})`);

  // Claim status
  if (claim) {
    const claimEpoch = claim.claimed_at;
    metaLines.push(`**Claimed by:** <@${claim.reviewer_id}> • ${discordTimestamp(claimEpoch, "R")}`);
  } else {
    metaLines.push(`**Claimed by:** Unclaimed`);
  }

  // Account age with full date
  if (accountCreatedAt && Number.isFinite(accountCreatedAt) && accountCreatedAt > 0) {
    const accountSec = Math.floor(accountCreatedAt / 1000);
    metaLines.push(`**Account created:** ${discordTimestamp(accountSec, "F")} (${discordTimestamp(accountSec, "R")})`);
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
