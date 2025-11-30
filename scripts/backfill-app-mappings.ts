/**
 * Pawtropolis Tech — scripts/backfill-app-mappings.ts
 * WHAT: Backfill app_short_codes table with mappings for existing applications
 * WHY: Migration 019 creates the table structure; this script populates it
 * HOW: Uses syncShortCodeMappings() from appLookup.ts to generate mappings
 * DOCS:
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *
 * USAGE:
 *   tsx scripts/backfill-app-mappings.ts                    # Backfill all guilds
 *   tsx scripts/backfill-app-mappings.ts --guild <guildId>  # Backfill specific guild
 *   tsx scripts/backfill-app-mappings.ts --dry-run          # Preview without applying
 *
 * SAFETY:
 *  - INSERT OR IGNORE (idempotent, safe to re-run)
 *  - Runs in transaction (atomic)
 *  - Logs detailed progress for each guild
 *  - Handles duplicate codes gracefully
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Database from "better-sqlite3";
import dotenv from "dotenv";
import { syncShortCodeMappings } from "../src/features/appLookup.js";

// Load .env for DB_PATH
dotenv.config();

/**
 * Validate a Discord snowflake ID (17-19 digits)
 */
function validateDiscordId(id: string | undefined, name: string): string {
  if (!id) {
    console.error(`Error: ${name} is required`);
    process.exit(1);
  }
  if (!/^\d{17,19}$/.test(id)) {
    console.error(`Error: ${name} must be a valid Discord snowflake (17-19 digits)`);
    process.exit(1);
  }
  return id;
}

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const rawGuildId = args.find((arg) => arg.startsWith("--guild="))?.split("=")[1];
const guildIdArg = rawGuildId ? validateDiscordId(rawGuildId, "guildId") : undefined;

// Database path
const dbPath = process.env.DB_PATH || "./data/data.db";

console.log("\n=== Pawtropolis App Mappings Backfill ===\n");
console.log(`Database: ${dbPath}`);
console.log(`Mode: ${dryRun ? "DRY RUN (no changes)" : "APPLY"}`);
if (guildIdArg) {
  console.log(`Guild filter: ${guildIdArg}`);
}
console.log("");

// Open database with production settings
const db = new Database(dbPath, { fileMustExist: true });
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

/**
 * Check if app_short_codes table exists
 */
function checkTableExists(): boolean {
  const result = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_short_codes'")
    .get() as { name: string } | undefined;

  return !!result;
}

/**
 * Get statistics about existing mappings and applications
 */
function getStats(guildId?: string): {
  totalApps: number;
  existingMappings: number;
  missingMappings: number;
} {
  let totalAppsQuery = "SELECT COUNT(*) as count FROM application";
  let existingMappingsQuery = "SELECT COUNT(*) as count FROM app_short_codes";
  const params: string[] = [];

  if (guildId) {
    totalAppsQuery += " WHERE guild_id = ?";
    existingMappingsQuery += " WHERE guild_id = ?";
    params.push(guildId);
  }

  const totalApps = (
    db.prepare(totalAppsQuery).get(...params) as { count: number }
  ).count;

  const existingMappings = (
    db.prepare(existingMappingsQuery).get(...params) as { count: number }
  ).count;

  return {
    totalApps,
    existingMappings,
    missingMappings: totalApps - existingMappings,
  };
}

/**
 * Get list of guilds with applications
 */
function getGuilds(): Array<{ guild_id: string; count: number }> {
  return db
    .prepare(
      `
    SELECT guild_id, COUNT(*) as count
    FROM application
    GROUP BY guild_id
    ORDER BY count DESC
  `
    )
    .all() as Array<{ guild_id: string; count: number }>;
}

/**
 * Main backfill execution
 */
async function main() {
  // Check if app_short_codes table exists
  if (!checkTableExists()) {
    console.error("❌ Error: app_short_codes table does not exist");
    console.error("   Run migration 019 first: npm run migrate");
    process.exit(1);
  }

  // Get initial stats
  const statsBefore = getStats(guildIdArg);
  console.log("📊 Current state:");
  console.log(`   Total applications: ${statsBefore.totalApps}`);
  console.log(`   Existing mappings:  ${statsBefore.existingMappings}`);
  console.log(`   Missing mappings:   ${statsBefore.missingMappings}`);
  console.log("");

  if (statsBefore.missingMappings === 0) {
    console.log("✅ All applications already have mappings. Nothing to do.");
    process.exit(0);
  }

  // If dry run, show what would be created
  if (dryRun) {
    console.log("🔍 DRY RUN: Would create mappings for:");
    if (guildIdArg) {
      console.log(`   Guild ${guildIdArg}: ${statsBefore.missingMappings} mappings`);
    } else {
      const guilds = getGuilds();
      for (const guild of guilds) {
        const guildStats = getStats(guild.guild_id);
        if (guildStats.missingMappings > 0) {
          console.log(`   Guild ${guild.guild_id}: ${guildStats.missingMappings} mappings`);
        }
      }
    }
    console.log("\n💡 Run without --dry-run to apply changes");
    process.exit(0);
  }

  // Execute backfill
  console.log("🔄 Starting backfill...\n");

  try {
    let totalCreated = 0;

    if (guildIdArg) {
      // Backfill specific guild
      console.log(`Processing guild ${guildIdArg}...`);
      const created = syncShortCodeMappings(guildIdArg);
      console.log(`✅ Created ${created} mappings for guild ${guildIdArg}`);
      totalCreated = created;
    } else {
      // Backfill all guilds
      const guilds = getGuilds();
      console.log(`Found ${guilds.length} guilds with applications\n`);

      for (const guild of guilds) {
        console.log(`Processing guild ${guild.guild_id} (${guild.count} apps)...`);
        const created = syncShortCodeMappings(guild.guild_id);
        console.log(`  ✅ Created ${created} mappings`);
        totalCreated += created;
      }
    }

    // Get final stats
    const statsAfter = getStats(guildIdArg);
    console.log("\n📊 Final state:");
    console.log(`   Total applications: ${statsAfter.totalApps}`);
    console.log(`   Existing mappings:  ${statsAfter.existingMappings}`);
    console.log(`   Missing mappings:   ${statsAfter.missingMappings}`);
    console.log("");
    console.log(`✅ Backfill complete! Created ${totalCreated} mappings.`);

    if (statsAfter.missingMappings > 0) {
      console.log(
        `⚠️  Warning: ${statsAfter.missingMappings} applications still missing mappings (check for errors above)`
      );
    }
  } catch (err) {
    console.error("\n❌ Backfill failed:");
    console.error(err);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Run main function
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
