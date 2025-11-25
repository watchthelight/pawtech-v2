/**
 * Pawtropolis Tech — migrations/003_create_user_cache.ts
 * WHAT: Creates user_cache table for Discord user identity resolution.
 * WHY: Cache usernames, avatars, and display names to avoid rate-limiting Discord API.
 * HOW: Store per-guild user data with TTL; fallback to Discord REST API on miss/stale.
 * DOCS:
 *  - Discord User: https://discord.com/developers/docs/resources/user
 *  - Discord Guild Member: https://discord.com/developers/docs/resources/guild#guild-member-object
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (IF NOT EXISTS)
 *  - Indexed on updated_at and guild_id for cache invalidation queries
 *  - Composite primary key (user_id, guild_id) for per-guild caching
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";

/**
 * Check if table exists
 */
function tableExists(db: Database, table: string): boolean {
  const result = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table);
  return !!result;
}

/**
 * Migration: Create user_cache table
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate003CreateUserCache(db: Database): void {
  logger.info("[migration 003] Starting: create user_cache table");

  // Ensure foreign keys are enabled
  db.pragma("foreign_keys = ON");

  // Check if table already exists
  if (tableExists(db, "user_cache")) {
    logger.info("[migration 003] user_cache table already exists, skipping");
    recordMigration(db, "003", "create_user_cache");
    return;
  }

  // Create user_cache table
  logger.info("[migration 003] Creating user_cache table");

  db.exec(`
    CREATE TABLE user_cache (
      user_id       TEXT NOT NULL,
      guild_id      TEXT NOT NULL,
      username      TEXT NOT NULL,
      global_name   TEXT,
      display_name  TEXT,
      avatar_hash   TEXT,
      avatar_url    TEXT NOT NULL,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, guild_id)
    )
  `);

  logger.info("[migration 003] user_cache table created");

  // Create index on updated_at for cache TTL queries
  logger.info("[migration 003] Creating index on updated_at");

  db.exec(`
    CREATE INDEX idx_user_cache_updated_at
    ON user_cache(updated_at)
  `);

  logger.info("[migration 003] Index idx_user_cache_updated_at created");

  // Create index on guild_id for guild-wide queries
  logger.info("[migration 003] Creating index on guild_id");

  db.exec(`
    CREATE INDEX idx_user_cache_guild_id
    ON user_cache(guild_id)
  `);

  logger.info("[migration 003] Index idx_user_cache_guild_id created");

  // Verification query - count rows (should be 0 initially)
  const count = db.prepare(`SELECT COUNT(*) as count FROM user_cache`).get() as { count: number };
  logger.info({ count: count.count }, "[migration 003] Verification: user_cache row count");

  // Record migration
  recordMigration(db, "003", "create_user_cache");

  logger.info("[migration 003] Migration completed successfully");
}

/**
 * Records migration in schema_migrations table
 */
function recordMigration(db: Database, version: string, name: string): void {
  // Ensure schema_migrations table exists (should exist from migration 001)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )
  `);

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
