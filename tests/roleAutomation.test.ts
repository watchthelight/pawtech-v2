/**
 * Tests for role automation system
 * - Level tier detection
 * - Level rewards lookup
 * - Panic mode
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Create a test database
let testDb: Database.Database;
let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "roleautomation-test-"));
  testDb = new Database(join(tempDir, "test.db"));

  // Create tables
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

  // Insert test data
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
  testDb.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Role Tier Queries", () => {
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

  it("should return undefined for unknown role ID", () => {
    const stmt = testDb.prepare(`
      SELECT * FROM role_tiers
      WHERE guild_id = ? AND role_id = ?
      LIMIT 1
    `);

    const tier = stmt.get("test-guild", "unknown-role");
    expect(tier).toBeUndefined();
  });

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
  it("should get rewards for a level with rewards", () => {
    const stmt = testDb.prepare(`
      SELECT * FROM level_rewards
      WHERE guild_id = ? AND level = ?
    `);

    const rewards = stmt.all("test-guild", 15) as any[];

    expect(rewards).toHaveLength(1);
    expect(rewards[0].role_name).toBe("Byte Token [Common]");
  });

  it("should return empty array for level without rewards", () => {
    const stmt = testDb.prepare(`
      SELECT * FROM level_rewards
      WHERE guild_id = ? AND level = ?
    `);

    const rewards = stmt.all("test-guild", 10) as any[];

    expect(rewards).toHaveLength(0);
  });

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

describe("Panic Mode", () => {
  // Test the panic store in isolation
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

    // Get all panic guilds
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
