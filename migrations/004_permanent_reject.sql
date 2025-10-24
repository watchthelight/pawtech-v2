-- Migration: Add permanent rejection support
-- Date: 2025-10-20
-- Description: Adds columns to track permanent rejections at guild level

-- Add permanent rejection tracking columns to application table
ALTER TABLE application
  ADD COLUMN permanently_rejected INTEGER NOT NULL DEFAULT 0;

ALTER TABLE application
  ADD COLUMN permanent_reject_at TEXT;

-- Add index for efficient permanent rejection lookups
CREATE INDEX IF NOT EXISTS idx_applicants_guild_user_permrej
  ON application(guild_id, user_id, permanently_rejected);

-- Update the review_action CHECK constraint to include new action types
-- Note: SQLite doesn't support ALTER COLUMN for CHECK constraints
-- We'll handle the new action types 'perm_reject' and 'copy_uid' in application logic
-- and document them here for reference:
--   - 'perm_reject': Permanent rejection action (same as reject but sets flags)
--   - 'copy_uid': Moderator copied user ID for reference
