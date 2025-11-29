/**
 * Pawtropolis Tech — src/commands/search.ts
 * WHAT: /search command — displays all of a user's past applications with links to review cards.
 * WHY: Allows moderators to quickly view an applicant's history for context during review.
 * FLOWS:
 *  - /search user:@User → paginated embed of all applications for that user
 *  - Shows app code, status, submitted date, resolution reason, and link to review card
 * DOCS:
 *  - Discord slash commands: https://discord.js.org/#/docs/discord.js/main/class/ChatInputCommandInteraction
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { db } from "../db/db.js";
import { shortCode } from "../lib/ids.js";
import { logger } from "../lib/logger.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { hasStaffPermissions, isReviewer } from "../lib/config.js";
import { isOwner } from "../utils/owner.js";

/**
 * Max applications to show in a single embed.
 * Discord embeds have a 6000 character limit total, and we want readable fields.
 */
const MAX_APPLICATIONS = 10;

/**
 * Truncate text to a max length, adding ellipsis if needed.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Status emoji mapping for visual distinction.
 */
function getStatusEmoji(status: string): string {
  switch (status.toLowerCase()) {
    case "approved":
      return "✅";
    case "rejected":
      return "❌";
    case "kicked":
      return "🚫";
    case "pending":
    case "submitted":
      return "⏳";
    default:
      return "📄";
  }
}

/**
 * Format status for display (capitalize first letter).
 */
function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Format timestamp for Discord display using relative time.
 */
function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "unknown";

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "unknown";

    const seconds = Math.floor(date.getTime() / 1000);
    return `<t:${seconds}:R>`;
  } catch {
    return "unknown";
  }
}

interface ApplicationRow {
  id: string;
  status: string;
  submitted_at: string | null;
  resolved_at: string | null;
  resolution_reason: string | null;
  channel_id: string | null;
  message_id: string | null;
}

/*
 * PERMISSION STRATEGY:
 * setDefaultMemberPermissions(null) makes the command visible to everyone in the
 * command picker. We then check permissions at runtime (isOwner, isStaff, isReviewer).
 *
 * This follows the same pattern as /listopen and other review commands.
 */
export const data = new SlashCommandBuilder()
  .setName("search")
  .setDescription("Search for a user's application history")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("The user to search for")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(null) // Make discoverable, enforce at runtime
  .setDMPermission(false); // Guild-only command

/**
 * WHAT: Main command executor for /search.
 * WHY: Entry point for searching a user's application history.
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;

  // Guild-only check
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guildId;
  const reviewerId = interaction.user.id;

  // Runtime permission check: reviewer role, owner, or staff permissions
  const member = interaction.member
    ? await interaction.guild.members.fetch(reviewerId).catch(() => null)
    : null;

  const isOwnerUser = isOwner(reviewerId);
  const isStaff = hasStaffPermissions(member, guildId);
  const isReviewerUser = isReviewer(guildId, member);

  if (!isOwnerUser && !isStaff && !isReviewerUser) {
    await interaction.reply({
      content:
        "❌ You don't have permission to use this command. This command is restricted to reviewers, staff, and server administrators.",
      ephemeral: true,
    });

    logger.warn(
      { userId: reviewerId, guildId, isOwner: isOwnerUser, isStaff, isReviewer: isReviewerUser },
      "[search] unauthorized access attempt"
    );
    return;
  }

  const targetUser = interaction.options.getUser("user", true);

  await interaction.deferReply({ ephemeral: false });

  try {
    // Query all applications for the user in this guild
    // LEFT JOIN with review_card to get message link info
    const query = `
      SELECT
        a.id,
        a.status,
        a.submitted_at,
        a.resolved_at,
        a.resolution_reason,
        rc.channel_id,
        rc.message_id
      FROM application a
      LEFT JOIN review_card rc ON rc.app_id = a.id
      WHERE a.guild_id = ? AND a.user_id = ?
      ORDER BY a.submitted_at DESC
      LIMIT ?
    `;

    const applications = db
      .prepare(query)
      .all(guildId, targetUser.id, MAX_APPLICATIONS) as ApplicationRow[];

    // Count total applications (in case there are more than MAX_APPLICATIONS)
    const countQuery = `
      SELECT COUNT(*) as total
      FROM application
      WHERE guild_id = ? AND user_id = ?
    `;
    const countResult = db.prepare(countQuery).get(guildId, targetUser.id) as { total: number } | undefined;
    const totalApplications = countResult?.total ?? 0;

    // Handle no applications case
    if (applications.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle(`Application History for ${targetUser.tag}`)
        .setDescription("No applications found for this user.")
        .setColor(0x5865f2) // Discord blurple
        .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
        .setTimestamp()
        .setFooter({ text: `User ID: ${targetUser.id}` });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Build the embed
    const embed = new EmbedBuilder()
      .setTitle(`Application History for ${targetUser.tag}`)
      .setColor(0x5865f2) // Discord blurple
      .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
      .setTimestamp()
      .setFooter({ text: `User ID: ${targetUser.id}` });

    // Add total count description
    if (totalApplications > MAX_APPLICATIONS) {
      embed.setDescription(
        `**Total Applications:** ${totalApplications}\n*Showing most recent ${MAX_APPLICATIONS}*`
      );
    } else {
      embed.setDescription(`**Total Applications:** ${totalApplications}`);
    }

    // Add each application as a field
    for (const app of applications) {
      const code = shortCode(app.id);
      const emoji = getStatusEmoji(app.status);
      const status = formatStatus(app.status);
      const submittedAt = formatTimestamp(app.submitted_at);

      // Build the field value
      const lines: string[] = [];

      // Add resolution reason if present (truncated)
      if (app.resolution_reason) {
        const reason = truncate(app.resolution_reason, 100);
        lines.push(`Reason: "${reason}"`);
      }

      // Add link to review card if message exists
      if (app.channel_id && app.message_id) {
        const messageUrl = `https://discord.com/channels/${guildId}/${app.channel_id}/${app.message_id}`;
        lines.push(`[View Card](${messageUrl})`);
      }

      const fieldValue = lines.length > 0 ? lines.join("\n") : "*No additional details*";

      embed.addFields({
        name: `${emoji} #${code} • ${status} • ${submittedAt}`,
        value: fieldValue,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { guildId, reviewerId, targetUserId: targetUser.id, applicationCount: applications.length },
      "[search] moderator searched user application history"
    );
  } catch (err) {
    logger.error({ err, guildId, reviewerId, targetUserId: targetUser.id }, "[search] command failed");

    await interaction.editReply({
      content: "❌ Failed to fetch application history. Please try again later.",
    });
  }
}
