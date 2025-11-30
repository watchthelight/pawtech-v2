BEGIN;

-- Add composite index for guild_id + status queries
-- Covers queries in opsHealth.ts and tickets.ts that filter by both columns
CREATE INDEX IF NOT EXISTS idx_modmail_ticket_guild_status
ON modmail_ticket(guild_id, status);

COMMIT;
