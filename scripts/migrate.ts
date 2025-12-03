/**
 * Pawtropolis Tech — scripts/migrate.ts
 * WHAT: Migration runner that applies versioned schema migrations in order.
 * WHY: Provides formal migration tracking with schema_migrations table.
 * HOW: Scans migrations/ directory, checks applied versions, runs pending migrations.
 * DOCS:
 *  - better-sqlite3 transactions: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transaction
 *  - SQLite PRAGMA: https://sqlite.org/pragma.html
 *
 * USAGE:
 *   tsx scripts/migrate.ts           # Run all pending migrations
 *   tsx scripts/migrate.ts --dry-run # Show pending migrations without applying
 *
 * SAFETY:
 *  - Each migration runs in a transaction (atomicity)
 *  - Foreign keys are enabled (PRAGMA foreign_keys=ON)
 *  - Creates database backup before first migration
 *  - Logs detailed summary of applied migrations
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Database from "better-sqlite3";
import { readdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "url";
import dotenv from "dotenv";

// Load .env for DB_PATH and LOGGING_CHANNEL
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// Database path
const dbPath = process.env.DB_PATH || "./data/data.db";
const migrationsDir = join(__dirname, "../migrations");

console.log("\n=== Pawtropolis Migration Runner ===\n");
console.log(`Database: ${dbPath}`);
console.log(`Migrations directory: ${migrationsDir}`);
console.log(`Mode: ${dryRun ? "DRY RUN (no changes)" : "APPLY"}\n`);

// Open database with same settings as production
// GOTCHA: fileMustExist: false means we'll happily create a fresh DB if the path is wrong.
// You'll only notice when all your data is mysteriously "gone."
const db = new Database(dbPath, { fileMustExist: false });
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
// WHY: SQLite has foreign keys OFF by default. Yes, really. The ghost of the 1990s haunts us still.
db.pragma("foreign_keys = ON"); // Critical for referential integrity
// 5 seconds to wait for a locked DB. If you're blocked longer than that, something is very wrong.
db.pragma("busy_timeout = 5000");

/**
 * Ensure schema_migrations table exists
 */
function ensureSchemaMigrationsTable(): void {
  // Check if table exists first
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)
    .get();

  if (!tableExists) {
    console.log("📋 Creating schema_migrations tracking table");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )
  `);
}

/**
 * Get list of applied migration versions
 */
function getAppliedVersions(): Set<string> {
  try {
    const rows = db
      .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
      .all() as Array<{ version: string }>;

    return new Set(rows.map((r) => r.version));
  } catch (err: any) {
    // Table doesn't exist yet (pre-migration state)
    // This catch handles the chicken-and-egg problem: we need migrations to create
    // the table that tracks migrations. First run is always a special snowflake.
    if (err?.code === "SQLITE_ERROR" && err?.message?.includes("no such")) {
      return new Set();
    }
    throw err;
  }
}

/**
 * Scan migrations directory for migration files
 * Returns sorted list of { version, name, path }
 */
function scanMigrations(): Array<{ version: string; name: string; path: string }> {
  if (!existsSync(migrationsDir)) {
    console.log(`⚠️  Migrations directory not found: ${migrationsDir}`);
    return [];
  }

  // GOTCHA: We rely on string sorting working correctly for three-digit prefixes.
  // This means migration 099 comes before 100, but 100 comes AFTER 010.
  // Don't get clever with single-digit prefixes or you'll have a bad time.
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".ts") && /^\d{3}_/.test(f))
    .sort();

  return files.map((file) => {
    const match = file.match(/^(\d{3})_(.+)\.ts$/);
    if (!match) throw new Error(`Invalid migration filename: ${file}`);

    const [, version, name] = match;
    return {
      version,
      name,
      path: join(migrationsDir, file),
    };
  });
}

/**
 * Create database backup before applying migrations
 */
function createBackup(): void {
  if (dryRun) return;

  // This backup saved my bacon exactly once. Worth every byte.
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${dbPath}.backup-${timestamp}`;

  console.log(`📦 Creating backup: ${backupPath}`);
  copyFileSync(dbPath, backupPath);
  console.log(`✅ Backup created successfully\n`);
}

/**
 * Apply a single migration in a transaction
 */
async function applyMigration(migration: {
  version: string;
  name: string;
  path: string;
}): Promise<void> {
  console.log(`\n🔄 Applying migration ${migration.version}: ${migration.name}`);

  try {
    // Dynamic import of migration module
    // Convert Windows path to file:// URL for ESM compatibility
    // WHY the weird function naming convention? Because "migrate" alone would collide
    // if you ever import multiple migrations, and generic export names cause headaches
    // in dynamic imports. The version+name combo ensures uniqueness.
    const migrationUrl = pathToFileURL(migration.path).href;
    const migrationModule = await import(migrationUrl);
    const migrateFn = migrationModule[`migrate${migration.version}${toPascalCase(migration.name)}`];

    if (typeof migrateFn !== "function") {
      throw new Error(
        `Migration ${migration.version} does not export a migrate function. Expected: migrate${migration.version}${toPascalCase(migration.name)}`
      );
    }

    // Run migration in transaction
    // GOTCHA: The transaction only rolls back if an exception is thrown.
    // If your migration does something stupid but doesn't throw, congratulations,
    // you've successfully committed your mistake to the database.
    const runMigration = db.transaction(() => {
      migrateFn(db);
    });

    runMigration();

    console.log(`✅ Migration ${migration.version} applied successfully`);
  } catch (err) {
    console.error(`\n❌ Migration ${migration.version} FAILED:`);
    console.error(err);
    throw err;
  }
}

/**
 * Convert snake_case to PascalCase for function name lookup
 */
// Look, I know there are npm packages for this. Sometimes you just write the obvious thing.
function toPascalCase(str: string): string {
  return str
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Main migration runner
 */
async function runMigrations(): Promise<void> {
  try {
    // Ensure schema_migrations table exists
    ensureSchemaMigrationsTable();

    // Get applied versions
    const appliedVersions = getAppliedVersions();
    console.log(
      `Applied migrations: ${appliedVersions.size > 0 ? Array.from(appliedVersions).join(", ") : "none"}`
    );

    // Scan for available migrations
    const allMigrations = scanMigrations();
    console.log(`Available migrations: ${allMigrations.length}`);

    // Find pending migrations
    const pendingMigrations = allMigrations.filter((m) => !appliedVersions.has(m.version));

    if (pendingMigrations.length === 0) {
      console.log("\n✅ Database is up to date - no pending migrations\n");
      return;
    }

    console.log(`\nPending migrations: ${pendingMigrations.length}`);
    pendingMigrations.forEach((m) => {
      console.log(`  - ${m.version}: ${m.name}`);
    });

    if (dryRun) {
      console.log("\n🔍 DRY RUN - no changes applied\n");
      return;
    }

    // Create backup before applying migrations
    if (pendingMigrations.length > 0) {
      createBackup();
    }

    // Apply each pending migration
    for (const migration of pendingMigrations) {
      await applyMigration(migration);
    }

    console.log(`\n✅ Successfully applied ${pendingMigrations.length} migration(s)\n`);

    // Show final applied versions
    // Yes, finalApplied is unused. It's here for debugging and the type checker doesn't care.
    const finalApplied = getAppliedVersions();
    console.log("All applied migrations:");
    const rows = db
      .prepare(`SELECT version, name, applied_at FROM schema_migrations ORDER BY version`)
      .all() as Array<{ version: string; name: string; applied_at: number }>;

    console.table(
      rows.map((r) => ({
        version: r.version,
        name: r.name,
        applied_at: new Date(r.applied_at * 1000).toISOString(),
      }))
    );
  } catch (err) {
    console.error("\n❌ Migration failed:");
    console.error(err);
    process.exit(1);
  } finally {
    // Always close your database connections. SQLite is forgiving but not infinitely so.
    db.close();
    console.log("\nDatabase closed.");
  }
}

// Run migrations
runMigrations();
