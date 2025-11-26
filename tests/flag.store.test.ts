/**
 * WHAT: Proves flagsStore CRUD operations (getExistingFlag, upsertManualFlag, isAlreadyFlagged)
 * HOW: Uses in-memory better-sqlite3 to test store layer
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Mock the logger to prevent console noise during tests.
 * This must be called before importing flagsStore.
 */
vi.mock("../src/lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

/**
 * Mock the database module with a getter.
 *
 * Gotcha: We use a getter here because testDb gets reassigned in beforeEach.
 * A plain object { db: testDb } would capture the initial undefined value.
 * The getter ensures we always get the current testDb instance.
 */
let testDb: Database.Database;
vi.mock("../src/db/db.js", () => ({
  get db() {
    return testDb;
  },
}));

import { getExistingFlag, isAlreadyFlagged, upsertManualFlag } from "../src/store/flagsStore.js";

/**
 * Tests for the flags store - the persistence layer for user moderation flags.
 *
 * The flagging system lets moderators mark users for review. Flags can be:
 * - Manual (mod flagged someone explicitly)
 * - Automatic (avatar scan, account age, etc.)
 *
 * Key behaviors tested:
 * - CRUD operations on flags
 * - Upsert semantics (create or update)
 * - Input sanitization (trimming, truncation)
 * - Idempotency checks (isAlreadyFlagged)
 */
describe("flagsStore", () => {
  const testDbPath = path.join(process.cwd(), "tests", "test-flags-store.db");

  /**
   * Fresh database for each test. The user_activity table stores both
   * activity tracking and flag data (denormalized for query performance).
   *
   * Note: Timestamps are stored as Unix epoch integers, not ISO strings.
   */
  beforeEach(() => {
    testDb = new Database(testDbPath);
    testDb.pragma("foreign_keys = ON");

    testDb.exec(`
      CREATE TABLE user_activity (
        guild_id           TEXT NOT NULL,
        user_id            TEXT NOT NULL,
        joined_at          INTEGER NOT NULL,
        first_message_at   INTEGER,
        flagged_at         INTEGER,
        flagged_reason     TEXT,
        manual_flag        INTEGER DEFAULT 0,
        flagged_by         TEXT,
        PRIMARY KEY (guild_id, user_id)
      )
    `);
  });

  afterEach(() => {
    testDb.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  /**
   * getExistingFlag: Retrieves a user's flag record if one exists.
   * Returns null if the user doesn't exist OR exists but isn't flagged.
   */
  describe("getExistingFlag", () => {
    /** User not in database at all. */
    it("returns null when user is not flagged", () => {
      const result = getExistingFlag("guild123", "user456");
      expect(result).toBeNull();
    });

    /** User exists and is flagged - should return full flag data. */
    it("returns flag row when user is flagged", () => {
      const guildId = "guild123";
      const userId = "user456";
      const now = Math.floor(Date.now() / 1000);

      testDb
        .prepare(
          `INSERT INTO user_activity (guild_id, user_id, joined_at, flagged_at, flagged_reason, manual_flag, flagged_by)
           VALUES (?, ?, ?, ?, ?, 1, ?)`
        )
        .run(guildId, userId, now, now, "Test reason", "mod789");

      const result = getExistingFlag(guildId, userId);
      expect(result).not.toBeNull();
      expect(result?.guild_id).toBe(guildId);
      expect(result?.user_id).toBe(userId);
      expect(result?.flagged_reason).toBe("Test reason");
      expect(result?.manual_flag).toBe(1);
      expect(result?.flagged_by).toBe("mod789");
    });

    /**
     * Edge case: User has activity record but flagged_at is NULL.
     * This happens when we track a user's join/messages but haven't flagged them.
     */
    it("returns null when user exists but is not flagged", () => {
      const guildId = "guild123";
      const userId = "user456";
      const now = Math.floor(Date.now() / 1000);

      testDb
        .prepare(
          `INSERT INTO user_activity (guild_id, user_id, joined_at, flagged_at)
           VALUES (?, ?, ?, NULL)`
        )
        .run(guildId, userId, now);

      const result = getExistingFlag(guildId, userId);
      expect(result).toBeNull();
    });
  });

  /**
   * isAlreadyFlagged: Quick boolean check for flag existence.
   * Used to prevent duplicate flags or show existing flag info in UI.
   */
  describe("isAlreadyFlagged", () => {
    it("returns false when user is not flagged", () => {
      const result = isAlreadyFlagged("guild123", "user456");
      expect(result).toBe(false);
    });

    /** Manual flag (mod-initiated) should count. */
    it("returns true when user is manually flagged", () => {
      const guildId = "guild123";
      const userId = "user456";
      const now = Math.floor(Date.now() / 1000);

      testDb
        .prepare(
          `INSERT INTO user_activity (guild_id, user_id, joined_at, flagged_at, flagged_reason, manual_flag, flagged_by)
           VALUES (?, ?, ?, ?, ?, 1, ?)`
        )
        .run(guildId, userId, now, now, "Test reason", "mod789");

      const result = isAlreadyFlagged(guildId, userId);
      expect(result).toBe(true);
    });

    /**
     * Auto-flag (system-initiated, e.g. avatar scan) should also count.
     * Note: manual_flag=0 distinguishes from manual flags.
     */
    it("returns true when user is auto-flagged", () => {
      const guildId = "guild123";
      const userId = "user456";
      const now = Math.floor(Date.now() / 1000);

      testDb
        .prepare(
          `INSERT INTO user_activity (guild_id, user_id, joined_at, flagged_at, flagged_reason, manual_flag)
           VALUES (?, ?, ?, ?, ?, 0)`
        )
        .run(guildId, userId, now, now, "Auto-flagged");

      const result = isAlreadyFlagged(guildId, userId);
      expect(result).toBe(true);
    });
  });

  /**
   * upsertManualFlag: Creates or updates a manual flag for a user.
   * "Upsert" means INSERT if new, UPDATE if exists.
   */
  describe("upsertManualFlag", () => {
    /**
     * Insert case: User doesn't exist in user_activity yet.
     * Should create a new row with all flag data populated.
     */
    it("creates new flag record when user does not exist", () => {
      const guildId = "guild123";
      const userId = "user456";
      const reason = "Suspicious behavior";
      const flaggedBy = "mod789";
      const joinedAt = Math.floor(Date.now() / 1000) - 86400; // 1 day ago

      const result = upsertManualFlag({
        guildId,
        userId,
        reason,
        flaggedBy,
        joinedAt,
      });

      expect(result).toBeDefined();
      expect(result.guild_id).toBe(guildId);
      expect(result.user_id).toBe(userId);
      expect(result.flagged_reason).toBe(reason);
      expect(result.manual_flag).toBe(1);
      expect(result.flagged_by).toBe(flaggedBy);
      expect(result.joined_at).toBe(joinedAt);
      expect(result.flagged_at).toBeGreaterThan(0);
    });

    /**
     * Update case: User exists (tracked join/message) but not flagged yet.
     * Should add flag data without clobbering existing activity data.
     * The joined_at preservation is key - we don't want to lose when they actually joined.
     */
    it("updates existing user_activity row with flag data", () => {
      const guildId = "guild123";
      const userId = "user456";
      const joinedAt = Math.floor(Date.now() / 1000) - 86400;

      // Insert existing user_activity row without flag
      testDb
        .prepare(
          `INSERT INTO user_activity (guild_id, user_id, joined_at, first_message_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(guildId, userId, joinedAt, joinedAt + 3600);

      const reason = "Bot-like behavior";
      const flaggedBy = "mod999";

      const result = upsertManualFlag({
        guildId,
        userId,
        reason,
        flaggedBy,
      });

      expect(result).toBeDefined();
      expect(result.flagged_reason).toBe(reason);
      expect(result.manual_flag).toBe(1);
      expect(result.flagged_by).toBe(flaggedBy);
      expect(result.joined_at).toBe(joinedAt); // Original joined_at preserved
    });

    /**
     * Input sanitization: Long reasons are truncated to 512 chars.
     * Prevents DB bloat and potential DoS from extremely long strings.
     */
    it("truncates reason to 512 characters", () => {
      const guildId = "guild123";
      const userId = "user456";
      const longReason = "x".repeat(600); // 600 chars
      const flaggedBy = "mod789";

      const result = upsertManualFlag({
        guildId,
        userId,
        reason: longReason,
        flaggedBy,
      });

      expect(result.flagged_reason).toHaveLength(512);
      expect(result.flagged_reason).toBe("x".repeat(512));
    });

    /** Input sanitization: Leading/trailing whitespace is stripped. */
    it("trims whitespace from reason", () => {
      const guildId = "guild123";
      const userId = "user456";
      const reason = "  Spam account  ";
      const flaggedBy = "mod789";

      const result = upsertManualFlag({
        guildId,
        userId,
        reason,
        flaggedBy,
      });

      expect(result.flagged_reason).toBe("Spam account");
    });

    /**
     * Default handling: When joinedAt isn't provided (e.g., flagging a user
     * who left and rejoined), use current time as a fallback.
     */
    it("uses current timestamp for joined_at when not provided", () => {
      const guildId = "guild123";
      const userId = "user456";
      const reason = "Test";
      const flaggedBy = "mod789";

      const beforeTime = Math.floor(Date.now() / 1000);

      const result = upsertManualFlag({
        guildId,
        userId,
        reason,
        flaggedBy,
      });

      const afterTime = Math.floor(Date.now() / 1000);

      expect(result.joined_at).toBeGreaterThanOrEqual(beforeTime);
      expect(result.joined_at).toBeLessThanOrEqual(afterTime);
    });

    /**
     * Integration: After upserting, isAlreadyFlagged and getExistingFlag
     * should both work correctly. This verifies the data is stored properly.
     */
    it("prevents duplicate manual flags via isAlreadyFlagged check", () => {
      const guildId = "guild123";
      const userId = "user456";
      const reason1 = "First flag";
      const flaggedBy1 = "mod789";

      // Create first flag
      upsertManualFlag({ guildId, userId, reason: reason1, flaggedBy: flaggedBy1 });

      // Check that user is now flagged
      expect(isAlreadyFlagged(guildId, userId)).toBe(true);

      // Get the first flag
      const firstFlag = getExistingFlag(guildId, userId);
      expect(firstFlag?.flagged_reason).toBe(reason1);
    });
  });

  /**
   * End-to-end test: Full workflow from unflagged -> flagged -> retrieved.
   * This catches integration issues between the three store functions.
   */
  describe("round-trip test", () => {
    it("successfully creates flag, retrieves it, and confirms isAlreadyFlagged", () => {
      const guildId = "guild999";
      const userId = "user888";
      const reason = "Manual review required";
      const flaggedBy = "mod777";
      const joinedAt = Math.floor(Date.now() / 1000) - 172800; // 2 days ago

      // Initially not flagged
      expect(isAlreadyFlagged(guildId, userId)).toBe(false);
      expect(getExistingFlag(guildId, userId)).toBeNull();

      // Create flag
      const created = upsertManualFlag({
        guildId,
        userId,
        reason,
        flaggedBy,
        joinedAt,
      });

      expect(created.guild_id).toBe(guildId);
      expect(created.user_id).toBe(userId);
      expect(created.flagged_reason).toBe(reason);
      expect(created.flagged_by).toBe(flaggedBy);
      expect(created.manual_flag).toBe(1);

      // Now flagged
      expect(isAlreadyFlagged(guildId, userId)).toBe(true);

      // Retrieve flag - data should match what we inserted
      const retrieved = getExistingFlag(guildId, userId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.flagged_reason).toBe(reason);
      expect(retrieved?.flagged_by).toBe(flaggedBy);
      expect(retrieved?.manual_flag).toBe(1);
    });
  });
});
