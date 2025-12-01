/**
 * Pawtropolis Tech — src/features/artJobs/types.ts
 * WHAT: Type definitions for art job tracking system.
 * WHY: Centralize types for jobs, statuses, and database rows.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/** Valid job statuses in progression order */
export const JOB_STATUSES = ["assigned", "sketching", "lining", "coloring", "done"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Database row for art_job table */
export interface ArtJobRow {
  id: number;
  guild_id: string;
  job_number: number;
  artist_id: string;
  artist_job_number: number;
  recipient_id: string;
  ticket_type: string;
  status: JobStatus;
  assigned_at: string;
  updated_at: string;
  completed_at: string | null;
  notes: string | null;
  assignment_log_id: number | null;
}

/** Options for creating a new art job */
export interface CreateJobOptions {
  guildId: string;
  artistId: string;
  recipientId: string;
  ticketType: string;
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

/** Leaderboard entry */
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
