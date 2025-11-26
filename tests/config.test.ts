/**
 * WHAT: Proves baseline DB behaviors for guild_config (insert/update/defaults/PK constraint).
 * HOW: Uses in-memory better-sqlite3 to run statements and assertions.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Tests for guild configuration storage.
 *
 * These are low-level database tests that verify SQLite behaves as expected
 * for the guild_config table. We're testing the schema itself, not the
 * application's config layer (that's in configStore tests).
 *
 * Why use a file-based DB instead of :memory:? This mimics production more
 * closely and catches file permission issues. The afterEach cleanup ensures
 * no test artifacts are left behind.
 */
describe("Config Management", () => {
  let testDb: Database.Database;
  const testDbPath = path.join(process.cwd(), "tests", "test-config.db");

  /**
   * Each test gets a fresh database with the full guild_config schema.
   * foreign_keys = ON ensures referential integrity (if we add FKs later).
   */
  beforeEach(() => {
    testDb = new Database(testDbPath);
    testDb.pragma("foreign_keys = ON");

    /**
     * This schema mirrors production. Note the SQLite-specific default syntax:
     * - TEXT columns default to NULL unless specified
     * - datetime('now') generates timestamps in UTC
     * - INTEGER for booleans (SQLite has no native bool type)
     */
    testDb.exec(`
      CREATE TABLE guild_config (
        guild_id TEXT PRIMARY KEY,
        review_channel_id TEXT,
        gate_channel_id TEXT,
        unverified_channel_id TEXT,
        general_channel_id TEXT,
        accepted_role_id TEXT,
        reviewer_role_id TEXT,
        image_search_url_template TEXT NOT NULL DEFAULT 'https://lens.google.com/uploadbyurl?url={avatarUrl}',
        reapply_cooldown_hours INTEGER NOT NULL DEFAULT 24,
        min_account_age_hours INTEGER NOT NULL DEFAULT 0,
        min_join_age_hours INTEGER NOT NULL DEFAULT 0,
          avatar_scan_enabled INTEGER NOT NULL DEFAULT 0,
          avatar_scan_nsfw_threshold REAL NOT NULL DEFAULT 0.60,
          avatar_scan_skin_edge_threshold REAL NOT NULL DEFAULT 0.18,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  /** Clean up the test database file after each test. */
  afterEach(() => {
    testDb.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  /** Basic insert test. Discord snowflake IDs are 18-digit strings. */
  it("should insert new guild config", () => {
    const guildId = "123456789012345678";
    const reviewChannelId = "987654321098765432";

    testDb
      .prepare(`INSERT INTO guild_config (guild_id, review_channel_id) VALUES (?, ?)`)
      .run(guildId, reviewChannelId);

    const result = testDb.prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId) as {
      guild_id: string;
      review_channel_id: string;
    };

    expect(result.guild_id).toBe(guildId);
    expect(result.review_channel_id).toBe(reviewChannelId);
  });

  /**
   * UPDATE test: Simulates an admin changing the reapply cooldown.
   * This is the primary way configs are modified post-setup.
   */
  it("should update existing guild config", () => {
    const guildId = "123456789012345678";

    // Insert initial config
    testDb
      .prepare(`INSERT INTO guild_config (guild_id, reapply_cooldown_hours) VALUES (?, ?)`)
      .run(guildId, 24);

    // Update it
    testDb
      .prepare(`UPDATE guild_config SET reapply_cooldown_hours = ? WHERE guild_id = ?`)
      .run(48, guildId);

    const result = testDb
      .prepare("SELECT reapply_cooldown_hours FROM guild_config WHERE guild_id = ?")
      .get(guildId) as { reapply_cooldown_hours: number };

    expect(result.reapply_cooldown_hours).toBe(48);
  });

  /**
   * Defaults test: A minimal insert (just guild_id) should populate all
   * NOT NULL columns with sensible defaults. This is critical for the
   * onboarding flow where a guild might not configure everything immediately.
   */
  it("should use default values when not specified", () => {
    const guildId = "123456789012345678";

    testDb.prepare(`INSERT INTO guild_config (guild_id) VALUES (?)`).run(guildId);

    const result = testDb.prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId) as {
      reapply_cooldown_hours: number;
      min_account_age_hours: number;
      image_search_url_template: string;
    };

    expect(result.reapply_cooldown_hours).toBe(24);
    expect(result.min_account_age_hours).toBe(0);
    expect(result.image_search_url_template).toBe(
      "https://lens.google.com/uploadbyurl?url={avatarUrl}"
    );
  });

  /**
   * PK constraint test: Attempting to insert a duplicate guild_id should throw.
   * This protects against accidental config overwrites and ensures upsert
   * logic (INSERT OR REPLACE / ON CONFLICT) is used intentionally.
   */
  it("should enforce primary key constraint", () => {
    const guildId = "123456789012345678";

    testDb.prepare(`INSERT INTO guild_config (guild_id) VALUES (?)`).run(guildId);

    expect(() => {
      testDb.prepare(`INSERT INTO guild_config (guild_id) VALUES (?)`).run(guildId);
    }).toThrow();
  });
});
