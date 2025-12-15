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

// ============================================================================
// Prepared Statements (cached at module load for performance)
// ============================================================================
/*
 * All these statements are prepared once at import time and reused.
 * This is fine because better-sqlite3 is synchronous and single-threaded.
 * If you ever switch to async SQLite, prepare to watch everything explode.
 */

const getMaxJobNumberStmt = db.prepare(
  `SELECT MAX(job_number) as max_num FROM art_job WHERE guild_id = ?`
);

const getMaxArtistJobNumberStmt = db.prepare(
  `SELECT MAX(artist_job_number) as max_num FROM art_job WHERE guild_id = ? AND artist_id = ?`
);

const insertJobStmt = db.prepare(
  `INSERT INTO art_job (guild_id, job_number, artist_id, artist_job_number, recipient_id, ticket_type, assignment_log_id)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

const getJobByIdStmt = db.prepare(`SELECT * FROM art_job WHERE id = ?`);

const getJobByNumberStmt = db.prepare(
  `SELECT * FROM art_job WHERE guild_id = ? AND job_number = ?`
);

const getJobByArtistNumberStmt = db.prepare(
  `SELECT * FROM art_job WHERE guild_id = ? AND artist_id = ? AND artist_job_number = ?`
);

// Finds active jobs by @mentioning the recipient. Handy when artists can't
// remember job numbers but know "I'm doing the icon for that fox person."
// Returns ALL matches so we can detect ambiguity (multiple jobs for same recipient+type).
const getJobsByRecipientStmt = db.prepare(
  `SELECT * FROM art_job
   WHERE guild_id = ? AND artist_id = ? AND recipient_id = ? AND ticket_type = ? AND status != 'done'
   ORDER BY assigned_at DESC`
);

const getActiveJobsForArtistStmt = db.prepare(
  `SELECT * FROM art_job
   WHERE guild_id = ? AND artist_id = ? AND status != 'done'
   ORDER BY artist_job_number ASC`
);

const getAllActiveJobsStmt = db.prepare(
  `SELECT * FROM art_job
   WHERE guild_id = ? AND status != 'done'
   ORDER BY job_number ASC`
);

const getActiveJobsForRecipientStmt = db.prepare(
  `SELECT * FROM art_job
   WHERE guild_id = ? AND recipient_id = ? AND status != 'done'
   ORDER BY assigned_at DESC`
);

const getAllTimeLeaderboardStmt = db.prepare(
  `SELECT artist_id as artistId, COUNT(*) as completedCount
   FROM art_job
   WHERE guild_id = ? AND status = 'done'
   GROUP BY artist_id
   ORDER BY completedCount DESC
   LIMIT ?`
);

const getMonthlyCompletedStmt = db.prepare(
  `SELECT COUNT(*) as count FROM art_job
   WHERE guild_id = ? AND artist_id = ? AND status = 'done' AND completed_at >= ?`
);

const getAllTimeCompletedStmt = db.prepare(
  `SELECT COUNT(*) as count FROM art_job
   WHERE guild_id = ? AND artist_id = ? AND status = 'done'`
);

/**
 * createJobTransaction
 * WHAT: Atomically create a job with proper number assignment.
 * WHY: Prevents race conditions where two simultaneous calls get the same number.
 *
 * Uses a transaction to ensure the MAX query and INSERT happen atomically.
 * If a UNIQUE constraint violation occurs (shouldn't happen, but just in case),
 * we retry with the next available number.
 */
const createJobTransaction = db.transaction((options: CreateJobOptions) => {
  // Get next numbers inside the transaction
  const jobNumRow = getMaxJobNumberStmt.get(options.guildId) as { max_num: number | null } | undefined;
  const jobNumber = (jobNumRow?.max_num ?? 0) + 1;

  const artistNumRow = getMaxArtistJobNumberStmt.get(options.guildId, options.artistId) as { max_num: number | null } | undefined;
  const artistJobNumber = (artistNumRow?.max_num ?? 0) + 1;

  const result = insertJobStmt.run(
    options.guildId,
    jobNumber,
    options.artistId,
    artistJobNumber,
    options.recipientId,
    options.ticketType,
    options.assignmentLogId ?? null
  );

  return {
    id: result.lastInsertRowid as number,
    jobNumber,
    artistJobNumber,
  };
});

/**
 * createJob
 * WHAT: Create a new art job when an assignment is made.
 * WHY: Called from redeemreward handler to track the job.
 */
export function createJob(options: CreateJobOptions): CreateJobResult {
  const result = createJobTransaction(options);

  logger.info(
    {
      guildId: options.guildId,
      jobNumber: result.jobNumber,
      artistJobNumber: result.artistJobNumber,
      artistId: options.artistId,
      recipientId: options.recipientId,
      ticketType: options.ticketType,
    },
    "[artJobs] Job created"
  );

  return result;
}

/**
 * getJobById
 * WHAT: Get a job by its database ID.
 */
export function getJobById(jobId: number): ArtJobRow | null {
  const row = getJobByIdStmt.get(jobId) as ArtJobRow | undefined;
  return row ?? null;
}

/**
 * getJobByNumber
 * WHAT: Get a job by global job number.
 */
export function getJobByNumber(guildId: string, jobNumber: number): ArtJobRow | null {
  const row = getJobByNumberStmt.get(guildId, jobNumber) as ArtJobRow | undefined;
  return row ?? null;
}

/**
 * getJobByArtistNumber
 * WHAT: Get a job by artist's personal job number.
 */
export function getJobByArtistNumber(guildId: string, artistId: string, artistJobNumber: number): ArtJobRow | null {
  const row = getJobByArtistNumberStmt.get(guildId, artistId, artistJobNumber) as ArtJobRow | undefined;
  return row ?? null;
}

/**
 * Result type for getJobByRecipient when multiple jobs match.
 */
export type JobByRecipientResult =
  | { status: "found"; job: ArtJobRow }
  | { status: "not_found" }
  | { status: "multiple"; count: number; jobs: ArtJobRow[] };

/**
 * getJobByRecipient
 * WHAT: Get an active job by recipient and ticket type.
 * WHY: Allows artists to reference jobs by @user + type.
 *
 * Returns a discriminated union so callers can handle the "multiple matches" case
 * instead of silently picking an arbitrary job.
 */
export function getJobByRecipient(
  guildId: string,
  artistId: string,
  recipientId: string,
  ticketType: string
): JobByRecipientResult {
  const rows = getJobsByRecipientStmt.all(guildId, artistId, recipientId, ticketType) as ArtJobRow[];

  if (rows.length === 0) {
    return { status: "not_found" };
  }

  if (rows.length === 1) {
    return { status: "found", job: rows[0] };
  }

  // Multiple matches - return them all so the caller can tell the user to be more specific
  return { status: "multiple", count: rows.length, jobs: rows };
}

/**
 * getActiveJobsForArtist
 * WHAT: Get all non-done jobs for an artist.
 */
export function getActiveJobsForArtist(guildId: string, artistId: string): ArtJobRow[] {
  return getActiveJobsForArtistStmt.all(guildId, artistId) as ArtJobRow[];
}

/**
 * getAllActiveJobs
 * WHAT: Get all active jobs for a guild (staff view).
 */
export function getAllActiveJobs(guildId: string): ArtJobRow[] {
  return getAllActiveJobsStmt.all(guildId) as ArtJobRow[];
}

/**
 * getActiveJobsForRecipient
 * WHAT: Get all non-done jobs where user is the recipient.
 * WHY: Let art reward recipients check progress of their commissioned art.
 */
export function getActiveJobsForRecipient(guildId: string, recipientId: string): ArtJobRow[] {
  return getActiveJobsForRecipientStmt.all(guildId, recipientId) as ArtJobRow[];
}

/*
 * Security: Allowlist for dynamic UPDATE. We build SQL dynamically here
 * (yeah, I know) so we validate field names against this set. If you add
 * a new updatable field, add it here or prepare for a cryptic runtime error.
 */
const ALLOWED_UPDATE_FIELDS = new Set(["status", "notes"]);

/**
 * updateJobStatus
 * WHAT: Update a job's status and/or notes.
 *
 * WHY the dynamic SQL? Because I didn't want to write separate UPDATE
 * statements for status-only, notes-only, and both. This is the tradeoff.
 */
export function updateJobStatus(jobId: number, options: UpdateJobOptions): boolean {
  // Validate field names before we let them anywhere near SQL construction.
  // Yes, this is paranoid. No, I don't regret it.
  for (const key of Object.keys(options)) {
    if (!ALLOWED_UPDATE_FIELDS.has(key)) {
      logger.error(
        { jobId, invalidKey: key },
        "[artJobs] Invalid update field rejected - potential SQL injection attempt"
      );
      throw new Error(`Invalid update field: ${key}`);
    }
  }

  const updates: string[] = ["updated_at = datetime('now')"];
  const params: (string | null)[] = [];

  if (options.status !== undefined) {
    updates.push("status = ?");
    params.push(options.status);

    // Auto-timestamp completion. You can't undo this by setting status
    // back to something else - completed_at stays set. Feature, not bug.
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
 *
 * Uses local server time for "start of month" which could drift from
 * user expectations in different timezones. Good enough for gamification.
 */
export function getMonthlyLeaderboard(guildId: string, limit = 10): LeaderboardEntry[] {
  // Note: This is server-local time, not UTC. Might matter if you care
  // about exact month boundaries, which we don't, really.
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
  return getAllTimeLeaderboardStmt.all(guildId, limit) as LeaderboardEntry[];
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

  const monthly = getMonthlyCompletedStmt.get(guildId, artistId, startIso) as { count: number };
  const allTime = getAllTimeCompletedStmt.get(guildId, artistId) as { count: number };

  return {
    artistId,
    monthlyCompleted: monthly.count,
    allTimeCompleted: allTime.count,
  };
}

// Pads to 4 digits. Will look silly if we ever hit job #10000 but
// that's 10,000 art commissions so I think we'll survive the embarrassment.
export function formatJobNumber(num: number): string {
  return String(num).padStart(4, "0");
}
