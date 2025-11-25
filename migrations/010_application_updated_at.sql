-- Migration: Add updated_at column to application table
-- Date: 2025-10-28
-- Description: Add updated_at tracking column to application table for audit trail

BEGIN TRANSACTION;

-- Add updated_at column with default value
ALTER TABLE application ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'));

-- Backfill updated_at from submitted_at where available, otherwise from created_at
UPDATE application
SET updated_at = COALESCE(
  CASE
    WHEN submitted_at IS NOT NULL AND submitted_at != ''
    THEN strftime('%s', submitted_at)
    ELSE NULL
  END,
  CASE
    WHEN created_at IS NOT NULL AND created_at != ''
    THEN strftime('%s', created_at)
    ELSE NULL
  END,
  strftime('%s', 'now')
);

COMMIT;
