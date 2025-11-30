BEGIN;

-- Drop the old index (it's redundant once we have the new one)
DROP INDEX IF EXISTS idx_app_guild_status;

-- Create composite index optimized for guild_id + status + created_at queries
CREATE INDEX IF NOT EXISTS idx_application_guild_status
ON application(guild_id, status, created_at);

COMMIT;
