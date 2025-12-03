/**
 * Pawtropolis Tech — scripts/migrate-logging-channel.ts
 * WHAT: Manual migration script to add logging_channel_id to guild_config
 * WHY: Allows fixing existing databases without restarting the bot
 * HOW: Run with: tsx scripts/migrate-logging-channel.ts
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

// The ESM tax: two lines of boilerplate just to know where we are.
// Thanks, Node.js, for making us all miss __dirname.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
import dotenv from "dotenv";
dotenv.config();

/*
 * GOTCHA: This opens a SEPARATE database connection from the bot.
 * Run this while the bot is stopped, or risk your WAL journal
 * having a very bad day. SQLite is good, but not telepathic.
 */
const dbPath = process.env.DB_PATH || "./data/data.db";
const db = new Database(dbPath);

console.log(`Opening database: ${dbPath}`);

/**
 * Check if a table has a specific column
 */
function hasColumn(table: string, column: string): boolean {
  // Yes, this is string interpolation in a PRAGMA statement.
  // No, you can't parameterize table names in SQLite. Yes, I've tried.
  // If someone names their table "; DROP TABLE --", we have bigger problems.
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

/**
 * Check if table exists
 */
function tableExists(table: string): boolean {
  // At least HERE we can use a proper parameter.
  // sqlite_master: the one table that's always there, watching.
  const result = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table);
  return !!result;
}

console.log("\n=== Guild Config Migration ===\n");

// Check if guild_config table exists
if (!tableExists("guild_config")) {
  console.log("❌ guild_config table does not exist");
  console.log("   Creating table with logging_channel_id column...");

  /*
   * WHY updated_at_s and not updated_at? The '_s' suffix means epoch seconds.
   * We're storing seconds, not milliseconds, because that's what Discord uses
   * and because Date.now() / 1000 is a thing. Consistency is a lie anyway.
   */
  db.exec(`
    CREATE TABLE guild_config (
      guild_id          TEXT PRIMARY KEY,
      logging_channel_id TEXT,
      updated_at_s      INTEGER NOT NULL
    );
  `);

  console.log("✅ guild_config table created");
} else {
  console.log("✓ guild_config table exists");

  // Check if logging_channel_id column exists
  if (hasColumn("guild_config", "logging_channel_id")) {
    console.log("✓ logging_channel_id column already exists");
    console.log("\n✅ Database is up to date - no migration needed\n");
  } else {
    console.log("❌ logging_channel_id column is missing");
    console.log("   Adding column...");

    // ALTER TABLE ADD COLUMN is one of SQLite's few superpowers.
    // It's also one of the few things you can't undo. No pressure.
    db.exec(`ALTER TABLE guild_config ADD COLUMN logging_channel_id TEXT`);

    console.log("✅ logging_channel_id column added");
    console.log("\n✅ Migration complete - you can now use /config set logging\n");
  }
}

// Show current schema so the person running this can verify it worked.
// console.table is underrated. Fight me.
console.log("Current guild_config schema:");
const schema = db.prepare(`PRAGMA table_info(guild_config)`).all();
console.table(schema);

// Actually closing the connection, because we're not savages.
// Yes, Node would clean this up on exit anyway. Yes, it still matters.
db.close();
console.log("\nDatabase closed.");
