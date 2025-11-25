#!/usr/bin/env node
/**
 * scripts/verify-review-action.cjs
 *
 * WHAT: Verifies review_action table schema and data after migration.
 * WHY: Confirms timestamps are epoch integers, indexes are used, no FK errors.
 *
 * USAGE:
 *   node scripts/verify-review-action.cjs
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'data.db');

function log(msg) {
  console.log(`[verify] ${msg}`);
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  try {
    // 1. Check recent audit rows
    log('checking recent audit rows...');
    const recentRows = db.prepare(`
      SELECT action, reason, created_at FROM review_action
      ORDER BY created_at DESC
      LIMIT 5
    `).all();

    if (recentRows.length === 0) {
      log('no audit rows found (table is empty)');
    } else {
      console.table(recentRows);

      // Verify timestamps are epoch integers (not ISO strings)
      const allEpoch = recentRows.every(row => {
        const ts = row.created_at;
        return typeof ts === 'number' && ts > 1000000000 && ts < 2000000000;
      });

      if (allEpoch) {
        log('✓ all created_at values are valid epoch integers');
      } else {
        log('✗ ERROR: some created_at values are not epoch integers');
      }
    }

    // 2. Check query plan for index usage
    log('\nchecking query plan for index usage...');
    const plan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT * FROM review_action
      WHERE app_id = ?
      ORDER BY created_at DESC
      LIMIT 3
    `).all('ANY_APP_ID');

    const planText = plan.map(p => p.detail).join(' ');
    console.log('Query plan:', planText);

    if (planText.includes('idx_review_action_app_time')) {
      log('✓ query plan uses idx_review_action_app_time');
    } else {
      log('⚠ WARNING: index may not be in use');
    }

    // 3. Verify schema details
    log('\nverifying schema details...');

    // Check created_at column type
    const cols = db.pragma(`table_info('review_action')`);
    const createdAtCol = cols.find(c => c.name === 'created_at');

    if (createdAtCol?.type.toUpperCase() === 'INTEGER') {
      log('✓ created_at is INTEGER type');
    } else {
      log(`✗ ERROR: created_at is ${createdAtCol?.type || 'MISSING'}`);
    }

    // Check foreign key CASCADE
    const fks = db.pragma(`foreign_key_list('review_action')`);
    const appIdFk = fks.find(fk => fk.from === 'app_id');

    if (appIdFk?.on_delete === 'CASCADE') {
      log('✓ foreign key ON DELETE CASCADE is set');
    } else {
      log(`✗ ERROR: foreign key is ${appIdFk?.on_delete || 'MISSING'}`);
    }

    // Check for CHECK constraint
    const ddl = db.prepare(`
      SELECT sql FROM sqlite_schema
      WHERE type='table' AND name='review_action'
    `).get();

    const hasCheck = /CHECK\s*\(/i.test(ddl?.sql || '');
    if (!hasCheck) {
      log('✓ no CHECK constraint on action column');
    } else {
      log('✗ ERROR: CHECK constraint still present');
    }

    // Check for NULL timestamps
    const nullCount = db.prepare(`
      SELECT COUNT(*) as count FROM review_action
      WHERE created_at IS NULL
    `).get();

    log(`\nrows_with_null_created_at = ${nullCount.count}`);

    if (nullCount.count === 0) {
      log('✓ no NULL timestamps');
    } else {
      log(`✗ WARNING: ${nullCount.count} rows have NULL created_at`);
    }

    log('\n✅ Verification complete');

  } catch (err) {
    console.error('\n[ERROR]', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
