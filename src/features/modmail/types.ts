/**
 * Pawtropolis Tech -- src/features/modmail/types.ts
 * WHAT: Shared types for the modmail system.
 * WHY: Centralize type definitions to avoid circular dependencies and enable clean imports.
 * DOCS:
 *  - TypeScript type exports: https://www.typescriptlang.org/docs/handbook/2/modules.html
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Attachment } from "discord.js";

// ===== Ticket Types =====

export type ModmailTicketStatus = "open" | "closed";

export type ModmailTicket = {
  id: number;
  guild_id: string;
  user_id: string;
  app_code: string | null;
  review_message_id: string | null;
  thread_id: string | null;
  thread_channel_id: string | null;
  status: ModmailTicketStatus;
  created_at: string;
  closed_at: string | null;
};

// ===== Transcript Types =====

export type TranscriptLine = {
  timestamp: string; // ISO 8601 format
  author: "STAFF" | "USER";
  content: string;
};

// ===== Message Mapping Types =====

export type ModmailMessageMap = {
  ticket_id: number;
  dm_message_id: string;
  thread_message_id: string;
  direction: "to_user" | "to_staff";
};

// ===== Embed Builder Args =====

export type StaffToUserEmbedArgs = {
  staffName: string;
  staffAvatarUrl: string | null;
  content: string;
  attachments: ReadonlyMap<string, Attachment>;
  guildName: string;
  guildIconUrl: string | null;
};

export type UserToStaffEmbedArgs = {
  userName: string;
  userAvatarUrl: string | null;
  userId: string;
  content: string;
  attachments: ReadonlyMap<string, Attachment>;
  appCode: string | null;
};

// ===== Open Thread Params =====

export type OpenPublicModmailThreadParams = {
  guild: import("discord.js").Guild;
  user: import("discord.js").User;
  parentChannelId: string;
  appCode: string | null;
  reviewMessageId: string | null;
  opener: import("discord.js").GuildMember;
};

// ===== Close Thread Params =====

export type CloseModmailThreadParams = {
  ticketId: number;
  threadId: string;
  closerId: string;
  client: import("discord.js").Client;
  skipDm?: boolean;
};

// ===== Reopen Thread Params =====

export type ReopenModmailThreadParams = {
  ticketId: number;
  threadId: string;
  reopenerId: string;
  client: import("discord.js").Client;
};
