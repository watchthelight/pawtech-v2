/**
 * Pawtropolis Tech — src/lib/roles.ts
 * WHAT: Role constants, hierarchy definitions, and permission helpers.
 * WHY: Centralized role management for strict role-based command gating.
 * DOCS:
 *  - Permission Matrix: See PERMS-MATRIX.md in project root
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { GuildMember } from "discord.js";

// =============================================================================
// Role IDs - Hardcoded for Pawtropolis server
// =============================================================================

/** Staff hierarchy roles (highest to lowest authority) */
export const ROLE_IDS = {
  // Hierarchy roles (rank order)
  SERVER_OWNER: "896070888779317254",
  COMMUNITY_MANAGER: "1190093021170114680",
  COMMUNITY_DEV_LEAD: "1382242769468260352",
  SENIOR_ADMIN: "1420440472169746623",
  ADMINISTRATOR: "896070888779317248",
  SENIOR_MOD: "1095757038899953774",
  MODERATOR: "896070888762535975",
  JUNIOR_MOD: "896070888762535966",
  GATEKEEPER: "896070888762535969",
  MOD_TEAM: "987662057069482024",

  // Special bypass roles
  SERVER_DEV: "1120074045883420753",

  // Functional roles (non-hierarchy)
  SERVER_ARTIST: "896070888749940770",
} as const;

/** Bot Owner user ID - always bypasses all permission checks */
export const BOT_OWNER_UID = "697169405422862417";

// =============================================================================
// Role Hierarchy (array order = rank, index 0 = highest)
// =============================================================================

/**
 * Hierarchy array - index 0 is highest rank.
 * Used for "X and above" permission checks.
 */
export const ROLE_HIERARCHY = [
  ROLE_IDS.SERVER_OWNER,        // 0 - Highest
  ROLE_IDS.COMMUNITY_MANAGER,   // 1
  ROLE_IDS.COMMUNITY_DEV_LEAD,  // 2
  ROLE_IDS.SENIOR_ADMIN,        // 3
  ROLE_IDS.ADMINISTRATOR,       // 4
  ROLE_IDS.SENIOR_MOD,          // 5
  ROLE_IDS.MODERATOR,           // 6
  ROLE_IDS.JUNIOR_MOD,          // 7
  ROLE_IDS.GATEKEEPER,          // 8
  ROLE_IDS.MOD_TEAM,            // 9 - Lowest
] as const;

/** Map role ID to its rank (0 = highest) */
export const ROLE_RANK: Record<string, number> = Object.fromEntries(
  ROLE_HIERARCHY.map((id, index) => [id, index])
);

// =============================================================================
// Role Name Mapping (for display in permission errors)
// =============================================================================

export const ROLE_NAMES: Record<string, string> = {
  [ROLE_IDS.SERVER_OWNER]: "Server Owner",
  [ROLE_IDS.COMMUNITY_MANAGER]: "Community Manager",
  [ROLE_IDS.COMMUNITY_DEV_LEAD]: "Community Development Lead",
  [ROLE_IDS.SENIOR_ADMIN]: "Senior Administrator",
  [ROLE_IDS.ADMINISTRATOR]: "Administrator",
  [ROLE_IDS.SENIOR_MOD]: "Senior Moderator",
  [ROLE_IDS.MODERATOR]: "Moderator",
  [ROLE_IDS.JUNIOR_MOD]: "Junior Moderator",
  [ROLE_IDS.GATEKEEPER]: "Gatekeeper",
  [ROLE_IDS.MOD_TEAM]: "Moderation Team",
  [ROLE_IDS.SERVER_DEV]: "Server Dev",
  [ROLE_IDS.SERVER_ARTIST]: "Server Artist",
};

// =============================================================================
// Permission Check Helpers
// =============================================================================

/**
 * Check if a user is the Bot Owner (always bypasses all permissions).
 */
export function isBotOwner(userId: string): boolean {
  return userId === BOT_OWNER_UID;
}

/**
 * Check if a member has the Server Dev role (parallel to Bot Owner).
 */
export function isServerDev(member: GuildMember | null): boolean {
  if (!member) return false;
  return member.roles.cache.has(ROLE_IDS.SERVER_DEV);
}

/**
 * Check if a user should bypass all permission checks.
 * Returns true for Bot Owner or Server Dev.
 */
export function shouldBypass(userId: string, member: GuildMember | null): boolean {
  return isBotOwner(userId) || isServerDev(member);
}

/**
 * Check if a member has a specific role.
 */
export function hasRole(member: GuildMember | null, roleId: string): boolean {
  if (!member) return false;
  return member.roles.cache.has(roleId);
}

/**
 * Check if a member has ANY of the specified roles.
 */
export function hasAnyRole(member: GuildMember | null, roleIds: string[]): boolean {
  if (!member) return false;
  return roleIds.some((id) => member.roles.cache.has(id));
}

/**
 * Check if a member has a role at or above the specified minimum rank.
 * @param member The guild member to check
 * @param minRoleId The minimum required role ID (e.g., ROLE_IDS.SENIOR_MOD for SM+)
 * @returns true if member has minRole or any higher-ranked role
 */
export function hasRoleOrAbove(member: GuildMember | null, minRoleId: string): boolean {
  if (!member) return false;

  const minRank = ROLE_RANK[minRoleId];
  if (minRank === undefined) {
    // Role not in hierarchy - treat as explicit check
    return member.roles.cache.has(minRoleId);
  }

  // Check if member has any role at or above the minimum rank
  for (const roleId of ROLE_HIERARCHY) {
    const roleRank = ROLE_RANK[roleId];
    if (roleRank !== undefined && roleRank <= minRank && member.roles.cache.has(roleId)) {
      return true;
    }
  }

  return false;
}

/**
 * Get all roles at or above a specified rank.
 * Useful for building permission requirement lists.
 * @param minRoleId The minimum role in the hierarchy
 * @returns Array of role IDs from minRole up to SERVER_OWNER
 */
export function getRolesAtOrAbove(minRoleId: string): string[] {
  const minRank = ROLE_RANK[minRoleId];
  if (minRank === undefined) return [minRoleId];

  return ROLE_HIERARCHY.filter((_, index) => index <= minRank);
}

/**
 * Get the display name for a role ID.
 */
export function getRoleName(roleId: string): string {
  return ROLE_NAMES[roleId] || `<@&${roleId}>`;
}

/**
 * Get a formatted string describing the minimum role requirement.
 * e.g., "Senior Moderator or above"
 */
export function getMinRoleDescription(minRoleId: string): string {
  const name = ROLE_NAMES[minRoleId];
  if (!name) return "Unknown role";

  const rank = ROLE_RANK[minRoleId];
  if (rank === undefined || rank === 0) {
    // Not in hierarchy or is highest - just show the role name
    return name;
  }

  return `${name} or above`;
}

// =============================================================================
// Pre-built Role Sets for Common Permission Levels
// =============================================================================

/** Gatekeeper only - for application handling */
export const GATEKEEPER_ONLY = [ROLE_IDS.GATEKEEPER];

/** Gatekeeper+ - Gatekeeper and all hierarchy roles above */
export const GATEKEEPER_PLUS = getRolesAtOrAbove(ROLE_IDS.GATEKEEPER);

/** Junior Moderator+ */
export const JUNIOR_MOD_PLUS = getRolesAtOrAbove(ROLE_IDS.JUNIOR_MOD);

/** Moderator+ */
export const MODERATOR_PLUS = getRolesAtOrAbove(ROLE_IDS.MODERATOR);

/** Senior Moderator+ */
export const SENIOR_MOD_PLUS = getRolesAtOrAbove(ROLE_IDS.SENIOR_MOD);

/** Administrator+ */
export const ADMIN_PLUS = getRolesAtOrAbove(ROLE_IDS.ADMINISTRATOR);

/** Senior Administrator+ */
export const SENIOR_ADMIN_PLUS = getRolesAtOrAbove(ROLE_IDS.SENIOR_ADMIN);

/** Community Manager+ */
export const COMMUNITY_MANAGER_PLUS = getRolesAtOrAbove(ROLE_IDS.COMMUNITY_MANAGER);

/** Server Artist role (for art commands) */
export const SERVER_ARTIST = [ROLE_IDS.SERVER_ARTIST];

/** Server Artist OR Admin+ (for art management) */
export const ARTIST_OR_ADMIN = [ROLE_IDS.SERVER_ARTIST, ...ADMIN_PLUS];
