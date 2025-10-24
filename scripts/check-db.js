#!/usr/bin/env node
/**
 * Pawtropolis Tech — scripts/check-db.js
 * WHAT: Database integrity checker using better-sqlite3
 * WHY: Validates DB files during recovery, checks table counts
 * USAGE: node scripts/check-db.js <path-to-db>
 * OUTPUT: JSON with integrity status and table counts
 */

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dbPath = process.argv[2];

if (!dbPath) {
  console.error('Usage: node check-db.js <path-to-db>');
  process.exit(1);
}

const absolutePath = resolve(dbPath);

const result = {
  file: absolutePath,
  integrity: 'ok',
  counts: {
    review_action: 'missing',
    application: 'missing',
    avatar_scan: 'missing',
    bot_status: 'missing',
  },
};

// Check if file exists
if (!existsSync(absolutePath)) {
  result.integrity = 'file not found';
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

let db;
try {
  // Open database in readonly mode
  db = new Database(absolutePath, { readonly: true, fileMustExist: true });

  // Run integrity check
  try {
    const integrityResult = db.pragma('integrity_check');
    if (Array.isArray(integrityResult) && integrityResult.length > 0) {
      const firstResult = integrityResult[0];
      if (typeof firstResult === 'object' && 'integrity_check' in firstResult) {
        result.integrity = firstResult.integrity_check === 'ok' ? 'ok' : firstResult.integrity_check;
      } else if (firstResult === 'ok') {
        result.integrity = 'ok';
      } else {
        result.integrity = String(firstResult);
      }
    }
  } catch (err) {
    result.integrity = `integrity_check failed: ${err.message}`;
  }

  // Get table counts
  const tables = ['review_action', 'application', 'avatar_scan', 'bot_status'];

  for (const table of tables) {
    try {
      // Check if table exists
      const tableExists = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        )
        .get(table);

      if (tableExists) {
        const countResult = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
        result.counts[table] = countResult.count;
      } else {
        result.counts[table] = 'missing';
      }
    } catch (err) {
      result.counts[table] = `error: ${err.message}`;
    }
  }

  db.close();
} catch (err) {
  result.integrity = `open failed: ${err.message}`;
} finally {
  if (db) {
    try {
      db.close();
    } catch {
      // Ignore close errors
    }
  }
}

// Output JSON
console.log(JSON.stringify(result, null, 2));
process.exit(0);
