#!/usr/bin/env node
/**
 * Fix review_action table: remove CHECK constraint, add meta column, convert created_at to INTEGER
 */
import Database from 'better-sqlite3';

const db = new Database('data/data.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('Fixing review_action table...');

const fix = db.transaction(() => {
  // Count rows before
  const countBefore = db.prepare('SELECT COUNT(*) as count FROM review_action').get();
  console.log(`Rows before: ${countBefore.count}`);

  // Drop existing indexes
  db.prepare('DROP INDEX IF EXISTS idx_review_action_app_time').run();
  db.prepare('DROP INDEX IF EXISTS idx_review_app').run();
  db.prepare('DROP INDEX IF EXISTS idx_review_moderator').run();

  // Create new table with no CHECK constraint, INTEGER created_at, and meta column
  db.prepare(`
    CREATE TABLE review_action_new (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id        TEXT NOT NULL,
      moderator_id  TEXT NOT NULL,
      action        TEXT NOT NULL,
      reason        TEXT,
      message_link  TEXT,
      meta          TEXT,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
    )
  `).run();

  // Copy rows with created_at conversion
  db.prepare(`
    INSERT INTO review_action_new (id, app_id, moderator_id, action, reason, message_link, meta, created_at)
    SELECT
      id,
      app_id,
      moderator_id,
      action,
      reason,
      message_link,
      NULL as meta,
      COALESCE(
        CASE
          WHEN created_at IS NOT NULL AND created_at != ''
          THEN strftime('%s', created_at)
          ELSE NULL
        END,
        strftime('%s', 'now')
      ) as created_at
    FROM review_action
  `).run();

  // Verify row count
  const countAfter = db.prepare('SELECT COUNT(*) as count FROM review_action_new').get();
  console.log(`Rows after: ${countAfter.count}`);

  if (countBefore.count !== countAfter.count) {
    throw new Error(`Row count mismatch: before=${countBefore.count}, after=${countAfter.count}`);
  }

  // Drop old table and rename
  db.prepare('DROP TABLE review_action').run();
  db.prepare('ALTER TABLE review_action_new RENAME TO review_action').run();

  // Recreate indexes
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_review_action_app_time
    ON review_action(app_id, created_at DESC)
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_review_moderator
    ON review_action(moderator_id)
  `).run();

  console.log(`✅ review_action table fixed (${countAfter.count} rows)`);
});

fix();
db.close();
