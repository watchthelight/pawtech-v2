/**
 * Pawtropolis Tech — src/features/artistRotation/types.ts
 * WHAT: TypeScript types for the Server Artist rotation system.
 * WHY: Type safety for queue operations and assignment tracking.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { ArtType } from "./constants.js";

/** Database row for artist_queue table */
export interface ArtistQueueRow {
  id: number;
  guild_id: string;
  user_id: string;
  position: number;
  added_at: string;
  assignments_count: number;
  last_assigned_at: string | null;
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
  override: number;
}

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
