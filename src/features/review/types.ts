/**
 * Pawtropolis Tech -- src/features/review/types.ts
 * WHAT: Shared types for the review system.
 * WHY: Centralize type definitions to avoid circular dependencies and enable clean imports.
 * DOCS:
 *  - TypeScript type exports: https://www.typescriptlang.org/docs/handbook/2/modules.html
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { ButtonInteraction, ChatInputCommandInteraction, ModalSubmitInteraction } from "discord.js";

// ===== Application Types =====

export type ApplicationStatus = "draft" | "submitted" | "approved" | "rejected" | "needs_info" | "kicked";

export type ApplicationRow = {
  id: string;
  guild_id: string;
  user_id: string;
  status: ApplicationStatus;
};

// ===== Review Answer Types =====

export type ReviewAnswer = {
  q_index: number;
  question: string;
  answer: string;
};

// ===== Review Action Types =====

export type ReviewActionMeta = {
  dmDelivered?: boolean;
  dmError?: string;
  roleApplied?: boolean;
  kickSucceeded?: boolean;
  kickError?: string;
} | null;

// Union type for review actions - used for type safety throughout review flows
export type ReviewActionKind =
  | "approve"
  | "reject"
  | "perm_reject"
  | "need_info"
  | "kick"
  | "copy_uid"
  | "claim";

export type ReviewActionSnapshot = {
  action: ReviewActionKind;
  moderator_id: string;
  moderatorTag?: string;
  reason?: string | null;
  created_at: number; // Unix epoch seconds (consistent with review_action.created_at)
  meta: ReviewActionMeta;
};

// ===== Review Claim Types =====

export type ReviewClaimRow = {
  app_id: string;
  reviewer_id: string;
  claimed_at: string; // ISO timestamp string (stored as TEXT in SQLite)
};

/**
 * Convert claimed_at string to Date object
 * @param claimed_at - ISO timestamp string from database
 * @returns Date object
 */
export function claimedAtToDate(claimed_at: string): Date {
  return new Date(claimed_at);
}

/**
 * Convert claimed_at string to Unix epoch seconds
 * @param claimed_at - ISO timestamp string from database
 * @returns Unix epoch seconds
 */
export function claimedAtToEpoch(claimed_at: string): number {
  return Math.floor(new Date(claimed_at).getTime() / 1000);
}

// ===== Review Card Types =====

export type ReviewCardApplication = {
  id: string;
  guild_id: string;
  user_id: string;
  status: ApplicationStatus;
  created_at: string;
  submitted_at: string | null;
  updated_at: string | null;
  resolved_at: string | null;
  resolver_id: string | null;
  resolution_reason: string | null;
  userTag: string;
  avatarUrl?: string | null;
  lastAction?: ReviewActionSnapshot | null;
};

export type ReviewCardRow = {
  channel_id: string;
  message_id: string;
};

// ===== Avatar Scan Types =====

/**
 * UI representation of avatar scan results (camelCase).
 * For database row representation, see AvatarScanDbRow in src/features/avatarScan.ts
 */
export type AvatarScanRow = {
  finalPct: number;
  nsfwScore: number | null;
  edgeScore: number;
  furryScore: number;
  scalieScore: number;
  reason: string;
  evidence: {
    hard: Array<{ tag: string; p: number }>;
    soft: Array<{ tag: string; p: number }>;
    safe: Array<{ tag: string; p: number }>;
  };
};

// ===== Transaction Result Types =====

export type TxResult =
  | { kind: "changed"; reviewActionId: number }
  | { kind: "already"; status: string }
  | { kind: "terminal"; status: string }
  | { kind: "invalid"; status: string };

// ===== Interaction Types =====

export type ReviewStaffInteraction =
  | ButtonInteraction
  | ModalSubmitInteraction
  | ChatInputCommandInteraction;

export type ReviewActionInteraction = ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction;

// ===== Approve Flow Types =====

export type ApproveFlowResult = {
  roleApplied: boolean;
  member: import("discord.js").GuildMember | null;
  roleError?: {
    code?: number;
    message?: string;
  } | null;
};

// ===== Welcome Types =====

export type WelcomeFailureReason =
  | "missing_channel"
  | "invalid_channel"
  | "missing_permissions"
  | "fetch_failed"
  | "send_failed";

export type WelcomeResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: WelcomeFailureReason; error?: unknown };

export type RenderWelcomeTemplateOptions = {
  template: string | null | undefined;
  guildName: string;
  applicant: {
    id: string;
    tag?: string | null;
    display?: string | null;
  };
};
