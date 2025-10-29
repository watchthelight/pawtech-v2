/**
 * Pawtropolis Tech — migrations/lib/helpers.ts
 * WHAT: Shared utility functions for database migrations
 * WHY: DRY principle - avoid duplicating common migration logic
 * HOW: Exported functions for table/column checks and migration recording
 * DOCS:
 *  - SQLite PRAGMA: https://sqlite.org/pragma.html
 *  - better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *
 * USAGE:
 *   import { columnExists, tableExists, recordMigration } from "./lib/helpers.js";
 *
 *   if (!tableExists(db, "my_table")) {
 *     db.exec(`CREATE TABLE my_table (...)`);
 *   }
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../../src/lib/logger.js";

/**
 * Check if a table exists in the database
 *
 * @param db - better-sqlite3 Database instance
 * @param tableName - Name of the table to check
 * @returns true if table exists, false otherwise
 *
 * @example
 * if (tableExists(db, "users")) {
 *   console.log("Users table exists");
 * }
 */
export function tableExists(db: Database, tableName: string): boolean {
  const result = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName);
  return !!result;
}

/**
 * Check if a column exists in a table
 *
 * @param db - better-sqlite3 Database instance
 * @param tableName - Name of the table
 * @param columnName - Name of the column to check
 * @returns true if column exists, false otherwise
 *
 * @example
 * if (!columnExists(db, "users", "email")) {
 *   db.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
 * }
 */
export function columnExists(db: Database, tableName: string, columnName: string): boolean {
  const result = db
    .prepare(`SELECT COUNT(*) as count FROM pragma_table_info(?) WHERE name=?`)
    .get(tableName, columnName) as { count: number };
  return result.count > 0;
}

/**
 * Check if an index exists in the database
 *
 * @param db - better-sqlite3 Database instance
 * @param indexName - Name of the index to check
 * @returns true if index exists, false otherwise
 *
 * @example
 * if (!indexExists(db, "idx_users_email")) {
 *   db.exec(`CREATE INDEX idx_users_email ON users(email)`);
 * }
 */
export function indexExists(db: Database, indexName: string): boolean {
  const result = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
    .get(indexName);
  return !!result;
}

/**
 * Get list of all columns in a table
 *
 * @param db - better-sqlite3 Database instance
 * @param tableName - Name of the table
 * @returns Array of column info objects
 *
 * @example
 * const columns = getTableColumns(db, "users");
 * console.log(columns.map(c => c.name));
 */
export function getTableColumns(
  db: Database,
  tableName: string
): Array<{ name: string; type: string; notnull: number; dflt_value: any; pk: number }> {
  return db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: any;
    pk: number;
  }>;
}

/**
 * Records migration in schema_migrations table
 * Creates table if it doesn't exist, handles legacy schema migration
 *
 * @param db - better-sqlite3 Database instance
 * @param version - Migration version number (e.g., "011")
 * @param name - Migration name in snake_case (e.g., "add_custom_status_column")
 *
 * @example
 * export function migrate012AddUserRoles(db: Database): void {
 *   // ... migration logic ...
 *   recordMigration(db, "012", "add_user_roles");
 * }
 */
export function recordMigration(db: Database, version: string, name: string): void {
  // Check if schema_migrations table exists
  const schemaTableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)
    .get();

  if (!schemaTableExists) {
    // Create new table with proper schema
    logger.info("[migration] Creating schema_migrations table");
    db.exec(`
      CREATE TABLE schema_migrations (
        version     TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        applied_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `);
  } else {
    // Check if table has old schema (filename column instead of version/name)
    const cols = db.prepare(`PRAGMA table_info(schema_migrations)`).all() as Array<{
      name: string;
    }>;
    const hasFilenameCol = cols.some((c) => c.name === "filename");
    const hasVersionCol = cols.some((c) => c.name === "version");

    if (hasFilenameCol && !hasVersionCol) {
      // Legacy schema detected - migrate to new schema
      logger.info("[migration] Migrating legacy schema_migrations table to new schema");

      // Rename old table
      db.exec(`ALTER TABLE schema_migrations RENAME TO schema_migrations_old`);

      // Create new table
      db.exec(`
        CREATE TABLE schema_migrations (
          version     TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          applied_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )
      `);

      // Copy old data (extract version from filename like "2025-10-20_review_action_free_text.ts")
      db.exec(`
        INSERT INTO schema_migrations (version, name, applied_at)
        SELECT
          substr(filename, 1, instr(filename, '_') - 1) as version,
          substr(filename, instr(filename, '_') + 1, length(filename) - instr(filename, '_') - 3) as name,
          strftime('%s', applied_at) as applied_at
        FROM schema_migrations_old
      `);

      // Drop old table
      db.exec(`DROP TABLE schema_migrations_old`);

      logger.info("[migration] Legacy schema_migrations table migrated successfully");
    }
  }

  // Record migration (idempotent - ON CONFLICT DO NOTHING)
  db.prepare(
    `
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES (?, ?, strftime('%s', 'now'))
    ON CONFLICT(version) DO NOTHING
  `
  ).run(version, name);

  logger.info({ version, name }, "[migration] Recorded in schema_migrations");
}

/**
 * Get count of rows in a table (useful for verification)
 *
 * @param db - better-sqlite3 Database instance
 * @param tableName - Name of the table
 * @returns Number of rows in the table
 *
 * @example
 * const count = getRowCount(db, "users");
 * logger.info({ count }, "Users table row count");
 */
export function getRowCount(db: Database, tableName: string): number {
  const result = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as {
    count: number;
  };
  return result.count;
}

/**
 * Enable foreign key constraints
 * Should be called at the start of every migration
 *
 * @param db - better-sqlite3 Database instance
 *
 * @example
 * export function migrate012AddUserRoles(db: Database): void {
 *   enableForeignKeys(db);
 *   // ... migration logic ...
 * }
 */
export function enableForeignKeys(db: Database): void {
  db.pragma("foreign_keys = ON");
}

/**
 * Check if foreign keys are enabled
 *
 * @param db - better-sqlite3 Database instance
 * @returns true if foreign keys are enabled, false otherwise
 */
export function foreignKeysEnabled(db: Database): boolean {
  const result = db.pragma("foreign_keys", { simple: true }) as number;
  return result === 1;
}
