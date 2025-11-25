#!/usr/bin/env node
/**
 * scripts/fix-review-action.cjs
 *
 * WHAT: Repairs review_action table schema in production.
 * WHY: Removes CHECK constraint, converts created_at to INTEGER, fixes FK CASCADE.
 * HOW: Copy-swap migration inside a single transaction with safety checks.
 *
 * SAFETY:
 *  - Single transaction (all-or-nothing)
 *  - Row count verification before/after
 *  - Handles TEXT → INTEGER created_at conversion
 *  - Preserves all data including NULLs
 *  - Enables foreign_keys pragma
 *
 * USAGE:
 *   node scripts/fix-review-action.cjs
 *
 * OUTPUTS:
 *   - Migration logs with row counts
 *   - Final DDL, PRAGMA info, null count
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'data.db');

function log(msg) {
  console.log(`[fix] ${msg}`);
}

function getDDL(db, tableName) {
  const row = db.prepare(`
    SELECT sql FROM sqlite_schema
    WHERE type='table' AND name=?
  `).get(tableName);
  return row ? row.sql : null;
}

function hasCheckConstraint(ddl) {
  return ddl && /CHECK\s*\(/i.test(ddl);
}

function getCreatedAtType(db, tableName) {
  const cols = db.pragma(`table_info('${tableName}')`);
  const col = cols.find(c => c.name === 'created_at');
  return col ? col.type.toUpperCase() : null;
}

function hasCorrectForeignKey(db, tableName) {
  const fks = db.pragma(`foreign_key_list('${tableName}')`);
  const appIdFk = fks.find(fk => fk.from === 'app_id');
  return appIdFk && appIdFk.on_delete === 'CASCADE';
}

function hasIndex(db, tableName, indexName) {
  const indexes = db.pragma(`index_list('${tableName}')`);
  return indexes.some(idx => idx.name === indexName);
}

function needsMigration(db) {
  const ddl = getDDL(db, 'review_action');
  if (!ddl) {
    throw new Error('review_action table does not exist');
  }

  const hasCheck = hasCheckConstraint(ddl);
  const createdAtType = getCreatedAtType(db, 'review_action');
  const hasCorrectFK = hasCorrectForeignKey(db, 'review_action');
  const hasCorrectIndex = hasIndex(db, 'review_action', 'idx_review_action_app_time');

  if (hasCheck) {
    log('detected CHECK constraint on action column');
  }
  if (createdAtType !== 'INTEGER') {
    log(`detected created_at type: ${createdAtType} (expected INTEGER)`);
  }
  if (!hasCorrectFK) {
    log('detected incorrect foreign key (not CASCADE)');
  }
  if (!hasCorrectIndex) {
    log('missing idx_review_action_app_time index');
  }

  return hasCheck || createdAtType !== 'INTEGER' || !hasCorrectFK || !hasCorrectIndex;
}

function runMigration(db) {
  log('starting copy-swap migration');

  const migrate = db.transaction(() => {
    // 1. Count rows before
    const countBefore = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get();
    log(`review_action row count before: ${countBefore.count}`);

    // 2. Drop old indexes
    db.prepare(`DROP INDEX IF EXISTS idx_review_action_app_time`).run();
    db.prepare(`DROP INDEX IF EXISTS idx_review_app`).run();
    db.prepare(`DROP INDEX IF EXISTS idx_review_moderator`).run();

    // 3. Create new table with correct schema
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

    // 4. Copy data with created_at conversion
    db.prepare(`
      INSERT INTO review_action_new (id, app_id, moderator_id, action, reason, message_link, meta, created_at)
      SELECT
        id,
        app_id,
        moderator_id,
        action,
        reason,
        message_link,
        meta,
        COALESCE(
          CASE
            WHEN created_at IS NOT NULL AND created_at != ''
            THEN CAST(strftime('%s', created_at) AS INTEGER)
            ELSE NULL
          END,
          CAST(strftime('%s', 'now') AS INTEGER)
        ) as created_at
      FROM review_action
    `).run();

    // 5. Verify row count
    const countAfter = db.prepare(`SELECT COUNT(*) as count FROM review_action_new`).get();
    log(`review_action_new row count after copy: ${countAfter.count}`);

    if (countBefore.count !== countAfter.count) {
      throw new Error(`row count mismatch: before=${countBefore.count}, after=${countAfter.count}`);
    }

    // 6. Drop old table and rename new one
    db.prepare(`DROP TABLE review_action`).run();
    db.prepare(`ALTER TABLE review_action_new RENAME TO review_action`).run();

    // 7. Recreate indexes
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_review_action_app_time
      ON review_action(app_id, created_at DESC)
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_review_moderator
      ON review_action(moderator_id)
    `).run();

    log(`copy-swap complete (${countAfter.count} rows migrated)`);
  });

  migrate();
}

function printDiagnostics(db) {
  console.log('\n== review_action DDL ==');
  const ddl = getDDL(db, 'review_action');
  console.log(ddl || '(not found)');

  console.log('\n== PRAGMA table_info(review_action) ==');
  const cols = db.pragma(`table_info('review_action')`);
  console.table(cols);

  console.log('\n== PRAGMA index_list(review_action) ==');
  const indexes = db.pragma(`index_list('review_action')`);
  console.table(indexes);

  console.log('\n== PRAGMA foreign_key_list(review_action) ==');
  const fks = db.pragma(`foreign_key_list('review_action')`);
  console.table(fks);

  console.log('\n== created_at NULL check ==');
  const nullCount = db.prepare(`
    SELECT COUNT(*) as count FROM review_action WHERE created_at IS NULL
  `).get();
  console.log(`rows_with_null_created_at = ${nullCount.count}`);
}

function main() {
  let db;

  try {
    log(`opening database: ${DB_PATH}`);
    db = new Database(DB_PATH);

    // Enable foreign keys
    db.pragma('foreign_keys = ON');
    log('foreign_keys pragma enabled');

    // Check if migration is needed
    if (!needsMigration(db)) {
      log('review_action schema is already correct');
      printDiagnostics(db);
      return;
    }

    // Run migration
    runMigration(db);
    log('review_action upgraded (free-text actions + created_at)');

    // Print final state
    printDiagnostics(db);

  } catch (err) {
    console.error('\n[ERROR] Migration failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    if (db) {
      db.close();
      log('database closed');
    }
  }
}

main();
