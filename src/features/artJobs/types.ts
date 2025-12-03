/**
 * Pawtropolis Tech — src/features/artJobs/types.ts
 * WHAT: Type definitions for art job tracking system.
 * WHY: Centralize types for jobs, statuses, and database rows.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/*
 * GOTCHA: The order here matters. Commands that cycle status forward
 * rely on indexOf to find the "next" state. If you reorder this,
 * artists might go from sketching straight to done. Ask me how I know.
 */
export const JOB_STATUSES = ["assigned", "sketching", "lining", "coloring", "done"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/*
 * Database row for art_job table.
 * WHY two job numbers? job_number is global for staff tracking,
 * artist_job_number is per-artist so they can say "my job #3" without
 * needing to remember 4-digit guild-wide IDs.
 */
export interface ArtJobRow {
  id: number;
  guild_id: string;
  // Global monotonic counter across the guild
  job_number: number;
  artist_id: string;
  // Per-artist counter, resets for each artist
  artist_job_number: number;
  recipient_id: string;
  ticket_type: string;
  status: JobStatus;
  // ISO strings because SQLite doesn't have a real datetime type
  assigned_at: string;
  updated_at: string;
  completed_at: string | null;
  notes: string | null;
  // Links back to the assignment log entry that spawned this job
  assignment_log_id: number | null;
}

/** Options for creating a new art job */
export interface CreateJobOptions {
  guildId: string;
  artistId: string;
  recipientId: string;
  // ticketType comes from the reward system - "icon", "fullbody", etc.
  ticketType: string;
  // Optional link to the audit trail. Technically optional but you should
  // always pass it unless you're doing weird manual job creation.
  assignmentLogId?: number;
}

/** Result from creating a job */
export interface CreateJobResult {
  id: number;
  jobNumber: number;
  artistJobNumber: number;
}

/** Options for updating job status */
export interface UpdateJobOptions {
  status?: JobStatus;
  notes?: string;
}

// Leaderboard entry. Kept minimal because we fetch usernames at display time.
export interface LeaderboardEntry {
  artistId: string;
  completedCount: number;
}

/** Monthly stats for an artist */
export interface ArtistMonthlyStats {
  artistId: string;
  monthlyCompleted: number;
  allTimeCompleted: number;
}
