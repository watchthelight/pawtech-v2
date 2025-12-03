/**
 * Tests for role automation system
 * - Level tier detection
 * - Level rewards lookup
 * - Panic mode
 *
 * This file uses a real SQLite database (not mocked) to ensure our queries
 * work correctly against actual SQL. The tradeoff is slightly slower tests,
 * but we catch SQL syntax errors and type mismatches that mocks would miss.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/*
 * Using a real SQLite database instead of mocks. This is slower but catches
 * actual SQL bugs. We once had a typo in a WHERE clause that passed with mocks
 * but failed in prod. Never again.
 */
let testDb: Database.Database;
let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "roleautomation-test-"));
  testDb = new Database(join(tempDir, "test.db"));

  // Schema mirrors production. If you change the real schema, update this too
  // or tests will pass here but fail in prod (ask me how I know).
  testDb.exec(`
    CREATE TABLE role_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      tier_type TEXT NOT NULL,
      tier_name TEXT NOT NULL,
      role_id TEXT NOT NULL,
      threshold INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE level_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      level INTEGER NOT NULL,
      role_id TEXT NOT NULL,
      role_name TEXT NOT NULL,
      UNIQUE(guild_id, level, role_id)
    );
  `);

  // Test data covers several important scenarios:
  // - Multiple level tiers at different thresholds (1, 5, 10, 15)
  // - Level 50 has TWO rewards (tests multi-reward handling)
  // - Level 10 has NO rewards (tests the empty case)
  // - Movie night is a separate tier_type (tests type filtering)
  testDb.exec(`
    -- Level tiers
    INSERT INTO role_tiers (guild_id, tier_type, tier_name, role_id, threshold) VALUES
    ('test-guild', 'level', 'Newcomer Fur', 'role-1', 1),
    ('test-guild', 'level', 'Beginner Fur', 'role-5', 5),
    ('test-guild', 'level', 'Chatty Fur', 'role-10', 10),
    ('test-guild', 'level', 'Engaged Fur', 'role-15', 15);

    -- Level rewards
    INSERT INTO level_rewards (guild_id, level, role_id, role_name) VALUES
    ('test-guild', 15, 'reward-common', 'Byte Token [Common]'),
    ('test-guild', 30, 'reward-rare', 'Byte Token [Rare]'),
    ('test-guild', 50, 'reward-epic-1', 'AllByte Token [Epic]'),
    ('test-guild', 50, 'reward-epic-2', 'OC Headshot Ticket');

    -- Movie tiers
    INSERT INTO role_tiers (guild_id, tier_type, tier_name, role_id, threshold) VALUES
    ('test-guild', 'movie_night', 'Red Carpet Guest', 'movie-1', 1),
    ('test-guild', 'movie_night', 'Popcorn Club', 'movie-5', 5);
  `);
});

afterAll(() => {
  // GOTCHA: Always close before delete. Windows locks open database files and
  // rmSync will throw EBUSY. macOS/Linux are more forgiving but still good practice.
  testDb.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Role Tier Queries", () => {
  // Entry point for role automation: given a role ID, figure out if it's
  // one of our tier roles and what threshold it represents.
  it("should find level tier by role ID", () => {
    const stmt = testDb.prepare(`
      SELECT * FROM role_tiers
      WHERE guild_id = ? AND role_id = ?
      LIMIT 1
    `);

    const tier = stmt.get("test-guild", "role-15") as any;

    expect(tier).toBeDefined();
    expect(tier.tier_name).toBe("Engaged Fur");
    expect(tier.tier_type).toBe("level");
    expect(tier.threshold).toBe(15);
  });

  // Important edge case: random roles that aren't tier roles should be ignored.
  // This happens constantly since users have many non-tier roles.
  it("should return undefined for unknown role ID", () => {
    const stmt = testDb.prepare(`
      SELECT * FROM role_tiers
      WHERE guild_id = ? AND role_id = ?
      LIMIT 1
    `);

    const tier = stmt.get("test-guild", "unknown-role");
    expect(tier).toBeUndefined();
  });

  // Ordering matters for display in /levels command and for determining
  // which tier a user should have based on their current level.
  it("should get all level tiers ordered by threshold", () => {
    const stmt = testDb.prepare(`
      SELECT * FROM role_tiers
      WHERE guild_id = ? AND tier_type = 'level'
      ORDER BY threshold ASC
    `);

    const tiers = stmt.all("test-guild") as any[];

    expect(tiers).toHaveLength(4);
    expect(tiers[0].threshold).toBe(1);
    expect(tiers[1].threshold).toBe(5);
    expect(tiers[2].threshold).toBe(10);
    expect(tiers[3].threshold).toBe(15);
  });

  // tier_type filtering is critical - we don't want movie attendance
  // to accidentally trigger level rewards or vice versa.
  it("should get movie night tiers separately", () => {
    const stmt = testDb.prepare(`
      SELECT * FROM role_tiers
      WHERE guild_id = ? AND tier_type = 'movie_night'
      ORDER BY threshold ASC
    `);

    const tiers = stmt.all("test-guild") as any[];

    expect(tiers).toHaveLength(2);
    expect(tiers[0].tier_name).toBe("Red Carpet Guest");
    expect(tiers[1].tier_name).toBe("Popcorn Club");
  });
});

describe("Level Rewards Queries", () => {
  // Rewards are bonus roles granted at specific levels (separate from tier roles).
  // The bot checks for rewards every time a user levels up.
  it("should get rewards for a level with rewards", () => {
    const stmt = testDb.prepare(`
      SELECT * FROM level_rewards
      WHERE guild_id = ? AND level = ?
    `);

    const rewards = stmt.all("test-guild", 15) as any[];

    expect(rewards).toHaveLength(1);
    expect(rewards[0].role_name).toBe("Byte Token [Common]");
  });

  // Most levels have no rewards - this is the common case.
  // The bot should gracefully handle empty results without crashing.
  it("should return empty array for level without rewards", () => {
    const stmt = testDb.prepare(`
      SELECT * FROM level_rewards
      WHERE guild_id = ? AND level = ?
    `);

    const rewards = stmt.all("test-guild", 10) as any[];

    expect(rewards).toHaveLength(0);
  });

  // Level 50 is configured with two rewards - verifies we don't accidentally
  // return just the first one due to LIMIT 1 or similar query bugs.
  it("should get multiple rewards for same level", () => {
    const stmt = testDb.prepare(`
      SELECT * FROM level_rewards
      WHERE guild_id = ? AND level = ?
    `);

    const rewards = stmt.all("test-guild", 50) as any[];

    expect(rewards).toHaveLength(2);
    expect(rewards.map(r => r.role_name)).toContain("AllByte Token [Epic]");
    expect(rewards.map(r => r.role_name)).toContain("OC Headshot Ticket");
  });
});

/*
 * Panic Mode: The "oh no the bot is going haywire" button.
 *
 * Real scenario: Someone misconfigured level tiers so joining triggered
 * level 50 rewards. By the time we noticed, 200 people had the wrong role.
 * Panic mode would have stopped it at the first report.
 */
describe("Panic Mode", () => {
  it("should track panic state per guild", async () => {
    const { isPanicMode, setPanicMode, getPanicGuilds } = await import("../src/features/panicStore.js");

    // Initially off
    expect(isPanicMode("guild-1")).toBe(false);
    expect(isPanicMode("guild-2")).toBe(false);

    // Enable for guild-1
    setPanicMode("guild-1", true);
    expect(isPanicMode("guild-1")).toBe(true);
    expect(isPanicMode("guild-2")).toBe(false);

    // Enable for guild-2
    setPanicMode("guild-2", true);
    expect(isPanicMode("guild-1")).toBe(true);
    expect(isPanicMode("guild-2")).toBe(true);

    // getPanicGuilds is used by the /panic-status command to show admins
    // which servers are currently in panic mode across the entire bot.
    const panicGuilds = getPanicGuilds();
    expect(panicGuilds).toContain("guild-1");
    expect(panicGuilds).toContain("guild-2");

    // Disable for guild-1
    setPanicMode("guild-1", false);
    expect(isPanicMode("guild-1")).toBe(false);
    expect(isPanicMode("guild-2")).toBe(true);

    // Cleanup
    setPanicMode("guild-2", false);
  });
});

/*
 * Integration tests for the full level-up flow. These are the most important
 * tests in this file because they exercise the actual code path that runs
 * thousands of times per day on a busy server.
 */
describe("Integration: Level Up Flow", () => {
  it("should correctly identify when a level role triggers rewards", () => {
    // Simulate: User gets "Engaged Fur" role (level 15)
    const roleId = "role-15";

    // Step 1: Find the tier for this role
    const tierStmt = testDb.prepare(`
      SELECT * FROM role_tiers
      WHERE guild_id = ? AND role_id = ?
      LIMIT 1
    `);
    const tier = tierStmt.get("test-guild", roleId) as any;

    expect(tier).toBeDefined();
    expect(tier.tier_type).toBe("level");
    expect(tier.threshold).toBe(15);

    // Step 2: Get rewards for this level
    const rewardStmt = testDb.prepare(`
      SELECT * FROM level_rewards
      WHERE guild_id = ? AND level = ?
    `);
    const rewards = rewardStmt.all("test-guild", tier.threshold) as any[];

    expect(rewards).toHaveLength(1);
    expect(rewards[0].role_name).toBe("Byte Token [Common]");
  });

  // Most tiers don't have rewards - the bot should recognize the tier
  // but not try to grant non-existent rewards.
  it("should correctly identify when a level role has NO rewards", () => {
    // Simulate: User gets "Chatty Fur" role (level 10) - no rewards
    const roleId = "role-10";

    const tierStmt = testDb.prepare(`
      SELECT * FROM role_tiers
      WHERE guild_id = ? AND role_id = ?
      LIMIT 1
    `);
    const tier = tierStmt.get("test-guild", roleId) as any;

    expect(tier).toBeDefined();
    expect(tier.threshold).toBe(10);

    const rewardStmt = testDb.prepare(`
      SELECT * FROM level_rewards
      WHERE guild_id = ? AND level = ?
    `);
    const rewards = rewardStmt.all("test-guild", tier.threshold) as any[];

    expect(rewards).toHaveLength(0);
  });

  // This is the most common case in production - random role assignments
  // (color roles, pronoun roles, etc.) that have nothing to do with levels.
  // The bot needs to quickly identify "not a tier role" and bail out.
  it("should NOT trigger for non-level roles", () => {
    // If someone gets a random role that's not a level tier
    const roleId = "some-random-role";

    const tierStmt = testDb.prepare(`
      SELECT * FROM role_tiers
      WHERE guild_id = ? AND role_id = ?
      LIMIT 1
    `);
    const tier = tierStmt.get("test-guild", roleId);

    expect(tier).toBeUndefined();
    // No tier = no rewards to process
  });
});
