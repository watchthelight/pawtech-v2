-- Migration: Add action_log table for analytics and logging
-- Date: 2025-10-20
-- Description: Comprehensive action log for moderator analytics, leaderboards, and audit trail

BEGIN TRANSACTION;

-- Create action_log table (append-only)
CREATE TABLE IF NOT EXISTS action_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  app_id        TEXT,
  app_code      TEXT,
  actor_id      TEXT NOT NULL,
  subject_id    TEXT,
  action        TEXT NOT NULL CHECK (
                  action IN (
                    'app_submitted',
                    'claim',
                    'approve',
                    'reject',
                    'need_info',
                    'perm_reject',
                    'kick',
                    'modmail_open',
                    'modmail_close'
                  )
                ),
  reason        TEXT,
  meta_json     TEXT,
  created_at_s  INTEGER NOT NULL
);

-- Index for guild-wide queries and time-based filtering
CREATE INDEX IF NOT EXISTS idx_action_log_guild_time
  ON action_log(guild_id, created_at_s DESC);

-- Index for moderator-specific queries (leaderboards, user stats)
CREATE INDEX IF NOT EXISTS idx_action_log_actor_time
  ON action_log(actor_id, created_at_s DESC);

-- Index for app-based queries (timeline reconstruction)
CREATE INDEX IF NOT EXISTS idx_action_log_app
  ON action_log(app_id);

-- Create guild_config table for per-guild logging channel overrides
CREATE TABLE IF NOT EXISTS guild_config (
  guild_id          TEXT PRIMARY KEY,
  logging_channel_id TEXT,
  updated_at_s      INTEGER NOT NULL
);

COMMIT;
