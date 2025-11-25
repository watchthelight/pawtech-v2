BEGIN;

CREATE INDEX IF NOT EXISTS idx_app_guild_status ON application(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_resp_app ON application_response(app_id);
CREATE INDEX IF NOT EXISTS idx_review_app ON review_action(app_id);
CREATE INDEX IF NOT EXISTS idx_modmail_guild_user ON modmail_bridge(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_user ON user_snapshot(guild_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_active_unique
ON application(guild_id, user_id)
WHERE status IN ('draft','submitted');

CREATE UNIQUE INDEX IF NOT EXISTS idx_modmail_open_unique
ON modmail_bridge(guild_id, user_id)
WHERE state = 'open';

COMMIT;
