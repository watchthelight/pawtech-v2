/**
 * Pawtropolis Tech — src/features/artJobs/store.ts
 * WHAT: Database operations for art job tracking.
 * WHY: CRUD operations for jobs, status updates, and leaderboard queries.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import type {
  ArtJobRow,
  CreateJobOptions,
  CreateJobResult,
  UpdateJobOptions,
  LeaderboardEntry,
  ArtistMonthlyStats,
  JobStatus,
} from "./types.js";

/**
 * getNextJobNumber
 * WHAT: Get the next global job number for a guild.
 */
function getNextJobNumber(guildId: string): number {
  const row = db
    .prepare(`SELECT MAX(job_number) as max_num FROM art_job WHERE guild_id = ?`)
    .get(guildId) as { max_num: number | null } | undefined;
  return (row?.max_num ?? 0) + 1;
}

/**
 * getNextArtistJobNumber
 * WHAT: Get the next per-artist job number.
 */
function getNextArtistJobNumber(guildId: string, artistId: string): number {
  const row = db
    .prepare(`SELECT MAX(artist_job_number) as max_num FROM art_job WHERE guild_id = ? AND artist_id = ?`)
    .get(guildId, artistId) as { max_num: number | null } | undefined;
  return (row?.max_num ?? 0) + 1;
}

/**
 * createJob
 * WHAT: Create a new art job when an assignment is made.
 * WHY: Called from redeemreward handler to track the job.
 */
export function createJob(options: CreateJobOptions): CreateJobResult {
  const jobNumber = getNextJobNumber(options.guildId);
  const artistJobNumber = getNextArtistJobNumber(options.guildId, options.artistId);

  const result = db
    .prepare(
      `INSERT INTO art_job (guild_id, job_number, artist_id, artist_job_number, recipient_id, ticket_type, assignment_log_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      options.guildId,
      jobNumber,
      options.artistId,
      artistJobNumber,
      options.recipientId,
      options.ticketType,
      options.assignmentLogId ?? null
    );

  logger.info(
    {
      guildId: options.guildId,
      jobNumber,
      artistJobNumber,
      artistId: options.artistId,
      recipientId: options.recipientId,
      ticketType: options.ticketType,
    },
    "[artJobs] Job created"
  );

  return {
    id: result.lastInsertRowid as number,
    jobNumber,
    artistJobNumber,
  };
}

/**
 * getJobById
 * WHAT: Get a job by its database ID.
 */
export function getJobById(jobId: number): ArtJobRow | null {
  const row = db.prepare(`SELECT * FROM art_job WHERE id = ?`).get(jobId) as ArtJobRow | undefined;
  return row ?? null;
}

/**
 * getJobByNumber
 * WHAT: Get a job by global job number.
 */
export function getJobByNumber(guildId: string, jobNumber: number): ArtJobRow | null {
  const row = db
    .prepare(`SELECT * FROM art_job WHERE guild_id = ? AND job_number = ?`)
    .get(guildId, jobNumber) as ArtJobRow | undefined;
  return row ?? null;
}

/**
 * getJobByArtistNumber
 * WHAT: Get a job by artist's personal job number.
 */
export function getJobByArtistNumber(guildId: string, artistId: string, artistJobNumber: number): ArtJobRow | null {
  const row = db
    .prepare(`SELECT * FROM art_job WHERE guild_id = ? AND artist_id = ? AND artist_job_number = ?`)
    .get(guildId, artistId, artistJobNumber) as ArtJobRow | undefined;
  return row ?? null;
}

/**
 * getJobByRecipient
 * WHAT: Get an active job by recipient and ticket type.
 * WHY: Allows artists to reference jobs by @user + type.
 */
export function getJobByRecipient(
  guildId: string,
  artistId: string,
  recipientId: string,
  ticketType: string
): ArtJobRow | null {
  const row = db
    .prepare(
      `SELECT * FROM art_job
       WHERE guild_id = ? AND artist_id = ? AND recipient_id = ? AND ticket_type = ? AND status != 'done'
       ORDER BY assigned_at DESC LIMIT 1`
    )
    .get(guildId, artistId, recipientId, ticketType) as ArtJobRow | undefined;
  return row ?? null;
}

/**
 * getActiveJobsForArtist
 * WHAT: Get all non-done jobs for an artist.
 */
export function getActiveJobsForArtist(guildId: string, artistId: string): ArtJobRow[] {
  return db
    .prepare(
      `SELECT * FROM art_job
       WHERE guild_id = ? AND artist_id = ? AND status != 'done'
       ORDER BY artist_job_number ASC`
    )
    .all(guildId, artistId) as ArtJobRow[];
}

/**
 * getAllActiveJobs
 * WHAT: Get all active jobs for a guild (staff view).
 */
export function getAllActiveJobs(guildId: string): ArtJobRow[] {
  return db
    .prepare(
      `SELECT * FROM art_job
       WHERE guild_id = ? AND status != 'done'
       ORDER BY job_number ASC`
    )
    .all(guildId) as ArtJobRow[];
}

/**
 * getActiveJobsForRecipient
 * WHAT: Get all non-done jobs where user is the recipient.
 * WHY: Let art reward recipients check progress of their commissioned art.
 */
export function getActiveJobsForRecipient(guildId: string, recipientId: string): ArtJobRow[] {
  return db
    .prepare(
      `SELECT * FROM art_job
       WHERE guild_id = ? AND recipient_id = ? AND status != 'done'
       ORDER BY assigned_at DESC`
    )
    .all(guildId, recipientId) as ArtJobRow[];
}

/**
 * updateJobStatus
 * WHAT: Update a job's status and/or notes.
 */
export function updateJobStatus(jobId: number, options: UpdateJobOptions): boolean {
  const updates: string[] = ["updated_at = datetime('now')"];
  const params: (string | null)[] = [];

  if (options.status !== undefined) {
    updates.push("status = ?");
    params.push(options.status);

    // Set completed_at if marking as done
    if (options.status === "done") {
      updates.push("completed_at = datetime('now')");
    }
  }

  if (options.notes !== undefined) {
    updates.push("notes = ?");
    params.push(options.notes);
  }

  params.push(String(jobId));

  const result = db.prepare(`UPDATE art_job SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  if (result.changes > 0) {
    logger.info({ jobId, ...options }, "[artJobs] Job updated");
    return true;
  }
  return false;
}

/**
 * finishJob
 * WHAT: Mark a job as done.
 */
export function finishJob(jobId: number): boolean {
  return updateJobStatus(jobId, { status: "done" });
}

/**
 * getMonthlyLeaderboard
 * WHAT: Get artists ranked by jobs completed this month.
 */
export function getMonthlyLeaderboard(guildId: string, limit = 10): LeaderboardEntry[] {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const startIso = startOfMonth.toISOString();

  return db
    .prepare(
      `SELECT artist_id as artistId, COUNT(*) as completedCount
       FROM art_job
       WHERE guild_id = ? AND status = 'done' AND completed_at >= ?
       GROUP BY artist_id
       ORDER BY completedCount DESC
       LIMIT ?`
    )
    .all(guildId, startIso, limit) as LeaderboardEntry[];
}

/**
 * getAllTimeLeaderboard
 * WHAT: Get artists ranked by all-time completed jobs.
 */
export function getAllTimeLeaderboard(guildId: string, limit = 10): LeaderboardEntry[] {
  return db
    .prepare(
      `SELECT artist_id as artistId, COUNT(*) as completedCount
       FROM art_job
       WHERE guild_id = ? AND status = 'done'
       GROUP BY artist_id
       ORDER BY completedCount DESC
       LIMIT ?`
    )
    .all(guildId, limit) as LeaderboardEntry[];
}

/**
 * getArtistStats
 * WHAT: Get monthly and all-time stats for a specific artist.
 */
export function getArtistStats(guildId: string, artistId: string): ArtistMonthlyStats {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const startIso = startOfMonth.toISOString();

  const monthly = db
    .prepare(
      `SELECT COUNT(*) as count FROM art_job
       WHERE guild_id = ? AND artist_id = ? AND status = 'done' AND completed_at >= ?`
    )
    .get(guildId, artistId, startIso) as { count: number };

  const allTime = db
    .prepare(
      `SELECT COUNT(*) as count FROM art_job
       WHERE guild_id = ? AND artist_id = ? AND status = 'done'`
    )
    .get(guildId, artistId) as { count: number };

  return {
    artistId,
    monthlyCompleted: monthly.count,
    allTimeCompleted: allTime.count,
  };
}

/**
 * formatJobNumber
 * WHAT: Format a job number as 4-digit padded string.
 */
export function formatJobNumber(num: number): string {
  return String(num).padStart(4, "0");
}
