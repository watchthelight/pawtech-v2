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
import { isOwner } from "../lib/owner.js";

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

/**
 * Database row type for the search query result.
 * Different from ApplicationRow in review/types.ts - this includes joined review_card fields.
 */
interface SearchResultRow {
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
      .setDescription("Select a user from the server")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("query")
      .setDescription("Search by user ID or username (for users not in server)")
      .setRequired(false)
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

  const targetUser = interaction.options.getUser("user");
  const queryString = interaction.options.getString("query");

  // Require at least one search parameter
  if (!targetUser && !queryString) {
    await interaction.reply({
      content: "❌ Please provide either a user or a search query (user ID or username).",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: false });

  // Declare outside try block for error logging
  let targetUserId: string | undefined;

  try {
    // Resolve target user ID and display info
    let displayName: string;
    let avatarUrl: string | null = null;

    if (targetUser) {
      // User was selected from the picker
      targetUserId = targetUser.id;
      displayName = targetUser.tag;
      avatarUrl = targetUser.displayAvatarURL({ size: 128 });
    } else if (queryString) {
      // Search by query string - could be UID or username
      const trimmedQuery = queryString.trim();

      // Check if it looks like a Discord user ID (17-20 digit snowflake)
      const isSnowflake = /^\d{17,20}$/.test(trimmedQuery);

      if (isSnowflake) {
        // Search directly by user ID
        targetUserId = trimmedQuery;

        // Try to fetch user info from Discord for display
        try {
          const fetchedUser = await interaction.client.users.fetch(trimmedQuery);
          displayName = fetchedUser.tag;
          avatarUrl = fetchedUser.displayAvatarURL({ size: 128 });
        } catch {
          // User doesn't exist or can't be fetched - still search DB
          displayName = `User ${trimmedQuery}`;
        }
      } else {
        // Search by username - try to find in guild members first
        const members = await interaction.guild!.members.fetch({ query: trimmedQuery, limit: 10 });
        const exactMatch = members.find(
          (m) =>
            m.user.username.toLowerCase() === trimmedQuery.toLowerCase() ||
            m.user.tag.toLowerCase() === trimmedQuery.toLowerCase() ||
            m.displayName.toLowerCase() === trimmedQuery.toLowerCase()
        );

        if (exactMatch) {
          targetUserId = exactMatch.id;
          displayName = exactMatch.user.tag;
          avatarUrl = exactMatch.user.displayAvatarURL({ size: 128 });
        } else if (members.size > 0) {
          // Use first partial match
          const firstMatch = members.first()!;
          targetUserId = firstMatch.id;
          displayName = firstMatch.user.tag;
          avatarUrl = firstMatch.user.displayAvatarURL({ size: 128 });
        } else {
          // No member found - search DB for applications by users with matching username pattern
          // This finds applications from users who may have left the server
          const usernameSearchQuery = `
            SELECT DISTINCT a.user_id
            FROM application a
            WHERE a.guild_id = ?
            LIMIT 100
          `;
          const candidateUserIds = db.prepare(usernameSearchQuery).all(guildId) as { user_id: string }[];

          // Try to resolve each user and check username
          let foundUserId: string | null = null;
          for (const { user_id } of candidateUserIds) {
            try {
              const user = await interaction.client.users.fetch(user_id);
              if (
                user.username.toLowerCase().includes(trimmedQuery.toLowerCase()) ||
                user.tag.toLowerCase().includes(trimmedQuery.toLowerCase())
              ) {
                foundUserId = user_id;
                displayName = user.tag;
                avatarUrl = user.displayAvatarURL({ size: 128 });
                break;
              }
            } catch {
              // User can't be fetched, skip
            }
          }

          if (!foundUserId) {
            await interaction.editReply({
              content: `❌ No user found matching "${trimmedQuery}". Try searching by user ID instead.`,
            });
            return;
          }
          targetUserId = foundUserId;
        }
      }
    } else {
      // Should never reach here due to earlier check
      await interaction.editReply({ content: "❌ Invalid search parameters." });
      return;
    }

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
      .all(guildId, targetUserId, MAX_APPLICATIONS) as SearchResultRow[];

    // Count total applications (in case there are more than MAX_APPLICATIONS)
    const countQuery = `
      SELECT COUNT(*) as total
      FROM application
      WHERE guild_id = ? AND user_id = ?
    `;
    const countResult = db.prepare(countQuery).get(guildId, targetUserId) as { total: number } | undefined;
    const totalApplications = countResult?.total ?? 0;

    // Handle no applications case
    if (applications.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle(`Application History for ${displayName}`)
        .setDescription("No applications found for this user.")
        .setColor(0x5865f2) // Discord blurple
        .setTimestamp()
        .setFooter({ text: `User ID: ${targetUserId}` });

      if (avatarUrl) {
        embed.setThumbnail(avatarUrl);
      }

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Build the embed
    const embed = new EmbedBuilder()
      .setTitle(`Application History for ${displayName}`)
      .setColor(0x5865f2) // Discord blurple
      .setTimestamp()
      .setFooter({ text: `User ID: ${targetUserId}` });

    if (avatarUrl) {
      embed.setThumbnail(avatarUrl);
    }

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
      { guildId, reviewerId, targetUserId, applicationCount: applications.length },
      "[search] moderator searched user application history"
    );
  } catch (err) {
    logger.error({ err, guildId, reviewerId, targetUserId: targetUserId ?? queryString }, "[search] command failed");

    await interaction.editReply({
      content: "❌ Failed to fetch application history. Please try again later.",
    });
  }
}
