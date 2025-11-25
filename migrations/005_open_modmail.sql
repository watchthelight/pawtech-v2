-- Migration: Add open_modmail tracking table
-- Date: 2025-10-20
-- Description: Race-safe guard to prevent duplicate modmail threads per (guild, user)

-- Create table to track currently open modmail threads
-- Primary key on (guildId, applicantId) enforces one thread per user per guild
CREATE TABLE IF NOT EXISTS open_modmail (
  guild_id     TEXT NOT NULL,
  applicant_id TEXT NOT NULL,
  thread_id    TEXT NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (guild_id, applicant_id)
);

-- Index for fast lookups by thread_id (used during thread deletion cleanup)
CREATE INDEX IF NOT EXISTS idx_open_modmail_thread
  ON open_modmail(thread_id);
