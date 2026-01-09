/**
 * Pawtropolis Tech — tests/features/botDetection.test.ts
 * WHAT: Unit tests for bot detection heuristics.
 * WHY: Verify scoring, pattern matching, and entropy calculation.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  calculateUsernameEntropy,
  matchesBotPattern,
  hasLevelRole,
  checkActivityLevel,
  analyzeMember,
  renderProgressBar,
  createEmptyStats,
  updateStats,
  DETECTION_CONFIG,
  SCORING,
  MAX_SCORE,
} from "../../src/features/botDetection.js";
import { createMockMember, createMockUser, createMockRole } from "../utils/discordMocks.js";
import type { GuildMember, Role } from "discord.js";

// Mock the logger
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the database
vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: vi.fn(() => ({
      get: vi.fn(() => undefined),
    })),
  },
}));

describe("botDetection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("calculateUsernameEntropy", () => {
    it("returns 0 for empty string", () => {
      expect(calculateUsernameEntropy("")).toBe(0);
    });

    it("returns 0 for null/undefined-like input", () => {
      expect(calculateUsernameEntropy("")).toBe(0);
    });

    it("returns low entropy for simple names", () => {
      // "john" has only 4 unique characters, low entropy
      const entropy = calculateUsernameEntropy("john");
      expect(entropy).toBeLessThan(DETECTION_CONFIG.ENTROPY_THRESHOLD);
    });

    it("returns low entropy for repeated characters", () => {
      const entropy = calculateUsernameEntropy("aaaaaa");
      expect(entropy).toBe(0); // All same characters = 0 entropy
    });

    it("returns high entropy for random strings", () => {
      // "xK9mQ2vL" has many unique chars and no pattern
      const entropy = calculateUsernameEntropy("xK9mQ2vL");
      expect(entropy).toBeGreaterThan(2.5); // High entropy
    });

    it("returns higher entropy for longer random strings", () => {
      const short = calculateUsernameEntropy("abc");
      const long = calculateUsernameEntropy("abcdefghij");
      // Longer string with more unique chars should have higher potential entropy
      expect(long).toBeGreaterThanOrEqual(short);
    });
  });

  describe("matchesBotPattern", () => {
    it("matches default Discord format (username_1234)", () => {
      const result = matchesBotPattern("username_1234");
      expect(result.match).toBe(true);
      expect(result.pattern).toBe("default Discord format");
    });

    it("matches default Discord format (User12345)", () => {
      const result = matchesBotPattern("User12345");
      expect(result.match).toBe(true);
      expect(result.pattern).toBe("default Discord format");
    });

    it("matches sequential numbers at end (5+ digits)", () => {
      // Note: "cooluser12345" matches default Discord format first
      // Use a name that doesn't match the default pattern
      const result = matchesBotPattern("cool-user12345");
      expect(result.match).toBe(true);
      expect(result.pattern).toBe("sequential numbers");
    });

    it("does not match normal usernames", () => {
      const result = matchesBotPattern("FurryArtist");
      expect(result.match).toBe(false);
      expect(result.pattern).toBeNull();
    });

    it("does not match short numbers", () => {
      // 4 digits is acceptable (common in Discord usernames like name#1234)
      const result = matchesBotPattern("user123");
      expect(result.match).toBe(false);
    });

    it("matches high entropy random strings", () => {
      // 8+ chars, mixed case and numbers, high entropy
      // The string must have entropy > 3.5 AND (numbers OR mixed case) AND length >= 8
      const entropy = calculateUsernameEntropy("aB3cD4eF5gH6");
      expect(entropy).toBeGreaterThan(DETECTION_CONFIG.ENTROPY_THRESHOLD);

      const result = matchesBotPattern("aB3cD4eF5gH6");
      expect(result.match).toBe(true);
      expect(result.pattern).toBe("high entropy random string");
    });

    it("does not match legitimate mixed-case names", () => {
      // "DragonSlayer" is mixed case but not random
      const result = matchesBotPattern("DragonSlayer");
      expect(result.match).toBe(false);
    });
  });

  describe("hasLevelRole", () => {
    it("returns true when member has level role >= minLevel", () => {
      const levelRole = createMockRole({ id: "role-1", name: "Level 10" });
      const member = createMockMember({}) as GuildMember;
      member.roles.cache.set("role-1", levelRole as Role);

      expect(hasLevelRole(member, 5)).toBe(true);
    });

    it("returns false when member has level role < minLevel", () => {
      const levelRole = createMockRole({ id: "role-1", name: "Level 3" });
      const member = createMockMember({}) as GuildMember;
      member.roles.cache.set("role-1", levelRole as Role);

      expect(hasLevelRole(member, 5)).toBe(false);
    });

    it("returns false when member has no level roles", () => {
      const otherRole = createMockRole({ id: "role-1", name: "Member" });
      const member = createMockMember({}) as GuildMember;
      member.roles.cache.set("role-1", otherRole as Role);

      expect(hasLevelRole(member)).toBe(false);
    });

    it("uses default minLevel from config", () => {
      const levelRole = createMockRole({ id: "role-1", name: `Level ${DETECTION_CONFIG.MIN_LEVEL}` });
      const member = createMockMember({}) as GuildMember;
      member.roles.cache.set("role-1", levelRole as Role);

      expect(hasLevelRole(member)).toBe(true);
    });

    it("matches case-insensitive level format", () => {
      const levelRole = createMockRole({ id: "role-1", name: "LEVEL 15" });
      const member = createMockMember({}) as GuildMember;
      member.roles.cache.set("role-1", levelRole as Role);

      expect(hasLevelRole(member, 10)).toBe(true);
    });
  });

  describe("checkActivityLevel", () => {
    it("returns no activity when user has no records", async () => {
      const { db } = await import("../../src/db/db.js");
      (db.prepare as any).mockReturnValue({
        get: vi.fn(() => undefined),
      });

      const result = checkActivityLevel("guild-123", "user-456");

      expect(result.hasActivity).toBe(false);
      expect(result.firstMessageAt).toBeNull();
      expect(result.messageCount).toBe(0);
    });

    it("returns activity when user has messages", async () => {
      const { db } = await import("../../src/db/db.js");
      (db.prepare as any)
        .mockReturnValueOnce({ get: vi.fn(() => ({ first_message_at: 1700000000 })) })
        .mockReturnValueOnce({ get: vi.fn(() => ({ count: 25 })) });

      const result = checkActivityLevel("guild-123", "user-456");

      expect(result.hasActivity).toBe(true);
      expect(result.firstMessageAt).toBe(1700000000);
      expect(result.messageCount).toBe(25);
    });

    it("handles database errors gracefully", async () => {
      const { db } = await import("../../src/db/db.js");
      (db.prepare as any).mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = checkActivityLevel("guild-123", "user-456");

      // Defaults to having activity to avoid false positives
      expect(result.hasActivity).toBe(true);
      expect(result.messageCount).toBe(0);
    });
  });

  describe("analyzeMember", () => {
    it("returns low score for legitimate user", async () => {
      const { db } = await import("../../src/db/db.js");
      // User has activity
      (db.prepare as any)
        .mockReturnValueOnce({ get: vi.fn(() => ({ first_message_at: 1700000000 })) })
        .mockReturnValueOnce({ get: vi.fn(() => ({ count: 50 })) });

      const user = createMockUser({
        id: "user-123",
        username: "NormalUser",
        avatar: "abc123", // Has avatar
        createdTimestamp: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days old
      });

      const levelRole = createMockRole({ id: "role-1", name: "Level 10" });
      const member = createMockMember({ user } as any) as GuildMember;
      member.roles.cache.set("role-1", levelRole as Role);

      const result = analyzeMember(member, "guild-123");

      expect(result.score).toBeLessThan(DETECTION_CONFIG.FLAG_THRESHOLD);
      expect(result.shouldFlag).toBe(false);
    });

    it("adds score for no avatar", () => {
      const user = createMockUser({
        id: "user-123",
        username: "TestUser",
        avatar: null as any, // No avatar
        createdTimestamp: Date.now() - 30 * 24 * 60 * 60 * 1000,
      });

      const levelRole = createMockRole({ id: "role-1", name: "Level 10" });
      const member = createMockMember({ user } as any) as GuildMember;
      member.roles.cache.set("role-1", levelRole as Role);

      const result = analyzeMember(member, "guild-123");

      expect(result.reasons).toContain("No avatar (default profile)");
      expect(result.score).toBeGreaterThanOrEqual(SCORING.NO_AVATAR);
    });

    it("adds score for new account", () => {
      const user = createMockUser({
        id: "user-123",
        username: "NewUser",
        avatar: "abc",
        createdTimestamp: Date.now() - 2 * 24 * 60 * 60 * 1000, // 2 days old
      });

      const levelRole = createMockRole({ id: "role-1", name: "Level 10" });
      const member = createMockMember({ user } as any) as GuildMember;
      member.roles.cache.set("role-1", levelRole as Role);

      const result = analyzeMember(member, "guild-123");

      expect(result.reasons.some(r => r.includes("days old"))).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(SCORING.NEW_ACCOUNT);
    });

    it("adds score for bot-like username", () => {
      const user = createMockUser({
        id: "user-123",
        username: "user_12345",
        avatar: "abc",
        createdTimestamp: Date.now() - 30 * 24 * 60 * 60 * 1000,
      });

      const levelRole = createMockRole({ id: "role-1", name: "Level 10" });
      const member = createMockMember({ user } as any) as GuildMember;
      member.roles.cache.set("role-1", levelRole as Role);

      const result = analyzeMember(member, "guild-123");

      expect(result.reasons.some(r => r.includes("Suspicious username"))).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(SCORING.BOT_USERNAME);
    });

    it("flags member when score exceeds threshold", async () => {
      const { db } = await import("../../src/db/db.js");
      // No activity
      (db.prepare as any)
        .mockReturnValueOnce({ get: vi.fn(() => undefined) })
        .mockReturnValueOnce({ get: vi.fn(() => ({ count: 0 })) });

      const user = createMockUser({
        id: "user-123",
        username: "user_12345", // Bot pattern
        avatar: null as any, // No avatar
        createdTimestamp: Date.now() - 1 * 24 * 60 * 60 * 1000, // 1 day old
      });

      const member = createMockMember({ user } as any) as GuildMember;

      const result = analyzeMember(member, "guild-123");

      expect(result.score).toBeGreaterThanOrEqual(DETECTION_CONFIG.FLAG_THRESHOLD);
      expect(result.shouldFlag).toBe(true);
    });
  });

  describe("renderProgressBar", () => {
    it("renders empty bar for 0/0", () => {
      const bar = renderProgressBar(0, 0);
      expect(bar).toContain("0/0");
      expect(bar).toContain("0%");
    });

    it("renders full bar for complete progress", () => {
      const bar = renderProgressBar(100, 100);
      expect(bar).toContain("100%");
      expect(bar).toContain("▓");
    });

    it("renders partial bar for partial progress", () => {
      const bar = renderProgressBar(50, 100);
      expect(bar).toContain("50%");
      expect(bar).toContain("▓");
      expect(bar).toContain("░");
    });

    it("respects custom width", () => {
      const bar = renderProgressBar(50, 100, 10);
      // Half filled at width 10 should have 5 filled chars
      expect(bar.match(/▓/g)?.length).toBe(5);
      expect(bar.match(/░/g)?.length).toBe(5);
    });
  });

  describe("createEmptyStats", () => {
    it("creates stats with all zeros", () => {
      const stats = createEmptyStats();
      expect(stats.noAvatar).toBe(0);
      expect(stats.newAccount).toBe(0);
      expect(stats.noActivity).toBe(0);
      expect(stats.lowLevel).toBe(0);
      expect(stats.botUsername).toBe(0);
    });
  });

  describe("updateStats", () => {
    it("increments noAvatar counter", () => {
      const stats = createEmptyStats();
      updateStats(stats, ["No avatar (default profile)"]);
      expect(stats.noAvatar).toBe(1);
    });

    it("increments newAccount counter", () => {
      const stats = createEmptyStats();
      updateStats(stats, ["Account 3 days old"]);
      expect(stats.newAccount).toBe(1);
    });

    it("increments noActivity counter", () => {
      const stats = createEmptyStats();
      updateStats(stats, ["No recorded message activity"]);
      expect(stats.noActivity).toBe(1);
    });

    it("increments lowLevel counter", () => {
      const stats = createEmptyStats();
      updateStats(stats, ["Below Level 5 (no engagement)"]);
      expect(stats.lowLevel).toBe(1);
    });

    it("increments botUsername counter", () => {
      const stats = createEmptyStats();
      updateStats(stats, ["Suspicious username: default Discord format"]);
      expect(stats.botUsername).toBe(1);
    });

    it("handles multiple reasons at once", () => {
      const stats = createEmptyStats();
      updateStats(stats, [
        "No avatar (default profile)",
        "Account 2 days old",
        "Suspicious username: high entropy",
      ]);
      expect(stats.noAvatar).toBe(1);
      expect(stats.newAccount).toBe(1);
      expect(stats.botUsername).toBe(1);
    });
  });

  describe("constants", () => {
    it("MAX_SCORE equals sum of all scoring weights", () => {
      const expectedMax = Object.values(SCORING).reduce((a, b) => a + b, 0);
      expect(MAX_SCORE).toBe(expectedMax);
    });

    it("FLAG_THRESHOLD is reasonable", () => {
      expect(DETECTION_CONFIG.FLAG_THRESHOLD).toBeGreaterThan(0);
      expect(DETECTION_CONFIG.FLAG_THRESHOLD).toBeLessThan(MAX_SCORE);
    });
  });
});
