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
  StringSelectMenuBuilder,
} from "discord.js";
import { db } from "../db/db.js";
import { shortCode } from "../lib/ids.js";
import { logActionPretty } from "../logging/pretty.js";
import { logger } from "../lib/logger.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { randomBytes } from "node:crypto";
import { hasStaffPermissions, isReviewer } from "../lib/config.js";
import { isOwner } from "../utils/owner.js";
import { LRUCache } from "../lib/lruCache.js";

/*
 * FINAL_STATUSES defines terminal application states. Once an app reaches one of
 * these, it won't appear in /listopen because there's nothing left to do.
 *
 * Note: Permanently rejected apps have status='rejected' with permanently_rejected=1.
 * The 'perm_reject' action type in review_action distinguishes them for re-application
 * eligibility checks, but for listing purposes they're all 'rejected'.
 */
const FINAL_STATUSES = ["approved", "rejected", "kicked"];

// 10 apps per page balances information density vs. embed field limits (25 max)
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

// LRU cache for draft applications with TTL and bounded size.
// Prevents unbounded memory growth proportional to guild count.
const CACHE_TTL_MS = 60_000; // 1 minute cache
const CACHE_MAX_SIZE = 1000; // Max guilds to cache

interface DraftsCacheEntry {
  apps: OpenApplication[];
  count: number;
}
const draftsCache = new LRUCache<string, DraftsCacheEntry>(CACHE_MAX_SIZE, CACHE_TTL_MS);

interface ReviewCardMapping {
  channel_id: string;
  message_id: string;
}

/*
 * PERMISSION STRATEGY:
 * setDefaultMemberPermissions(null) makes the command visible to everyone in the
 * command picker. We then check permissions at runtime (isOwner, isStaff, isReviewer).
 *
 * Why not use setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)?
 * Because reviewer_role members need access but may not have ManageGuild. Discord's
 * built-in permission system doesn't support custom role checks, so we do it ourselves.
 *
 * The tradeoff: users without permission see the command but get denied when they try
 * to use it. This is fine - the error message explains what's needed.
 */
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
        { name: "All (claimed + unclaimed)", value: "all" },
        { name: "Drafts (incomplete)", value: "drafts" }
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
  } catch (error) {
    logger.debug({ error }, "[listopen] Failed to resolve username");
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
 * WHAT: Fetch ALL open applications (both claimed and unclaimed).
 * WHY: Provides visibility into the entire review queue for coordination.
 * NOTE: Only shows submitted/needs_info apps, NOT drafts (those have their own view)
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
    LEFT JOIN review_claim rc ON rc.app_id = a.id
    WHERE a.guild_id = ?
      AND a.status IN ('submitted', 'needs_info')
    ORDER BY a.submitted_at ASC
    LIMIT ? OFFSET ?
  `;

  return db.prepare(query).all(guildId, limit, offset) as OpenApplication[];
}

/**
 * WHAT: Count total open applications (both claimed and unclaimed).
 * WHY: Needed for "all" view pagination.
 * NOTE: Only counts submitted/needs_info apps, NOT drafts
 */
function countAllOpenApplications(guildId: string): number {
  const query = `
    SELECT COUNT(*) as count
    FROM application a
    WHERE a.guild_id = ?
      AND a.status IN ('submitted', 'needs_info')
  `;

  const result = db.prepare(query).get(guildId) as { count: number } | undefined;
  return result?.count ?? 0;
}

/**
 * WHAT: Fetch ALL draft applications with caching.
 * WHY: Drafts change infrequently, so cache the full list for fast pagination.
 */
function getCachedDrafts(guildId: string): { apps: OpenApplication[]; count: number } {
  const cached = draftsCache.get(guildId);

  if (cached) {
    return { apps: cached.apps, count: cached.count };
  }

  // Fetch all drafts (typically small number)
  const query = `
    SELECT
      a.id,
      a.user_id,
      a.submitted_at,
      a.created_at,
      a.status,
      NULL as claimed_at
    FROM application a
    WHERE a.guild_id = ?
      AND a.status = 'draft'
    ORDER BY a.created_at DESC
  `;

  const apps = db.prepare(query).all(guildId) as OpenApplication[];
  const result = { apps, count: apps.length };
  draftsCache.set(guildId, result);

  return { apps, count: apps.length };
}

/**
 * WHAT: Fetch DRAFT applications with pagination from cache.
 * WHY: Fast pagination using cached data.
 */
function getDraftApplications(guildId: string, limit: number, offset: number): OpenApplication[] {
  const { apps } = getCachedDrafts(guildId);
  return apps.slice(offset, offset + limit);
}

/**
 * WHAT: Count total draft applications from cache.
 * WHY: Instant count using cached data.
 */
function countDraftApplications(guildId: string): number {
  const { count } = getCachedDrafts(guildId);
  return count;
}

/**
 * WHAT: Invalidate drafts cache for a guild.
 * WHY: Call when a draft is created/submitted/deleted.
 */
export function invalidateDraftsCache(guildId: string): void {
  draftsCache.delete(guildId);
}

/**
 * WHAT: Build the main embed showing open applications with clickable links.
 * WHY: Visual display of claimed apps needing review with direct navigation to review cards.
 *
 * @param viewMode - 'mine', 'all', or 'unclaimed'
 * @returns Object containing embed and array of app URLs for button generation
 */
async function buildListEmbed(
  interaction: ChatInputCommandInteraction,
  apps: OpenApplication[],
  page: number,
  totalCount: number,
  viewMode: "mine" | "all" | "drafts" = "mine"
): Promise<{ embed: EmbedBuilder; appUrls: Array<{ appId: string; url: string | null }> }> {
  const titles: Record<string, string> = {
    mine: "📋 Your Open Applications",
    all: "📋 All Open Applications",
    drafts: "📋 Draft Applications",
  };

  const emptyMessages: Record<string, string> = {
    mine: "You have no claimed applications pending review.",
    all: "There are no open applications server-wide.",
    drafts: "There are no draft applications.",
  };

  const descriptions: Record<string, string> = {
    mine: `Showing ${apps.length} claimed application${apps.length === 1 ? "" : "s"} that need your decision.`,
    all: `Showing ${apps.length} open application${apps.length === 1 ? "" : "s"} (claimed and unclaimed).`,
    drafts: `Showing ${apps.length} incomplete application${apps.length === 1 ? "" : "s"} not yet submitted.`,
  };

  const colors: Record<string, number> = {
    mine: 0x5865f2,    // Discord blurple
    all: 0xeb459e,     // Pink
    drafts: 0x99aab5,  // Gray
  };

  const embed = new EmbedBuilder()
    .setTitle(titles[viewMode])
    .setDescription(apps.length === 0 ? emptyMessages[viewMode] : descriptions[viewMode])
    .setColor(colors[viewMode])
    .setTimestamp();

  const appUrls: Array<{ appId: string; url: string | null }> = [];

  if (apps.length === 0) {
    const emptyFooters: Record<string, string> = {
      mine: "No open applications",
      all: "No open applications server-wide",
      drafts: "No draft applications",
    };
    embed.setFooter({ text: emptyFooters[viewMode] });
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
    const member = await guild.members.fetch(app.user_id).catch(() => null);
    const user = member ? null : await interaction.client.users.fetch(app.user_id).catch(() => null);

    const displayName = member?.user.tag ?? user?.tag ?? `User ${app.user_id}`;

    // Fetch reviewer info for "all" view, or show "Unclaimed" if no claim
    let claimInfo = "";
    if (viewMode === "all") {
      if (app.reviewer_id) {
        const reviewerMember = await guild.members.fetch(app.reviewer_id).catch(() => null);
        const reviewerUser = reviewerMember ? null : await interaction.client.users.fetch(app.reviewer_id).catch(() => null);

        if (reviewerMember) {
          claimInfo = `\n**Claimed by:** <@${app.reviewer_id}>`;
        } else if (reviewerUser) {
          claimInfo = `\n**Claimed by:** ${reviewerUser.tag}`;
        } else {
          claimInfo = `\n**Claimed by:** User ${app.reviewer_id}`;
        }
      } else {
        claimInfo = `\n⚠️ **Unclaimed**`;
      }
    } else if (viewMode === "mine") {
      claimInfo = `\n**Claimed:** ${claimedDisplay}`;
    }
    // drafts view: no claim info needed (drafts aren't claimed)

    // Build field value with link indicator
    const linkIndicator = appUrl ? "🔗 " : "";
    const fieldValue =
      `**Status:** \`${app.status}\`\n` +
      `**Submitted:** ${submittedDisplay}` +
      claimInfo +
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
  const footerSuffixes: Record<string, string> = {
    mine: "",
    all: " (All)",
    drafts: " (Drafts)",
  };
  embed.setFooter({
    text: `Showing ${startIdx}-${endIdx} of ${totalCount} • Page ${page + 1}${footerSuffixes[viewMode]}`,
  });

  return { embed, appUrls };
}

/**
 * WHAT: Build pagination controls (buttons or select menu).
 * WHY: Allow moderators to navigate through multiple pages of applications.
 *      Drafts view uses a page select menu for faster navigation.
 *
 * @param viewMode - 'mine', 'all', or 'drafts' - included in custom IDs for pagination state
 */
function buildPaginationButtons(
  page: number,
  totalCount: number,
  nonce: string,
  viewMode: "mine" | "all" | "drafts" = "mine"
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  if (totalPages <= 1) {
    // No pagination needed
    return [];
  }

  // For drafts view, use a page select menu for faster navigation
  if (viewMode === "drafts" && totalPages > 1) {
    const options = [];
    for (let i = 0; i < Math.min(totalPages, 25); i++) {
      const startItem = i * PAGE_SIZE + 1;
      const endItem = Math.min((i + 1) * PAGE_SIZE, totalCount);
      options.push({
        label: `Page ${i + 1}`,
        description: `Items ${startItem}-${endItem}`,
        value: `${i}`,
        default: i === page,
      });
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`listopen:${nonce}:page:drafts`)
      .setPlaceholder(`Page ${page + 1} of ${totalPages}`)
      .addOptions(options);

    return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)];
  }

  // For other views, use prev/next buttons
  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < totalCount;

  const row = new ActionRowBuilder<ButtonBuilder>();
  const modeFlag = viewMode === "mine" ? "" : `:${viewMode}`;

  if (hasPrev) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`listopen:${nonce}:prev:${page}${modeFlag}`)
        .setLabel("◀ Previous")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  if (hasNext) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`listopen:${nonce}:next:${page}${modeFlag}`)
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
  const scope = (interaction.options.getString("scope") ?? "mine") as "mine" | "all" | "drafts";

  // Always defer publicly (ephemeral toggle removed)
  await interaction.deferReply({ ephemeral: false });

  try {
    // Fetch applications based on view mode
    let totalCount: number;
    let apps: OpenApplication[];

    if (scope === "all") {
      totalCount = countAllOpenApplications(guildId);
      apps = getAllOpenApplications(guildId, PAGE_SIZE, 0);
    } else if (scope === "drafts") {
      totalCount = countDraftApplications(guildId);
      apps = getDraftApplications(guildId, PAGE_SIZE, 0);
    } else {
      totalCount = countOpenApplications(guildId, reviewerId);
      apps = getOpenApplications(guildId, reviewerId, PAGE_SIZE, 0);
    }

    // Build embed with clickable links
    const { embed, appUrls } = await buildListEmbed(interaction, apps, 0, totalCount, scope);

    // Build pagination buttons
    const nonce = generateNonce();
    const components = buildPaginationButtons(0, totalCount, nonce, scope);

    // Reply
    await interaction.editReply({
      embeds: [embed],
      components,
    });

    // Log action with appLink metadata
    const actionNames: Record<string, string> = {
      mine: "listopen_view",
      all: "listopen_view_all",
      drafts: "listopen_view_drafts",
    };
    await logActionPretty(interaction.guild, {
      actorId: reviewerId,
      action: actionNames[scope],
      meta: {
        count: totalCount,
        page: 1,
        appLink: true,
        viewMode: scope,
      },
    });

    logger.info(
      { guildId, reviewerId, totalCount, viewMode: scope },
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
 * Pagination button handler for /listopen.
 *
 * REGISTRATION: Add this to your button handler router in src/index.ts:
 *   if (customId.match(/^listopen:[a-f0-9]{8}:(prev|next):\d+(:(all|drafts))?$/)) {
 *     await handleListOpenPagination(interaction);
 *   }
 *
 * CUSTOM ID FORMAT: listopen:{nonce}:{direction}:{currentPage}[:viewMode]
 *   - nonce: 8-char hex, prevents button ID collisions across messages
 *   - direction: "prev" or "next"
 *   - currentPage: 0-indexed page number before navigation
 *   - :viewMode: optional suffix - "all" or "drafts" (default is "mine")
 *
 * EDGE CASE: If a user clicks "Next" but all remaining apps were resolved
 * since the embed was rendered, they'll see "No more pages available."
 */
export async function handleListOpenPagination(interaction: any): Promise<void> {
  const customId = interaction.customId;
  // Match with optional view mode suffix (:all or :drafts)
  const match = customId.match(/^listopen:([a-f0-9]{8}):(prev|next):(\d+)(:(all|drafts))?$/);

  if (!match) {
    await interaction.reply({
      content: "❌ Invalid pagination button.",
      ephemeral: true,
    });
    return;
  }

  const [, nonce, direction, currentPageStr, , modeValue] = match;
  const currentPage = parseInt(currentPageStr, 10);
  const newPage = direction === "next" ? currentPage + 1 : currentPage - 1;
  const viewMode: "mine" | "all" | "drafts" = (modeValue as "all" | "drafts") ?? "mine";

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
    let totalCount: number;
    let apps: OpenApplication[];

    if (viewMode === "all") {
      totalCount = countAllOpenApplications(guildId);
      apps = getAllOpenApplications(guildId, PAGE_SIZE, newPage * PAGE_SIZE);
    } else if (viewMode === "drafts") {
      totalCount = countDraftApplications(guildId);
      apps = getDraftApplications(guildId, PAGE_SIZE, newPage * PAGE_SIZE);
    } else {
      totalCount = countOpenApplications(guildId, reviewerId);
      apps = getOpenApplications(guildId, reviewerId, PAGE_SIZE, newPage * PAGE_SIZE);
    }

    if (apps.length === 0 && newPage > 0) {
      await interaction.followUp({
        content: "❌ No more pages available.",
        ephemeral: true,
      });
      return;
    }

    // Build embed for new page with clickable links
    const { embed, appUrls } = await buildListEmbed(interaction, apps, newPage, totalCount, viewMode);

    // Build pagination buttons (reuse same nonce, preserve view mode)
    const components = buildPaginationButtons(newPage, totalCount, nonce, viewMode);

    // Update message
    await interaction.editReply({
      embeds: [embed],
      components,
    });

    logger.info(
      { guildId, reviewerId, page: newPage + 1, totalCount, viewMode },
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

/**
 * Select menu handler for /listopen drafts page selection.
 *
 * REGISTRATION: Add this to your select menu handler router in src/index.ts:
 *   if (customId.match(/^listopen:[a-f0-9]{8}:page:drafts$/)) {
 *     await handleListOpenPageSelect(interaction);
 *   }
 *
 * CUSTOM ID FORMAT: listopen:{nonce}:page:drafts
 */
export async function handleListOpenPageSelect(interaction: any): Promise<void> {
  const customId = interaction.customId;
  const match = customId.match(/^listopen:([a-f0-9]{8}):page:drafts$/);

  if (!match) {
    await interaction.reply({
      content: "❌ Invalid page selector.",
      ephemeral: true,
    });
    return;
  }

  const [, nonce] = match;
  const selectedPage = parseInt(interaction.values[0], 10);
  const guildId = interaction.guildId!;
  const reviewerId = interaction.user.id;

  await interaction.deferUpdate();

  try {
    // Get drafts from cache (instant)
    const totalCount = countDraftApplications(guildId);
    const apps = getDraftApplications(guildId, PAGE_SIZE, selectedPage * PAGE_SIZE);

    // Build embed for selected page
    const { embed } = await buildListEmbed(interaction, apps, selectedPage, totalCount, "drafts");

    // Build pagination with new page selected
    const components = buildPaginationButtons(selectedPage, totalCount, nonce, "drafts");

    await interaction.editReply({
      embeds: [embed],
      components,
    });

    logger.info(
      { guildId, reviewerId, page: selectedPage + 1, totalCount },
      "[listopen] moderator jumped to drafts page via select menu"
    );
  } catch (err) {
    logger.error({ err, guildId, reviewerId, page: selectedPage }, "[listopen] page select failed");

    await interaction.followUp({
      content: "❌ Failed to load page. Please try again.",
      ephemeral: true,
    }).catch(() => {});
  }
}
