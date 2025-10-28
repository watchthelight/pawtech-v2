#!/usr/bin/env node
/**
 * Apply all SQL migrations to the database
 */
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const db = new Database('data/data.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('Applying SQL migrations...\n');

// Get all SQL migration files
const migrationsDir = 'migrations';
const sqlFiles = readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

let applied = 0;
let skipped = 0;

for (const file of sqlFiles) {
  const filePath = join(migrationsDir, file);

  try {
    // Check if already applied by checking if the migration created its tables
    // For example, 002_questions.sql creates guild_question table
    const shouldApply = (() => {
      if (file === '000_init.sql') return false; // Already applied
      if (file === '007_action_log.sql') return false; // Already applied
      if (file === '010_application_updated_at.sql') return false; // Already applied

      // Check specific table existence for known migrations
      if (file === '001_indices.sql') {
        const indices = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_app_status'").get();
        return !indices;
      }
      if (file === '002_questions.sql') {
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='guild_question'").get();
        return !table;
      }
      if (file === '002_review_cards.sql') {
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='review_card'").get();
        return !table;
      }
      if (file === '003_avatar_scan.sql') {
        // This is handled by ensure logic
        return false;
      }
      if (file === '004_permanent_reject.sql') {
        // This is handled by ensure logic
        return false;
      }
      if (file === '005_open_modmail.sql') {
        // This is handled by ensure logic
        return false;
      }
      if (file === '006_review_action_expand.sql') {
        // Already fixed by our review_action migration
        return false;
      }
      if (file === '008_gate_questions_index.sql') {
        const index = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_guild_question_guild'").get();
        return !index;
      }
      if (file === '009_bot_status.sql') {
        // Already has bot_status table
        return false;
      }

      return true;
    })();

    if (!shouldApply) {
      console.log(`⏭️  Skipping ${file} (already applied or handled by ensure)`);
      skipped++;
      continue;
    }

    console.log(`📦 Applying ${file}...`);
    const sql = readFileSync(filePath, 'utf8');
    db.exec(sql);
    console.log(`✅ Applied ${file}`);
    applied++;
  } catch (err) {
    console.error(`❌ Failed to apply ${file}:`, err.message);
    throw err;
  }
}

db.close();

console.log(`\n✅ SQL migrations complete: ${applied} applied, ${skipped} skipped`);
