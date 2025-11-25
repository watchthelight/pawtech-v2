BEGIN;

-- Add index on guild_question for efficient lookups
CREATE INDEX IF NOT EXISTS idx_guild_question_gid_qidx ON guild_question(guild_id, q_index);

COMMIT;
