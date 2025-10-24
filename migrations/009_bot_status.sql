BEGIN;

-- Bot status persistence table
-- WHAT: Stores the last bot presence/status to restore on restart
-- WHY: Allows status updates to persist across bot restarts
-- SCOPE: Global (scope_key = 'global') or per-guild if needed in future

CREATE TABLE IF NOT EXISTS bot_status (
  scope_key TEXT NOT NULL PRIMARY KEY,  -- 'global' or guild_id for per-guild status
  activity_type INTEGER NOT NULL,       -- Discord ActivityType enum value
  activity_text TEXT NOT NULL,          -- Status text displayed
  status TEXT NOT NULL,                 -- 'online' | 'idle' | 'dnd' | 'invisible'
  updated_at INTEGER NOT NULL          -- unix timestamp in milliseconds
);

COMMIT;
