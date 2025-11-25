#!/usr/bin/env node
/**
 * Pawtropolis Tech — Database Integrity Verification
 * WHAT: Checks database health before sync operations
 * WHY: Prevents overwriting good databases with corrupted ones
 * HOW: Runs SQLite integrity_check and verifies critical table counts
 */

import Database from 'better-sqlite3';
import fs from 'fs';

// Minimum expected counts for a "healthy" production database
const HEALTH_THRESHOLDS = {
  review_action: 1000,  // Should have at least 1000 review actions in prod
  mod_metrics: 5,       // Should have at least 5 moderators
  application: 10       // Should have at least 10 applications
};

function verifyDatabase(dbPath, options = {}) {
  const { strictMode = false, verbose = false } = options;

  const result = {
    path: dbPath,
    exists: false,
    readable: false,
    integrity: 'unknown',
    size: 0,
    tables: {},
    healthy: false,
    warnings: [],
    errors: []
  };

  // Check if file exists
  if (!fs.existsSync(dbPath)) {
    result.errors.push('Database file does not exist');
    return result;
  }
  result.exists = true;
  result.size = fs.statSync(dbPath).size;

  // Check if file is readable and non-zero
  if (result.size === 0) {
    result.errors.push('Database file is empty (0 bytes)');
    return result;
  }
  result.readable = true;

  let db;
  try {
    // Open database in readonly mode
    db = new Database(dbPath, { readonly: true, fileMustExist: true });

    // Run integrity check
    try {
      const integrityResult = db.prepare('PRAGMA integrity_check').all();
      if (integrityResult.length === 1 && integrityResult[0].integrity_check === 'ok') {
        result.integrity = 'ok';
      } else {
        result.integrity = 'corrupt';
        result.errors.push(`Integrity check failed: ${integrityResult.map(r => r.integrity_check).join('; ')}`);
      }
    } catch (err) {
      result.integrity = 'error';
      result.errors.push(`Integrity check error: ${err.message}`);
    }

    // Check critical tables exist and have data
    const criticalTables = ['review_action', 'mod_metrics', 'application', 'guild_config'];

    for (const table of criticalTables) {
      try {
        const count = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get();
        result.tables[table] = count.c;

        // Check against thresholds (only in strict mode)
        if (strictMode && HEALTH_THRESHOLDS[table]) {
          if (count.c < HEALTH_THRESHOLDS[table]) {
            result.warnings.push(
              `Table ${table} has only ${count.c} rows (expected at least ${HEALTH_THRESHOLDS[table]})`
            );
          }
        }
      } catch (err) {
        result.tables[table] = 'error';
        result.errors.push(`Cannot read table ${table}: ${err.message}`);
      }
    }

    db.close();
  } catch (err) {
    result.errors.push(`Cannot open database: ${err.message}`);
    return result;
  }

  // Determine overall health
  result.healthy =
    result.integrity === 'ok' &&
    result.errors.length === 0 &&
    (!strictMode || result.warnings.length === 0);

  return result;
}

// CLI usage
const args = process.argv.slice(2);
if (args.length > 0 || import.meta.url === `file://${process.argv[1]}`) {

  if (args.length === 0) {
    console.error('Usage: node verify-db-integrity.js <database-path> [--strict] [--verbose]');
    console.error('');
    console.error('Options:');
    console.error('  --strict   Enforce minimum row count thresholds');
    console.error('  --verbose  Show detailed output');
    console.error('');
    console.error('Exit codes:');
    console.error('  0 = Healthy database');
    console.error('  1 = Unhealthy database (corruption or missing data)');
    console.error('  2 = Invalid arguments');
    process.exit(2);
  }

  const dbPath = args[0];
  const strictMode = args.includes('--strict');
  const verbose = args.includes('--verbose');

  const result = verifyDatabase(dbPath, { strictMode, verbose });

  if (verbose) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Compact output for scripting
    if (result.healthy) {
      console.log(`✓ ${dbPath}: HEALTHY`);
      console.log(`  Integrity: ${result.integrity}`);
      console.log(`  Size: ${(result.size / 1024 / 1024).toFixed(2)} MB`);
      Object.entries(result.tables).forEach(([table, count]) => {
        console.log(`  ${table}: ${count} rows`);
      });
    } else {
      console.log(`✗ ${dbPath}: UNHEALTHY`);
      if (result.errors.length > 0) {
        console.log(`  Errors: ${result.errors.length}`);
        result.errors.forEach(err => console.log(`    - ${err}`));
      }
      if (result.warnings.length > 0) {
        console.log(`  Warnings: ${result.warnings.length}`);
        result.warnings.forEach(warn => console.log(`    - ${warn}`));
      }
    }
  }

  process.exit(result.healthy ? 0 : 1);
}

export { verifyDatabase, HEALTH_THRESHOLDS };
