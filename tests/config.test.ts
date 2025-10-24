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

describe("Config Management", () => {
  let testDb: Database.Database;
  const testDbPath = path.join(process.cwd(), "tests", "test-config.db");

  beforeEach(() => {
    //make fresh test database
    testDb = new Database(testDbPath);
    testDb.pragma("foreign_keys = ON");

    //make guild_config table
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

  afterEach(() => {
    testDb.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

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

  it("should enforce primary key constraint", () => {
    const guildId = "123456789012345678";

    testDb.prepare(`INSERT INTO guild_config (guild_id) VALUES (?)`).run(guildId);

    expect(() => {
      testDb.prepare(`INSERT INTO guild_config (guild_id) VALUES (?)`).run(guildId);
    }).toThrow();
  });
});
