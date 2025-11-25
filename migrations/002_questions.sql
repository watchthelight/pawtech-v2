BEGIN;

-- Per-guild configurable question set
CREATE TABLE IF NOT EXISTS guild_question (
  guild_id TEXT NOT NULL,
  q_index  INTEGER NOT NULL,
  prompt   TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  PRIMARY KEY (guild_id, q_index),
  FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id) ON DELETE CASCADE
);

COMMIT;
