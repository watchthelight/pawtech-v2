/**
 * Pawtropolis Tech — src/features/artistRotation/constants.ts
 * WHAT: Constants for the Server Artist rotation system.
 * WHY: Centralize role IDs and ticket mappings for easy maintenance.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/** Server Artist role - members with this role are in the rotation queue */
export const ARTIST_ROLE_ID = "896070888749940770";

/** Community Ambassador role - can use /redeemreward command */
export const AMBASSADOR_ROLE_ID = "896070888762535967";

/** Server artist coordination channel */
export const SERVER_ARTIST_CHANNEL_ID = "1131332813585661982";

/** Ticket role IDs mapped by art type */
export const TICKET_ROLES = {
  headshot: "929950578379993108",
  halfbody: "1402298352560902224",
  emoji: "1414982808631377971",
  fullbody: null, // TBD - create role if needed
} as const;

/** Human-readable names for ticket roles */
export const TICKET_ROLE_NAMES: Record<string, string> = {
  "929950578379993108": "OC Headshot Ticket",
  "1402298352560902224": "OC Half-body Ticket",
  "1414982808631377971": "OC Emoji Ticket",
};

/** Art types as a union type */
export type ArtType = keyof typeof TICKET_ROLES;

/** All valid art types for command choices */
export const ART_TYPES: ArtType[] = ["headshot", "halfbody", "emoji", "fullbody"];

/** Display names for art types */
export const ART_TYPE_DISPLAY: Record<ArtType, string> = {
  headshot: "OC Headshot",
  halfbody: "OC Half-body",
  emoji: "OC Emoji",
  fullbody: "OC Full-body",
};
