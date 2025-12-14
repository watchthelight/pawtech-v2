/**
 * Pawtropolis Tech — src/features/artistRotation/constants.ts
 * WHAT: Constants and config accessors for the Server Artist rotation system.
 * WHY: Centralize role IDs and ticket mappings; supports per-guild config with fallbacks.
 * DOCS:
 *  - Issue #78: Move hardcoded IDs to database config
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { getConfig } from "../../lib/config.js";

/** Artist rotation configuration retrieved from guild config */
export interface ArtistRotationConfig {
  artistRoleId: string;
  ambassadorRoleId: string;
  serverArtistChannelId: string;
  ticketRoles: TicketRolesConfig;
}

/** Ticket role IDs keyed by art type */
export interface TicketRolesConfig {
  headshot: string | null;
  halfbody: string | null;
  emoji: string | null;
  fullbody: string | null;
}

/*
 * =============================================================================
 * FALLBACK VALUES (hardcoded for main guild backward compatibility)
 * =============================================================================
 *
 * These are the original hardcoded IDs from before we had per-guild config.
 * They're still used as defaults when a guild hasn't configured their own.
 * Yes, it's ugly having Discord IDs in source code. Issue #78 is about this.
 */

/** Server Artist role - members with this role are in the rotation queue */
export const ARTIST_ROLE_ID = "896070888749940770";

// The "do not add to queue" list. Usually bot accounts or special cases.
// This is the fallback - real config comes from /config set artist_ignored_users.
const FALLBACK_IGNORED_ARTIST_USER_IDS: Set<string> = new Set([
  "840832083084836942", // Legacy value - ask leadership why this person is special
]);

/**
 * getIgnoredArtistUsers
 * WHAT: Get the set of user IDs to exclude from artist queue for a guild.
 * WHY: Allows per-guild configuration of ignored users via /config set artist_ignored_users.
 * @param guildId - The guild ID to get config for
 * @returns Set of user IDs to exclude
 */
export function getIgnoredArtistUsers(guildId: string): Set<string> {
  const cfg = getConfig(guildId);
  if (cfg?.artist_ignored_users_json) {
    try {
      const parsed = JSON.parse(cfg.artist_ignored_users_json);
      if (Array.isArray(parsed)) {
        return new Set(parsed);
      }
    } catch {
      // Someone put garbage in the config. Their problem, fallback wins.
    }
  }
  return FALLBACK_IGNORED_ARTIST_USER_IDS;
}

/** Community Ambassador role - can use /redeemreward command */
export const AMBASSADOR_ROLE_ID = "896070888762535967";

/** Server artist coordination channel */
export const SERVER_ARTIST_CHANNEL_ID = "1131332813585661982";

/*
 * Ticket roles represent "this user has earned X type of art reward".
 * The bot removes the role when they redeem it. If your server doesn't
 * use ticket roles, set these to null in guild config.
 */
export const TICKET_ROLES: TicketRolesConfig = {
  headshot: "929950578379993108",
  halfbody: "1402298352560902224",
  emoji: "1414982808631377971",
  fullbody: "1449799905421033595",
};

// =============================================================================
// CONFIG ACCESSOR FUNCTIONS
// =============================================================================

/**
 * getArtistConfig
 * WHAT: Retrieves artist rotation config for a guild, with fallback to hardcoded values.
 * WHY: Allows per-guild configuration while maintaining backward compatibility.
 * @param guildId - The guild ID to get config for
 * @returns ArtistRotationConfig with guild-specific or fallback values
 */
export function getArtistConfig(guildId: string): ArtistRotationConfig {
  const cfg = getConfig(guildId);

  /*
   * GOTCHA: We merge with fallbacks per-field, not wholesale. This means you
   * can override just headshot and keep the other defaults. Probably what you
   * want, but could be surprising if you expected a clean slate.
   */
  let ticketRoles: TicketRolesConfig = TICKET_ROLES;
  if (cfg?.artist_ticket_roles_json) {
    try {
      const parsed = JSON.parse(cfg.artist_ticket_roles_json);
      ticketRoles = {
        headshot: parsed.headshot ?? TICKET_ROLES.headshot,
        halfbody: parsed.halfbody ?? TICKET_ROLES.halfbody,
        emoji: parsed.emoji ?? TICKET_ROLES.emoji,
        fullbody: parsed.fullbody ?? TICKET_ROLES.fullbody,
      };
    } catch {
      // Bad JSON in config. Fall through to defaults.
      ticketRoles = TICKET_ROLES;
    }
  }

  return {
    artistRoleId: cfg?.artist_role_id ?? ARTIST_ROLE_ID,
    ambassadorRoleId: cfg?.ambassador_role_id ?? AMBASSADOR_ROLE_ID,
    serverArtistChannelId: cfg?.server_artist_channel_id ?? SERVER_ARTIST_CHANNEL_ID,
    ticketRoles,
  };
}

/**
 * getArtistRoleId
 * WHAT: Get the artist role ID for a guild.
 * WHY: Convenience function for role sync operations.
 */
export function getArtistRoleId(guildId: string): string {
  return getArtistConfig(guildId).artistRoleId;
}

/**
 * getAmbassadorRoleId
 * WHAT: Get the ambassador role ID for a guild.
 * WHY: Convenience function for permission checks.
 */
export function getAmbassadorRoleId(guildId: string): string {
  return getArtistConfig(guildId).ambassadorRoleId;
}

/**
 * getTicketRoles
 * WHAT: Get ticket role configuration for a guild.
 * WHY: Used by handlers to look up role IDs by art type.
 */
export function getTicketRoles(guildId: string): TicketRolesConfig {
  return getArtistConfig(guildId).ticketRoles;
}

/*
 * Human-readable names for ticket roles. Used in log messages.
 * GOTCHA: This only covers the fallback role IDs. If a guild uses custom
 * role IDs, we just display the art type instead. Good enough.
 */
export const TICKET_ROLE_NAMES: Record<string, string> = {
  "929950578379993108": "OC Headshot Ticket",
  "1402298352560902224": "OC Half-body Ticket",
  "1414982808631377971": "OC Emoji Ticket",
  "1449799905421033595": "OC Full-body Ticket",
};

// Deriving the union from the config object. Add a new field there,
// and it automatically becomes a valid art type. TypeScript is nice sometimes.
export type ArtType = keyof TicketRolesConfig;

/** All valid art types for command choices */
export const ART_TYPES: ArtType[] = ["headshot", "halfbody", "emoji", "fullbody"];

/** Display names for art types */
export const ART_TYPE_DISPLAY: Record<ArtType, string> = {
  headshot: "OC Headshot",
  halfbody: "OC Half-body",
  emoji: "OC Emoji",
  fullbody: "OC Full-body",
};
