/**
 * Pawtropolis Tech — src/ui/dbRecoveryCard.ts
 * WHAT: UI builder for database recovery embeds and action rows
 * WHY: Conform to design system (colors, timestamps, 80-char wrapping)
 * HOW: Build Discord embeds for candidate list, validation results, and restore summaries
 * FLOWS:
 *   - buildCandidateListEmbed() - list all backup candidates
 *   - buildValidationEmbed() - show validation check results
 *   - buildRestoreSummaryEmbed() - post-restore audit summary
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import type { BackupCandidate, ValidationResult, RestoreResult } from "../features/dbRecovery.js";

// ============================================================================
// Color Palette (matching project design system)
// ============================================================================

const COLORS = {
  primary: 0x1e293b, // slate-800
  ok: 0x10b981, // green-500
  err: 0xef4444, // red-500
  muted: 0x94a3b8, // slate-400
  warning: 0xfbbf24, // amber-400
  info: 0x3b82f6, // blue-500
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format bytes as human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Wrap text at ~80 characters for embed reasons
 */
function wrapText(text: string, maxLen = 80): string {
  if (text.length <= maxLen) return text;

  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + word).length > maxLen) {
      lines.push(currentLine.trim());
      currentLine = word + " ";
    } else {
      currentLine += word + " ";
    }
  }

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines.join("\n");
}

/**
 * Discord timestamp format helper
 */
function discordTimestamp(epochSec: number, format: "F" | "f" | "R" = "F"): string {
  return `<t:${epochSec}:${format}>`;
}

// ============================================================================
// Embed Builders
// ============================================================================

/**
 * Build embed listing backup candidates
 *
 * @param candidates - Array of backup candidates (sorted by created_at DESC)
 * @param guildName - Guild name for embed title
 * @returns EmbedBuilder with candidate list
 */
export function buildCandidateListEmbed(
  candidates: BackupCandidate[],
  guildName?: string
): EmbedBuilder {
  const now = Math.floor(Date.now() / 1000);
  const embed = new EmbedBuilder()
    .setTitle(`🗄️ Database Recovery — Backup Candidates`)
    .setDescription(
      wrapText(
        `Found ${candidates.length} backup candidate${candidates.length === 1 ? "" : "s"} in \`data/backups/\`. Select Validate or Restore. All actions are audited. (${discordTimestamp(now, "F")})`
      )
    )
    .setColor(COLORS.info)
    .setTimestamp();

  if (candidates.length === 0) {
    embed.addFields({
      name: "No Candidates Found",
      value: "No `.db` files found in `data/backups/` directory.\nEnsure backups exist before attempting recovery.",
      inline: false,
    });
  } else {
    // Add up to 10 candidates as fields (Discord max 25 fields)
    candidates.slice(0, 10).forEach((c) => {
      const integrityIcon = c.integrity_result === "ok" ? "✅" : c.integrity_result ? "❌" : "⚪";
      const fkIcon =
        c.foreign_key_violations === 0
          ? "✅"
          : c.foreign_key_violations
            ? "❌"
            : "⚪";

      const fieldValue = [
        `Created: ${discordTimestamp(c.created_at, "F")}`,
        `Size: ${formatBytes(c.size_bytes)}`,
        `Integrity: ${integrityIcon} ${c.integrity_result || "not validated"}`,
        `FK: ${fkIcon} ${c.foreign_key_violations !== undefined ? `${c.foreign_key_violations} violation(s)` : "not validated"}`,
        c.row_count ? `Rows: ${c.row_count.toLocaleString()}` : "",
        c.notes ? `Notes: ${c.notes.substring(0, 60)}${c.notes.length > 60 ? "..." : ""}` : "",
        `ID: \`${c.id.substring(0, 32)}\``,
      ]
        .filter(Boolean)
        .join("\n");

      embed.addFields({
        name: `📦 ${c.filename}`,
        value: fieldValue,
        inline: false,
      });
    });

    if (candidates.length > 10) {
      embed.addFields({
        name: `\u200b`,
        value: `_Showing first 10 of ${candidates.length} candidates. Use CLI for full list._`,
        inline: false,
      });
    }
  }

  embed.setFooter({
    text: "⚠️ Use Validate before Restore. Final restores require confirmation.",
  });

  return embed;
}

/**
 * Build embed for validation results
 *
 * @param candidate - Backup candidate that was validated
 * @param validation - Validation result with integrity/FK checks
 * @returns EmbedBuilder with validation results
 */
export function buildValidationEmbed(
  candidate: BackupCandidate,
  validation: ValidationResult
): EmbedBuilder {
  const color = validation.ok ? COLORS.ok : COLORS.err;
  const statusIcon = validation.ok ? "✅" : "❌";

  const embed = new EmbedBuilder()
    .setTitle(`${statusIcon} Validation Results: ${candidate.filename}`)
    .setDescription(
      wrapText(
        `Backup candidate validated with ${validation.ok ? "no issues" : "errors"}. Review checks below before restore.`
      )
    )
    .setColor(color)
    .setTimestamp();

  // Integrity check result
  embed.addFields({
    name: "🔍 Integrity Check (PRAGMA integrity_check)",
    value:
      validation.integrity_result === "ok"
        ? "✅ PASS — Database structure is intact"
        : `❌ FAIL — ${validation.integrity_result.substring(0, 200)}`,
    inline: false,
  });

  // Foreign key check
  embed.addFields({
    name: "🔗 Foreign Key Check (PRAGMA foreign_key_check)",
    value:
      validation.foreign_key_violations === 0
        ? "✅ PASS — No foreign key violations"
        : `❌ FAIL — ${validation.foreign_key_violations} violation(s) detected`,
    inline: false,
  });

  // Row counts
  const rowCountLines = Object.entries(validation.row_counts)
    .map(([table, count]) => `  ${table}: ${count.toLocaleString()} rows`)
    .join("\n");

  embed.addFields({
    name: "📊 Row Counts (Important Tables)",
    value: rowCountLines || "No tables checked",
    inline: false,
  });

  // File metadata
  embed.addFields({
    name: "📦 File Metadata",
    value: [
      `Size: ${formatBytes(validation.size_bytes)}`,
      `Checksum: \`${validation.checksum.substring(0, 16)}...\``,
      `Created: ${discordTimestamp(candidate.created_at, "F")}`,
    ].join("\n"),
    inline: false,
  });

  // Additional messages from validation
  if (validation.messages.length > 0) {
    const messagesText = validation.messages
      .slice(0, 10)
      .map((msg) => `• ${msg}`)
      .join("\n");

    embed.addFields({
      name: "📝 Detailed Messages",
      value: `\`\`\`\n${messagesText}\n\`\`\``,
      inline: false,
    });
  }

  embed.setFooter({
    text: validation.ok
      ? "Validation passed — ready to restore"
      : "Validation failed — restore not recommended",
  });

  return embed;
}

/**
 * Build embed for restore summary (post-restore audit)
 *
 * @param candidate - Backup candidate that was restored
 * @param result - Restore result with pre-restore backup path and verification
 * @param actorId - Discord user ID or "cli" who initiated restore
 * @returns EmbedBuilder with restore audit summary
 */
export function buildRestoreSummaryEmbed(
  candidate: BackupCandidate,
  result: RestoreResult,
  actorId: string
): EmbedBuilder {
  const color = result.success ? COLORS.ok : COLORS.err;
  const statusIcon = result.success ? "✅" : "❌";

  const embed = new EmbedBuilder()
    .setTitle(`${statusIcon} Database Restore ${result.success ? "Complete" : "Failed"}`)
    .setDescription(
      wrapText(
        result.success
          ? `Database successfully restored from backup: ${candidate.filename}`
          : `Database restore failed. Review errors below and check pre-restore backup.`
      )
    )
    .setColor(color)
    .setTimestamp();

  // Restore details
  embed.addFields({
    name: "📦 Restored Backup",
    value: [
      `File: ${candidate.filename}`,
      `Size: ${formatBytes(candidate.size_bytes)}`,
      `Created: ${discordTimestamp(candidate.created_at, "F")}`,
    ].join("\n"),
    inline: false,
  });

  // Pre-restore backup
  if (result.preRestoreBackupPath) {
    const backupFilename = result.preRestoreBackupPath.split(/[\\/]/).pop() || "unknown";
    embed.addFields({
      name: "🔄 Pre-Restore Backup",
      value: [
        `Created: \`${backupFilename}\``,
        `Location: \`data/\``,
        `Use this file to rollback if needed.`,
      ].join("\n"),
      inline: false,
    });
  }

  // Post-restore verification
  if (result.verificationResult) {
    const verifyIcon = result.verificationResult.ok ? "✅" : "⚠️";
    embed.addFields({
      name: `${verifyIcon} Post-Restore Verification`,
      value: [
        `Integrity: ${result.verificationResult.integrity_result === "ok" ? "✅ PASS" : "❌ FAIL"}`,
        `FK violations: ${result.verificationResult.foreign_key_violations === 0 ? "✅ None" : `⚠️ ${result.verificationResult.foreign_key_violations}`}`,
      ].join("\n"),
      inline: false,
    });
  }

  // Restore messages
  if (result.messages.length > 0) {
    const messagesText = result.messages
      .slice(0, 15)
      .map((msg) => `${msg}`)
      .join("\n");

    embed.addFields({
      name: "📝 Restore Log",
      value: `\`\`\`\n${messagesText}\n\`\`\``,
      inline: false,
    });
  }

  // Actor & audit info
  const actorMention = actorId === "cli" ? "`CLI`" : `<@${actorId}>`;
  embed.addFields({
    name: "👤 Initiated By",
    value: actorMention,
    inline: true,
  });

  embed.setFooter({
    text: result.success
      ? "Restore successful — verify bot functionality"
      : "Restore failed — check logs and restore from pre-restore backup",
  });

  return embed;
}

// ============================================================================
// Action Row Builders
// ============================================================================

/**
 * Build action row with Validate and Restore buttons for a candidate
 *
 * @param candidateId - Unique candidate ID
 * @param nonce - Random nonce for custom ID security
 * @returns ActionRowBuilder with buttons
 */
export function buildCandidateActionRow(
  candidateId: string,
  nonce: string
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`dbrecover:validate:${candidateId}:${nonce}`)
      .setLabel("Validate")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🔍"),

    new ButtonBuilder()
      .setCustomId(`dbrecover:restore-dry:${candidateId}:${nonce}`)
      .setLabel("Restore (Dry Run)")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🧪"),

    new ButtonBuilder()
      .setCustomId(`dbrecover:restore-confirm:${candidateId}:${nonce}`)
      .setLabel("Restore (Confirm)")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("⚠️")
  );

  return row;
}

/**
 * Build select menu for choosing a candidate (alternative to multiple button rows)
 *
 * @param candidates - Array of backup candidates (up to 25)
 * @param nonce - Random nonce for custom ID security
 * @returns ActionRowBuilder with select menu
 */
export function buildCandidateSelectMenu(
  candidates: BackupCandidate[],
  nonce: string
): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = candidates.slice(0, 25).map((c) => {
    const integrityIcon = c.integrity_result === "ok" ? "✅" : c.integrity_result ? "❌" : "⚪";
    const label = c.filename.substring(0, 80); // Discord max 100 chars
    const description = `${formatBytes(c.size_bytes)} | ${integrityIcon} ${c.integrity_result || "not validated"}`.substring(
      0,
      100
    );

    return {
      label,
      value: c.id,
      description,
      emoji: "📦",
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`dbrecover:select:${nonce}`)
    .setPlaceholder("Select a backup candidate to validate or restore")
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}
