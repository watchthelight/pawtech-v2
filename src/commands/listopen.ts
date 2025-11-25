/**
 * Pawtropolis Tech — src/commands/listopen.ts
 * WHAT: /listopen command — lists open applications claimed by the invoking moderator.
 * WHY: Provides quick access to pending review queue for individual moderators.
 * FLOWS:
 *  - /listopen → paginated list of claimed apps not yet decided
 *  - Shows applicant avatar, username, app code, and submitted timestamp
 * DOCS:
 *  - Discord slash commands: https://discord.js.org/#/docs/discord.js/main/class/ChatInputCommandInteraction
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
} from "discord.js";
import { db } from "../db/db.js";
import { shortCode } from "../lib/ids.js";
import { logActionPretty } from "../logging/pretty.js";
import { logger } from "../lib/logger.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { randomBytes } from "node:crypto";
import { hasStaffPermissions, isReviewer } from "../lib/config.js";
import { isOwner } from "../utils/owner.js";

// Application statuses that are NOT final (user can still work on these)
const FINAL_STATUSES = ["approved", "rejected", "kicked"];

const PAGE_SIZE = 10;

interface OpenApplication {
  id: string;
  user_id: string;
  submitted_at: string | null;
  created_at: string;
  claimed_at: string;
  status: string;
  reviewer_id?: string; // Present when fetching all apps
}

interface ReviewCardMapping {
  channel_id: string;
  message_id: string;
}

export const data = new SlashCommandBuilder()
  .setName("listopen")
  .setDescription("List claimed applications that need review")
  .addStringOption((option) =>
    option
      .setName("scope")
      .setDescription("Which applications to show")
      .setRequired(false)
      .addChoices(
        { name: "Mine (default)", value: "mine" },
        { name: "All moderators", value: "all" }
      )
  )
  .setDefaultMemberPermissions(null) // Make discoverable, enforce at runtime
  .setDMPermission(false); // Guild-only command

/**
 * WHAT: Generate a nonce for pagination custom IDs.
 * WHY: Non-guessable custom IDs prevent unauthorized button presses.
 */
function generateNonce(): string {
  return randomBytes(4).toString("hex");
}

/**
 * WHAT: Format timestamp for display (handles null/undefined gracefully).
 * WHY: Consistent timestamp display across embeds.
 */
function formatTimestamp(value: string | null | undefined, style: "f" | "R" = "R"): string {
  if (!value) return "unknown";

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "unknown";

    const seconds = Math.floor(date.getTime() / 1000);
    return `<t:${seconds}:${style}>`;
  } catch {
    return "unknown";
  }
}

/**
 * WHAT: Fetch open applications claimed by a specific moderator.
 * WHY: Core data query for /listopen command.
 *
 * @param guildId - Guild ID to filter by
 * @param reviewerId - Moderator user ID who claimed the apps
 * @param limit - Max number of results to return
 * @param offset - Offset for pagination
 * @returns Array of open applications with claim metadata
 */
function getOpenApplications(
  guildId: string,
  reviewerId: string,
  limit: number,
  offset: number
): OpenApplication[] {
  const query = `
    SELECT
      a.id,
      a.user_id,
      a.submitted_at,
      a.created_at,
      a.status,
      rc.claimed_at
    FROM application a
    INNER JOIN review_claim rc ON rc.app_id = a.id
    WHERE a.guild_id = ?
      AND rc.reviewer_id = ?
      AND a.status NOT IN (${FINAL_STATUSES.map(() => "?").join(", ")})
    ORDER BY rc.claimed_at DESC
    LIMIT ? OFFSET ?
  `;

  return db.prepare(query).all(guildId, reviewerId, ...FINAL_STATUSES, limit, offset) as OpenApplication[];
}

/**
 * WHAT: Count total open applications for a moderator (for pagination).
 * WHY: Needed to determine if "Next" button should be shown.
 */
function countOpenApplications(guildId: string, reviewerId: string): number {
  const query = `
    SELECT COUNT(*) as count
    FROM application a
    INNER JOIN review_claim rc ON rc.app_id = a.id
    WHERE a.guild_id = ?
      AND rc.reviewer_id = ?
      AND a.status NOT IN (${FINAL_STATUSES.map(() => "?").join(", ")})
  `;

  const result = db.prepare(query).get(guildId, reviewerId, ...FINAL_STATUSES) as { count: number } | undefined;
  return result?.count ?? 0;
}

/**
 * WHAT: Fetch ALL open applications across all moderators.
 * WHY: Provides visibility into the entire review queue for coordination.
 */
function getAllOpenApplications(guildId: string, limit: number, offset: number): OpenApplication[] {
  const query = `
    SELECT
      a.id,
      a.user_id,
      a.submitted_at,
      a.created_at,
      a.status,
      rc.claimed_at,
      rc.reviewer_id
    FROM application a
    INNER JOIN review_claim rc ON rc.app_id = a.id
    WHERE a.guild_id = ?
      AND a.status NOT IN (${FINAL_STATUSES.map(() => "?").join(", ")})
    ORDER BY rc.claimed_at DESC
    LIMIT ? OFFSET ?
  `;

  return db.prepare(query).all(guildId, ...FINAL_STATUSES, limit, offset) as OpenApplication[];
}

/**
 * WHAT: Count total open applications across all moderators.
 * WHY: Needed for "all" view pagination.
 */
function countAllOpenApplications(guildId: string): number {
  const query = `
    SELECT COUNT(*) as count
    FROM application a
    INNER JOIN review_claim rc ON rc.app_id = a.id
    WHERE a.guild_id = ?
      AND a.status NOT IN (${FINAL_STATUSES.map(() => "?").join(", ")})
  `;

  const result = db.prepare(query).get(guildId, ...FINAL_STATUSES) as { count: number } | undefined;
  return result?.count ?? 0;
}

/**
 * WHAT: Build the main embed showing open applications with clickable links.
 * WHY: Visual display of claimed apps needing review with direct navigation to review cards.
 *
 * @param isAllView - When true, shows all moderators' apps with reviewer info
 * @returns Object containing embed and array of app URLs for button generation
 */
async function buildListEmbed(
  interaction: ChatInputCommandInteraction,
  apps: OpenApplication[],
  page: number,
  totalCount: number,
  isAllView: boolean = false
): Promise<{ embed: EmbedBuilder; appUrls: Array<{ appId: string; url: string | null }> }> {
  const embed = new EmbedBuilder()
    .setTitle(isAllView ? "📋 All Open Applications" : "📋 Your Open Applications")
    .setDescription(
      apps.length === 0
        ? isAllView
          ? "There are no open applications server-wide."
          : "You have no claimed applications pending review."
        : isAllView
          ? `Showing ${apps.length} claimed application${apps.length === 1 ? "" : "s"} across all moderators.`
          : `Showing ${apps.length} claimed application${apps.length === 1 ? "" : "s"} that need your decision.`
    )
    .setColor(isAllView ? 0xeb459e : 0x5865f2) // Pink for all view, Discord blurple for personal
    .setTimestamp();

  const appUrls: Array<{ appId: string; url: string | null }> = [];

  if (apps.length === 0) {
    embed.setFooter({ text: isAllView ? "No open applications server-wide" : "No open applications" });
    return { embed, appUrls };
  }

  const guildId = interaction.guildId!;
  const guild = interaction.guild!;

  // Fetch user avatars and review card mappings (fallback to default if user left guild or can't be fetched)
  for (const app of apps) {
    const code = shortCode(app.id);
    const submittedDisplay = formatTimestamp(app.submitted_at ?? app.created_at, "R");
    const claimedDisplay = formatTimestamp(app.claimed_at, "R");

    // Fetch review card mapping for this application
    const mapping = db
      .prepare("SELECT channel_id, message_id FROM review_card WHERE app_id = ? LIMIT 1")
      .get(app.id) as ReviewCardMapping | undefined;

    // Build Discord message URL if mapping exists
    const appUrl =
      mapping?.channel_id && mapping?.message_id
        ? `https://discord.com/channels/${guildId}/${mapping.channel_id}/${mapping.message_id}`
        : null;

    appUrls.push({ appId: app.id, url: appUrl });

    // Try to fetch applicant user info
    let displayName: string;

    try {
      const member = await guild.members.fetch(app.user_id).catch(() => null);

      if (member) {
        displayName = member.user.tag;
      } else {
        const user = await interaction.client.users.fetch(app.user_id).catch(() => null);

        if (user) {
          displayName = user.tag;
        } else {
          displayName = `User ${app.user_id}`;
        }
      }
    } catch {
      displayName = `User ${app.user_id}`;
    }

    // Fetch reviewer info for "all" view
    let reviewerDisplay = "";
    if (isAllView && app.reviewer_id) {
      try {
        const reviewerMember = await guild.members.fetch(app.reviewer_id).catch(() => null);
        if (reviewerMember) {
          reviewerDisplay = `\n**Claimed by:** <@${app.reviewer_id}>`;
        } else {
          const reviewerUser = await interaction.client.users.fetch(app.reviewer_id).catch(() => null);
          if (reviewerUser) {
            reviewerDisplay = `\n**Claimed by:** ${reviewerUser.tag}`;
          } else {
            reviewerDisplay = `\n**Claimed by:** User ${app.reviewer_id}`;
          }
        }
      } catch {
        reviewerDisplay = `\n**Claimed by:** User ${app.reviewer_id}`;
      }
    }

    // Build field value with link indicator
    const linkIndicator = appUrl ? "🔗 " : "";
    const fieldValue =
      `**Status:** \`${app.status}\`\n` +
      `**Submitted:** ${submittedDisplay}\n` +
      `**Claimed:** ${claimedDisplay}` +
      reviewerDisplay +
      (appUrl ? `\n${linkIndicator}[Open Application](${appUrl})` : "");

    embed.addFields({
      name: `${displayName} • App #${code}`,
      value: fieldValue,
      inline: false,
    });
  }

  // Footer with pagination info
  const startIdx = page * PAGE_SIZE + 1;
  const endIdx = Math.min(startIdx + apps.length - 1, totalCount);
  embed.setFooter({
    text: `Showing ${startIdx}-${endIdx} of ${totalCount} • Page ${page + 1}${isAllView ? " (All Mods)" : ""}`,
  });

  return { embed, appUrls };
}

/**
 * WHAT: Build pagination buttons (Prev/Next).
 * WHY: Allow moderators to navigate through multiple pages of applications.
 *
 * @param isAllView - When true, includes 'all' flag in custom IDs for pagination state
 */
function buildPaginationButtons(
  page: number,
  totalCount: number,
  nonce: string,
  isAllView: boolean = false
): ActionRowBuilder<ButtonBuilder>[] {
  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < totalCount;

  if (!hasPrev && !hasNext) {
    // No pagination needed
    return [];
  }

  const row = new ActionRowBuilder<ButtonBuilder>();
  const allFlag = isAllView ? ":all" : "";

  if (hasPrev) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`listopen:${nonce}:prev:${page}${allFlag}`)
        .setLabel("◀ Previous")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  if (hasNext) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`listopen:${nonce}:next:${page}${allFlag}`)
        .setLabel("Next ▶")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  return [row];
}

/**
 * WHAT: Main command executor for /listopen.
 * WHY: Entry point for listing open applications claimed by the moderator.
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;

  // Guild-only check (should be enforced by command definition, but double-check)
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  const reviewerId = interaction.user.id;
  const guildId = interaction.guildId;

  // Runtime permission check: reviewer role, owner, or staff permissions
  // This follows the project pattern: make command discoverable, enforce at runtime
  const member = interaction.member ? (await interaction.guild.members.fetch(reviewerId).catch(() => null)) : null;

  const isOwnerUser = isOwner(reviewerId);
  const isStaff = hasStaffPermissions(member, guildId);
  const isReviewerUser = isReviewer(guildId, member);

  if (!isOwnerUser && !isStaff && !isReviewerUser) {
    await interaction.reply({
      content: "❌ You don't have permission to use this command. This command is restricted to reviewers, staff, and server administrators.",
      ephemeral: true,
    });

    logger.warn(
      { userId: reviewerId, guildId, isOwner: isOwnerUser, isStaff, isReviewer: isReviewerUser },
      "[listopen] unauthorized access attempt"
    );
    return;
  }

  // Check scope option (default to "mine")
  const scope = interaction.options.getString("scope") ?? "mine";
  const isAllView = scope === "all";

  // Always defer publicly (ephemeral toggle removed)
  await interaction.deferReply({ ephemeral: false });

  try {
    // Fetch applications based on view mode
    const totalCount = isAllView
      ? countAllOpenApplications(guildId)
      : countOpenApplications(guildId, reviewerId);
    const apps = isAllView
      ? getAllOpenApplications(guildId, PAGE_SIZE, 0)
      : getOpenApplications(guildId, reviewerId, PAGE_SIZE, 0);

    // Build embed with clickable links
    const { embed, appUrls } = await buildListEmbed(interaction, apps, 0, totalCount, isAllView);

    // Build pagination buttons
    const nonce = generateNonce();
    const components = buildPaginationButtons(0, totalCount, nonce, isAllView);

    // Reply
    await interaction.editReply({
      embeds: [embed],
      components,
    });

    // Log action with appLink metadata
    await logActionPretty(interaction.guild, {
      actorId: reviewerId,
      action: isAllView ? "listopen_view_all" : "listopen_view",
      meta: {
        count: totalCount,
        page: 1,
        appLink: true,
        allView: isAllView,
      },
    });

    logger.info(
      { guildId, reviewerId, totalCount, isAllView },
      "[listopen] moderator viewed open applications"
    );
  } catch (err) {
    logger.error({ err, guildId, reviewerId }, "[listopen] command failed");

    await interaction.editReply({
      content: "❌ Failed to fetch your open applications. Please try again later.",
    }).catch(() => {
      // If edit fails, try a new reply
      interaction.followUp({
        content: "❌ Failed to fetch your open applications. Please try again later.",
        ephemeral: true,
      }).catch(() => {
        // Silently fail if we can't communicate with Discord
      });
    });
  }
}

/**
 * WHAT: Handle pagination button clicks (Prev/Next).
 * WHY: Allow moderators to navigate through pages of open applications.
 *
 * This should be registered as a button handler in src/index.ts:
 * if (customId.match(/^listopen:[a-f0-9]{8}:(prev|next):\d+(:(all))?$/)) {
 *   await handleListOpenPagination(interaction);
 * }
 */
export async function handleListOpenPagination(interaction: any): Promise<void> {
  const customId = interaction.customId;
  // Match with optional :all suffix
  const match = customId.match(/^listopen:([a-f0-9]{8}):(prev|next):(\d+)(:all)?$/);

  if (!match) {
    await interaction.reply({
      content: "❌ Invalid pagination button.",
      ephemeral: true,
    });
    return;
  }

  const [, nonce, direction, currentPageStr, allFlag] = match;
  const currentPage = parseInt(currentPageStr, 10);
  const newPage = direction === "next" ? currentPage + 1 : currentPage - 1;
  const isAllView = allFlag === ":all";

  if (newPage < 0) {
    await interaction.reply({
      content: "❌ You're already on the first page.",
      ephemeral: true,
    });
    return;
  }

  const reviewerId = interaction.user.id;
  const guildId = interaction.guildId!;

  await interaction.deferUpdate();

  try {
    // Fetch applications for new page based on view mode
    const totalCount = isAllView
      ? countAllOpenApplications(guildId)
      : countOpenApplications(guildId, reviewerId);
    const apps = isAllView
      ? getAllOpenApplications(guildId, PAGE_SIZE, newPage * PAGE_SIZE)
      : getOpenApplications(guildId, reviewerId, PAGE_SIZE, newPage * PAGE_SIZE);

    if (apps.length === 0 && newPage > 0) {
      await interaction.followUp({
        content: "❌ No more pages available.",
        ephemeral: true,
      });
      return;
    }

    // Build embed for new page with clickable links
    const { embed, appUrls } = await buildListEmbed(interaction, apps, newPage, totalCount, isAllView);

    // Build pagination buttons (reuse same nonce, preserve all flag)
    const components = buildPaginationButtons(newPage, totalCount, nonce, isAllView);

    // Update message
    await interaction.editReply({
      embeds: [embed],
      components,
    });

    logger.info(
      { guildId, reviewerId, page: newPage + 1, totalCount, isAllView },
      "[listopen] moderator navigated to page"
    );
  } catch (err) {
    logger.error({ err, guildId, reviewerId, page: newPage }, "[listopen] pagination failed");

    await interaction.followUp({
      content: "❌ Failed to load page. Please try again.",
      ephemeral: true,
    }).catch(() => {
      // Silently fail if we can't communicate with Discord
    });
  }
}
