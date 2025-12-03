/**
 * Pawtropolis Tech — src/features/artistRotation/types.ts
 * WHAT: TypeScript types for the Server Artist rotation system.
 * WHY: Type safety for queue operations and assignment tracking.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { ArtType } from "./constants.js";

/*
 * GOTCHA: These interfaces mirror the SQLite schema exactly. If you modify
 * the migration, update these or enjoy runtime type mismatches that TypeScript
 * smugly promised you would never have.
 */

/** Database row for artist_queue table */
export interface ArtistQueueRow {
  id: number;
  guild_id: string;
  user_id: string;
  position: number;
  added_at: string;
  assignments_count: number;
  last_assigned_at: string | null;
  // WHY number instead of boolean? SQLite doesn't have a boolean type,
  // and better-sqlite3 returns 0/1. We just live with it.
  skipped: number;
  skip_reason: string | null;
}

/** Database row for artist_assignment_log table */
export interface ArtistAssignmentRow {
  id: number;
  guild_id: string;
  artist_id: string;
  recipient_id: string;
  ticket_type: string;
  ticket_role_id: string | null;
  assigned_by: string;
  assigned_at: string;
  channel_id: string | null;
  // Same deal as skipped - SQLite "boolean"
  override: number;
}

/*
 * TicketInspection answers the existential question: "What art does this
 * person deserve, and do we have a role to prove it?"
 */

/** Result of inspecting a user's ticket roles */
export interface TicketInspection {
  hasHeadshot: boolean;
  hasHalfbody: boolean;
  hasEmoji: boolean;
  hasFullbody: boolean;
  hasRequestedType: boolean;
  requestedType: ArtType;
  matchingRoleId: string | null;
  allTicketRoles: string[];
}

/** Result of getting the next artist from queue */
export interface NextArtistResult {
  userId: string;
  position: number;
  assignmentsCount: number;
  lastAssignedAt: string | null;
}

// All the data we need to record "who drew what for whom and why"
/** Options for creating an assignment */
export interface AssignmentOptions {
  guildId: string;
  artistId: string;
  recipientId: string;
  ticketType: ArtType;
  ticketRoleId: string | null;
  assignedBy: string;
  channelId: string | null;
  override: boolean;
}

/** Sync result when syncing queue with role holders */
export interface SyncResult {
  added: string[];
  removed: string[];
  unchanged: string[];
}
