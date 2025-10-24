-- Migration: Expand review_action CHECK constraint to allow perm_reject and copy_uid
-- Date: 2025-10-20
-- Description: SQLite can't ALTER CHECK inline, so we recreate the table with expanded constraint

-- Begin atomic migration
BEGIN TRANSACTION;

-- 1) Rename existing table
ALTER TABLE review_action RENAME TO review_action_old;

-- 2) Recreate with new CHECK that includes perm_reject and copy_uid
CREATE TABLE review_action (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id        TEXT,
  moderator_id  TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (
                   action IN ('approve','reject','need_info','kick','avatar_viewsrc','perm_reject','copy_uid')
                 ),
  reason        TEXT,
  message_link  TEXT,
  meta          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE SET NULL
);

-- 3) Copy data over (existing rows all satisfy the old CHECK)
INSERT INTO review_action (id, app_id, moderator_id, action, reason, message_link, meta, created_at)
SELECT id, app_id, moderator_id, action, reason, message_link, meta, created_at
FROM review_action_old;

-- 4) Recreate index
CREATE INDEX IF NOT EXISTS idx_review_app ON review_action(app_id);

-- 5) Drop old table
DROP TABLE review_action_old;

COMMIT;
