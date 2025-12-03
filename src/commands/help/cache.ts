/**
 * Pawtropolis Tech — src/commands/help/cache.ts
 * WHAT: Search index and permission filtering for the help system
 * WHY: Provides fast search and user-specific command filtering
 * FLOWS:
 *  - Search index built at module load for instant queries
 *  - Permission filtering based on user roles and guild config
 *  - LRU cache for filtered command lists
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { GuildMember } from "discord.js";
import { LRUCache } from "../../lib/lruCache.js";
import { isOwner } from "../../lib/owner.js";
import { hasStaffPermissions, isReviewer, canRunAllCommands } from "../../lib/config.js";
import { COMMAND_REGISTRY, getCommand } from "./registry.js";
import type { CommandMetadata, PermissionLevel, SearchResult, CommandCategory } from "./metadata.js";
import { logger } from "../../lib/logger.js";
import { randomBytes } from "node:crypto";

// ============================================================================
// Search Index
// ============================================================================

/**
 * Inverted search index mapping keywords to command names.
 * Built once at module load time.
 */
// WHY: Module-level Map instead of class - this runs once at startup and never
// gets rebuilt. If you add commands at runtime, you'll need to rebuild this.
const SEARCH_INDEX = new Map<string, Set<string>>();

/**
 * Build the search index from the command registry.
 * Called automatically at module load.
 */
function buildSearchIndex(): void {
  for (const cmd of COMMAND_REGISTRY) {
    const keywords = new Set<string>();

    // Command name and aliases
    keywords.add(cmd.name.toLowerCase());
    cmd.aliases?.forEach((a) => keywords.add(a.toLowerCase()));

    // Category
    keywords.add(cmd.category.toLowerCase());

    // Words from description (length > 2 to skip articles)
    // GOTCHA: "2" was chosen by gut feeling. "an", "to", "or" get filtered,
    // but so does "AI" and "ID". If users can't search "AI commands", now you know why.
    const descWords = cmd.description.toLowerCase().split(/\s+/);
    for (const word of descWords) {
      // Strip punctuation and check length
      const clean = word.replace(/[^a-z0-9]/g, "");
      if (clean.length > 2) {
        keywords.add(clean);
      }
    }

    // Subcommand names
    cmd.subcommands?.forEach((sc) => keywords.add(sc.name.toLowerCase()));
    cmd.subcommandGroups?.forEach((g) => {
      keywords.add(g.name.toLowerCase());
      g.subcommands.forEach((sc) => keywords.add(sc.name.toLowerCase()));
    });

    // Add to inverted index
    for (const keyword of keywords) {
      if (!SEARCH_INDEX.has(keyword)) {
        SEARCH_INDEX.set(keyword, new Set());
      }
      SEARCH_INDEX.get(keyword)!.add(cmd.name);
    }
  }

  logger.debug(
    { keywords: SEARCH_INDEX.size, commands: COMMAND_REGISTRY.length },
    "[help] search index built"
  );
}

// Build index on module load
buildSearchIndex();

/**
 * Search commands by keyword(s).
 * Multi-word queries use AND logic - all terms must match.
 *
 * @param query Search query string
 * @returns Array of matching command names sorted by relevance
 */
export function searchCommands(query: string): SearchResult[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => t.replace(/[^a-z0-9]/g, ""));

  if (terms.length === 0) {
    return [];
  }

  // Find commands matching all terms (AND logic)
  let matchingNames = new Set<string>();
  let firstTerm = true;

  for (const term of terms) {
    const termMatches = new Set<string>();

    /*
     * Check for partial matches in index. Yes, we iterate the entire index
     * for every search term. For the ~50 commands we have, this is fine.
     * If you add 1000 commands, maybe build a proper trie or something.
     */
    for (const [keyword, cmdNames] of SEARCH_INDEX) {
      if (keyword.includes(term) || term.includes(keyword)) {
        for (const name of cmdNames) {
          termMatches.add(name);
        }
      }
    }

    if (firstTerm) {
      matchingNames = termMatches;
      firstTerm = false;
    } else {
      // Intersection with previous matches
      const intersection = new Set<string>();
      for (const name of matchingNames) {
        if (termMatches.has(name)) {
          intersection.add(name);
        }
      }
      matchingNames = intersection;
    }

    // Early exit if no matches
    if (matchingNames.size === 0) {
      return [];
    }
  }

  // Score and sort results
  // These magic numbers (100, 90, 80, etc.) were calibrated by running
  // searches and seeing if the results felt right. Very scientific.
  const results: SearchResult[] = [];
  for (const name of matchingNames) {
    const cmd = getCommand(name);
    if (!cmd) continue;

    // Scoring: exact name match > alias match > description match
    let score = 0;
    let matchedOn: SearchResult["matchedOn"] = "description";

    const lowerName = cmd.name.toLowerCase();
    const queryLower = query.toLowerCase();

    // Exact name match
    if (lowerName === queryLower) {
      score = 100;
      matchedOn = "name";
    } else if (lowerName.startsWith(queryLower)) {
      score = 90;
      matchedOn = "name";
    } else if (lowerName.includes(queryLower)) {
      score = 80;
      matchedOn = "name";
    } else if (cmd.aliases?.some((a) => a.toLowerCase().includes(queryLower))) {
      score = 70;
      matchedOn = "alias";
    } else if (
      cmd.subcommands?.some((sc) => sc.name.toLowerCase().includes(queryLower)) ||
      cmd.subcommandGroups?.some(
        (g) =>
          g.name.toLowerCase().includes(queryLower) ||
          g.subcommands.some((sc) => sc.name.toLowerCase().includes(queryLower))
      )
    ) {
      score = 60;
      matchedOn = "subcommand";
    } else {
      score = 50;
      matchedOn = "description";
    }

    results.push({ command: cmd, score, matchedOn });
  }

  // Sort by score descending, then alphabetically
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.command.name.localeCompare(b.command.name);
  });

  return results;
}

// ============================================================================
// Permission Filtering
// ============================================================================

/**
 * Cache for permission-filtered command lists.
 * Key: `${guildId}:${userId}`, Value: filtered command names
 */
// 500 entries, 5 min TTL. If someone's roles change, call invalidatePermissionCache().
// Otherwise they'll see stale command lists for up to 5 minutes.
const PERMISSION_CACHE = new LRUCache<string, string[]>(500, 5 * 60 * 1000); // 5 min TTL

/**
 * Check if a user has access to a command based on permission level.
 */
function hasPermissionLevel(
  level: PermissionLevel,
  member: GuildMember | null,
  guildId: string,
  userId: string
): boolean {
  // Owner always has access
  if (isOwner(userId)) {
    return true;
  }

  // The permission hierarchy is: owner > admin > staff > reviewer > public
  // Each level includes all levels below it (admin can do staff things, etc.)
  switch (level) {
    case "public":
      return true;

    case "reviewer":
      // Reviewer, staff, or admin
      return member
        ? isReviewer(guildId, member) || hasStaffPermissions(member, guildId)
        : false;

    case "staff":
      // Staff or admin
      return member ? hasStaffPermissions(member, guildId) : false;

    case "admin":
      // Admin (canRunAllCommands which checks mod_role_ids and ManageGuild)
      return member ? canRunAllCommands(member, guildId) : false;

    case "owner":
      // Bot owner only (already checked above)
      return false;

    default:
      return false;
  }
}

/**
 * Filter commands based on user permissions.
 *
 * @param member Guild member to check permissions for
 * @param guildId Guild ID for config lookup
 * @returns Array of commands the user can access
 */
export function filterCommandsByPermission(
  member: GuildMember | null,
  guildId: string,
  userId: string
): CommandMetadata[] {
  // Check cache first
  const cacheKey = `${guildId}:${userId}`;
  const cached = PERMISSION_CACHE.get(cacheKey);

  if (cached) {
    return cached
      .map((name) => getCommand(name))
      .filter((cmd): cmd is CommandMetadata => cmd !== undefined);
  }

  // Filter commands by permission
  const filtered = COMMAND_REGISTRY.filter((cmd) =>
    hasPermissionLevel(cmd.permissionLevel, member, guildId, userId)
  );

  // Cache the result (just names to save memory)
  // WHY: Storing full CommandMetadata objects would bloat memory. Names are
  // ~20 bytes each; full objects are ~500+ bytes. We re-lookup on cache hit.
  PERMISSION_CACHE.set(
    cacheKey,
    filtered.map((cmd) => cmd.name)
  );

  return filtered;
}

/**
 * Get commands visible to a user in a specific category.
 */
export function getVisibleCommandsInCategory(
  category: CommandCategory,
  member: GuildMember | null,
  guildId: string,
  userId: string
): CommandMetadata[] {
  const all = filterCommandsByPermission(member, guildId, userId);
  return all.filter((cmd) => cmd.category === category);
}

/**
 * Count commands per category for a user.
 */
export function countCommandsByCategory(
  member: GuildMember | null,
  guildId: string,
  userId: string
): Map<CommandCategory, number> {
  const visible = filterCommandsByPermission(member, guildId, userId);
  const counts = new Map<CommandCategory, number>();

  for (const cmd of visible) {
    counts.set(cmd.category, (counts.get(cmd.category) ?? 0) + 1);
  }

  return counts;
}

/**
 * Invalidate permission cache for a user (call when roles change).
 */
export function invalidatePermissionCache(guildId: string, userId: string): void {
  PERMISSION_CACHE.delete(`${guildId}:${userId}`);
}

// ============================================================================
// Search Session Storage
// ============================================================================

/**
 * Temporary storage for search results (keyed by nonce).
 * Allows button navigation to search results.
 */
/*
 * 15 min TTL matches Discord's component interaction timeout. After that,
 * buttons die anyway, so there's no point keeping the session around.
 * 100 entries should handle concurrent users fine unless this bot goes viral.
 */
const SEARCH_SESSIONS = new LRUCache<string, { query: string; results: string[] }>(
  100,
  15 * 60 * 1000 // 15 min TTL matches Discord component timeout
);

/**
 * Generate a random nonce for search sessions.
 */
// 4 bytes = 8 hex chars = 4 billion possible values. Not cryptographically
// important, just needs to be unique enough that users can't guess each other's sessions.
export function generateNonce(): string {
  return randomBytes(4).toString("hex");
}

/**
 * Store search results for later retrieval.
 */
export function storeSearchSession(
  nonce: string,
  query: string,
  results: SearchResult[]
): void {
  SEARCH_SESSIONS.set(nonce, {
    query,
    results: results.map((r) => r.command.name),
  });
}

/**
 * Retrieve stored search results.
 */
export function getSearchSession(
  nonce: string
): { query: string; results: CommandMetadata[] } | null {
  const session = SEARCH_SESSIONS.get(nonce);
  if (!session) return null;

  // EDGE CASE: If commands were unregistered between storing and retrieving,
  // we silently drop them from results. Could confuse users if a command
  // vanishes mid-session, but it's better than crashing.
  return {
    query: session.query,
    results: session.results
      .map((name) => getCommand(name))
      .filter((cmd): cmd is CommandMetadata => cmd !== undefined),
  };
}
