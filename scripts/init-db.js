#!/usr/bin/env node
/**
 * Initialize database with base schema
 * Run this to create a fresh database from scratch
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';

const db = new Database('data/data.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('📦 Initializing database...\n');

// Apply base init migration
console.log('Applying 000_init.sql...');
const initSql = readFileSync('migrations/000_init.sql', 'utf8');
db.exec(initSql);

// Apply action_log migration (needed by TypeScript migrations)
console.log('Applying 007_action_log.sql...');
const actionLogSql = readFileSync('migrations/007_action_log.sql', 'utf8');
db.exec(actionLogSql);

console.log('\n✅ Base schema initialized');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('\n📋 Tables created:');
tables.forEach(t => console.log('   -', t.name));

console.log('\n💡 Next steps:');
console.log('   1. Run: npx tsx scripts/migrate.ts (for TypeScript migrations)');
console.log('   2. Run: node scripts/apply-sql-migrations.js (for SQL migrations)');
console.log('   3. Run: node scripts/fix-review-action.js (to fix review_action schema)');
console.log('   4. Run: npm test (to verify everything works)');

db.close();
