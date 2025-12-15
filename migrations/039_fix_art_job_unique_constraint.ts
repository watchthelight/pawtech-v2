/**
 * Migration 039: Fix art_job unique constraint
 *
 * WHAT: Add UNIQUE constraint on (guild_id, artist_id, artist_job_number)
 * WHY: Prevents race condition where two simultaneous job creations could
 *      get the same artist_job_number, making it impossible to select the
 *      correct job when using /art finish id:N
 *
 * Also fixes any existing duplicates by renumbering them.
 */

import { db } from "../src/db/db.js";

export function migrate(): void {
  // Step 1: Find and fix any existing duplicates before adding constraint
  const duplicates = db.prepare(`
    SELECT guild_id, artist_id, artist_job_number, COUNT(*) as cnt
    FROM art_job
    GROUP BY guild_id, artist_id, artist_job_number
    HAVING cnt > 1
  `).all() as { guild_id: string; artist_id: string; artist_job_number: number; cnt: number }[];

  if (duplicates.length > 0) {
    console.log(`[migrate:039] Found ${duplicates.length} duplicate artist_job_number cases, fixing...`);

    for (const dup of duplicates) {
      // Get all jobs with this duplicate number, ordered by creation
      const jobs = db.prepare(`
        SELECT id FROM art_job
        WHERE guild_id = ? AND artist_id = ? AND artist_job_number = ?
        ORDER BY assigned_at ASC
      `).all(dup.guild_id, dup.artist_id, dup.artist_job_number) as { id: number }[];

      // Keep the first one, renumber the rest
      // Get the current max for this artist
      const maxRow = db.prepare(`
        SELECT MAX(artist_job_number) as max_num FROM art_job
        WHERE guild_id = ? AND artist_id = ?
      `).get(dup.guild_id, dup.artist_id) as { max_num: number };

      let nextNum = maxRow.max_num + 1;

      // Skip the first job (it keeps its number), renumber the rest
      for (let i = 1; i < jobs.length; i++) {
        db.prepare(`UPDATE art_job SET artist_job_number = ? WHERE id = ?`).run(nextNum, jobs[i].id);
        console.log(`[migrate:039] Renumbered job ${jobs[i].id} to artist_job_number ${nextNum}`);
        nextNum++;
      }
    }
  }

  // Step 2: Drop the old non-unique index if it exists
  db.exec(`DROP INDEX IF EXISTS idx_art_job_artist_number`);

  // Step 3: Create the new UNIQUE index
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_art_job_artist_number_unique
    ON art_job(guild_id, artist_id, artist_job_number)
  `);

  console.log("[migrate:039] Added UNIQUE constraint on (guild_id, artist_id, artist_job_number)");
}
