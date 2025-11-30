/**
 * Pawtropolis Tech — scripts/cleanup-test-data.ts
 * WHAT: Cleanup script to remove test guild configurations from production database.
 * WHY: Test data with fake IDs like 'test-guild-*' causes stale alert errors.
 * USAGE:
 *   npx dotenvx run -- tsx scripts/cleanup-test-data.ts           # Run cleanup
 *   npx dotenvx run -- tsx scripts/cleanup-test-data.ts --dry-run # Preview without changes
 *
 * DOCS:
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - Issue #67: docs/roadmap/067-cleanup-test-data-in-database.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Database from "better-sqlite3";
import { existsSync, copyFileSync } from "node:fs";
import dotenv from "dotenv";

// Load .env for DB_PATH
dotenv.config();

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// Database path
const dbPath = process.env.DB_PATH || "./data/data.db";

console.log("\n=== Pawtropolis Test Data Cleanup ===\n");
console.log(`Database: ${dbPath}`);
console.log(`Mode: ${dryRun ? "DRY RUN (no changes)" : "CLEANUP"}\n`);

if (!existsSync(dbPath)) {
  console.log("Database file not found. Nothing to clean up.");
  process.exit(0);
}

// Open database
const db = new Database(dbPath, { fileMustExist: true });
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/**
 * Create database backup before cleanup
 */
function createBackup(): void {
  if (dryRun) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${dbPath}.backup-cleanup-${timestamp}`;

  console.log(`Creating backup: ${backupPath}`);
  copyFileSync(dbPath, backupPath);
  console.log("Backup created successfully\n");
}

/**
 * Find test guilds matching cleanup criteria
 */
function findTestGuilds(): Array<{ guild_id: string; review_channel_id: string | null }> {
  try {
    // Check if guild_config table exists
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'`)
      .get();

    if (!tableExists) {
      console.log("guild_config table does not exist. Nothing to clean up.");
      return [];
    }

    // Find test guilds matching the criteria from issue #67:
    // - guild_id starts with 'test-'
    // - guild_id starts with 'mock-'
    // - review_channel_id equals 'channel-123'
    const testGuilds = db
      .prepare(
        `
      SELECT guild_id, review_channel_id FROM guild_config
      WHERE guild_id LIKE 'test-%'
         OR guild_id LIKE 'mock-%'
         OR review_channel_id = 'channel-123'
    `
      )
      .all() as Array<{ guild_id: string; review_channel_id: string | null }>;

    return testGuilds;
  } catch (err) {
    console.error("Error finding test guilds:", err);
    return [];
  }
}

/**
 * Check if related tables exist
 */
function tableExists(tableName: string): boolean {
  const result = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName);
  return !!result;
}

/**
 * Remove test data from all related tables
 */
function cleanupTestGuilds(
  testGuilds: Array<{ guild_id: string; review_channel_id: string | null }>
): void {
  if (testGuilds.length === 0) {
    console.log("No test guild configs found to remove.\n");
    return;
  }

  console.log(`Found ${testGuilds.length} test guild config(s) to remove:\n`);
  testGuilds.forEach((guild) => {
    console.log(`  - ${guild.guild_id} (review_channel: ${guild.review_channel_id || "null"})`);
  });
  console.log("");

  if (dryRun) {
    console.log("DRY RUN - no changes made\n");
    return;
  }

  // Create backup before making changes
  createBackup();

  // Prepare delete statements for tables that may reference guild_id
  const deleteConfig = db.prepare("DELETE FROM guild_config WHERE guild_id = ?");

  // Check which related tables exist and prepare delete statements
  const hasApplication = tableExists("application");
  const hasReviewAction = tableExists("review_action");

  const deleteApps = hasApplication
    ? db.prepare("DELETE FROM application WHERE guild_id = ?")
    : null;
  const deleteActions = hasReviewAction
    ? db.prepare("DELETE FROM review_action WHERE guild_id = ?")
    : null;

  // Run cleanup in a transaction for atomicity
  const cleanup = db.transaction(() => {
    for (const { guild_id } of testGuilds) {
      console.log(`Removing test guild: ${guild_id}`);

      // Delete from related tables first (foreign key order)
      if (deleteActions) {
        const actionResult = deleteActions.run(guild_id);
        if (actionResult.changes > 0) {
          console.log(`  - Deleted ${actionResult.changes} review_action row(s)`);
        }
      }

      if (deleteApps) {
        const appResult = deleteApps.run(guild_id);
        if (appResult.changes > 0) {
          console.log(`  - Deleted ${appResult.changes} application row(s)`);
        }
      }

      // Delete guild config last
      const configResult = deleteConfig.run(guild_id);
      if (configResult.changes > 0) {
        console.log(`  - Deleted guild_config row`);
      }
    }
  });

  cleanup();

  console.log("\nCleanup complete.\n");
}

/**
 * Main cleanup function
 */
function runCleanup(): void {
  try {
    const testGuilds = findTestGuilds();
    cleanupTestGuilds(testGuilds);
  } catch (err) {
    console.error("\nCleanup failed:");
    console.error(err);
    process.exit(1);
  } finally {
    db.close();
    console.log("Database closed.");
  }
}

// Run cleanup
runCleanup();
