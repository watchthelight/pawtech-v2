BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  review_channel_id     TEXT,
  gate_channel_id       TEXT,
  unverified_channel_id TEXT,
  general_channel_id    TEXT,
  accepted_role_id      TEXT,
  reviewer_role_id      TEXT,
  image_search_url_template TEXT NOT NULL DEFAULT 'https://lens.google.com/uploadbyurl?url={avatarUrl}',
  reapply_cooldown_hours   INTEGER NOT NULL DEFAULT 24 CHECK (reapply_cooldown_hours >= 0),
  min_account_age_hours    INTEGER NOT NULL DEFAULT 0 CHECK (min_account_age_hours >= 0),
  min_join_age_hours       INTEGER NOT NULL DEFAULT 0 CHECK (min_join_age_hours >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS application (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  status   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','accepted','rejected')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  resolved_at  TEXT,
  resolver_id  TEXT,
  resolution_reason TEXT,
  FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS application_response (
  app_id   TEXT NOT NULL,
  q_index  INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (app_id, q_index),
  FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_action (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT,
  moderator_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('accept','reject','kick','ping','modmail')),
  reason TEXT,
  message_link TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS modmail_bridge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at  TEXT
);

CREATE TABLE IF NOT EXISTS user_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  username TEXT,
  discriminator TEXT,
  global_name TEXT,
  avatar_url TEXT,
  joined_at TEXT,
  account_created_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

COMMIT;
