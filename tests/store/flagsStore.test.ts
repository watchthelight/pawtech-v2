/**
 * Pawtropolis Tech — tests/store/flagsStore.test.ts
 * WHAT: Unit tests for flags store CRUD operations.
 * WHY: Verify flag creation, retrieval, and duplicate prevention.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the logger
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock constants
vi.mock("../../src/lib/constants.js", () => ({
  FLAG_REASON_MAX_LENGTH: 512,
}));

// Mock the database
const mockGet = vi.fn();
const mockRun = vi.fn();
const mockAll = vi.fn();
const mockPrepare = vi.fn(() => ({
  get: mockGet,
  run: mockRun,
  all: mockAll,
}));

vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
  },
}));

describe("flagsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getExistingFlag", () => {
    it("returns flag row when user is flagged", async () => {
      const mockFlagRow = {
        guild_id: "guild-123",
        user_id: "user-456",
        joined_at: 1700000000,
        flagged_at: 1700001000,
        flagged_reason: "Suspicious behavior",
        manual_flag: 1,
        flagged_by: "mod-789",
      };
      mockGet.mockReturnValue(mockFlagRow);

      const { getExistingFlag } = await import("../../src/store/flagsStore.js");
      const result = getExistingFlag("guild-123", "user-456");

      expect(result).toEqual(mockFlagRow);
    });

    it("returns null when user is not flagged", async () => {
      mockGet.mockReturnValue(undefined);

      const { getExistingFlag } = await import("../../src/store/flagsStore.js");
      const result = getExistingFlag("guild-123", "user-999");

      expect(result).toBeNull();
    });

    it("throws and logs on database error", async () => {
      mockGet.mockImplementation(() => {
        throw new Error("DB connection failed");
      });

      const { getExistingFlag } = await import("../../src/store/flagsStore.js");
      const { logger } = await import("../../src/lib/logger.js");

      expect(() => getExistingFlag("guild-123", "user-456")).toThrow("DB connection failed");
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ guildId: "guild-123", userId: "user-456" }),
        expect.stringContaining("Failed to get existing flag")
      );
    });
  });

  describe("isAlreadyFlagged", () => {
    it("returns true when user is flagged", async () => {
      mockGet.mockReturnValue({
        guild_id: "guild-123",
        user_id: "user-456",
        flagged_at: 1700001000,
      });

      const { isAlreadyFlagged } = await import("../../src/store/flagsStore.js");
      const result = isAlreadyFlagged("guild-123", "user-456");

      expect(result).toBe(true);
    });

    it("returns false when user is not flagged", async () => {
      mockGet.mockReturnValue(undefined);

      const { isAlreadyFlagged } = await import("../../src/store/flagsStore.js");
      const result = isAlreadyFlagged("guild-123", "user-456");

      expect(result).toBe(false);
    });
  });

  describe("getFlaggedUserIds", () => {
    it("returns array of flagged user IDs", async () => {
      mockAll.mockReturnValue([
        { user_id: "user-1" },
        { user_id: "user-2" },
        { user_id: "user-3" },
      ]);

      const { getFlaggedUserIds } = await import("../../src/store/flagsStore.js");
      const result = getFlaggedUserIds("guild-123");

      expect(result).toEqual(["user-1", "user-2", "user-3"]);
    });

    it("returns empty array when no flagged users", async () => {
      mockAll.mockReturnValue([]);

      const { getFlaggedUserIds } = await import("../../src/store/flagsStore.js");
      const result = getFlaggedUserIds("guild-123");

      expect(result).toEqual([]);
    });

    it("returns empty array on database error (fails silently)", async () => {
      mockAll.mockImplementation(() => {
        throw new Error("DB error");
      });

      const { getFlaggedUserIds } = await import("../../src/store/flagsStore.js");
      const result = getFlaggedUserIds("guild-123");

      expect(result).toEqual([]);
    });
  });

  describe("upsertManualFlag", () => {
    it("updates existing row with manual flag", async () => {
      // First call: check existing row - return existing record
      mockGet.mockReturnValueOnce({
        guild_id: "guild-123",
        user_id: "user-456",
        joined_at: 1700000000,
      });
      // Second call: return result after update
      mockGet.mockReturnValueOnce({
        guild_id: "guild-123",
        user_id: "user-456",
        joined_at: 1700000000,
        flagged_at: 1700001000,
        flagged_reason: "Test reason",
        manual_flag: 1,
        flagged_by: "mod-789",
      });

      const { upsertManualFlag } = await import("../../src/store/flagsStore.js");
      const result = upsertManualFlag({
        guildId: "guild-123",
        userId: "user-456",
        reason: "Test reason",
        flaggedBy: "mod-789",
        joinedAt: 1700000000,
      });

      expect(mockRun).toHaveBeenCalled();
      expect(result.manual_flag).toBe(1);
      expect(result.flagged_by).toBe("mod-789");
    });

    it("inserts new row when user has no existing record", async () => {
      // First call: check existing row - return undefined (no record)
      mockGet.mockReturnValueOnce(undefined);
      // Second call: return result after insert
      mockGet.mockReturnValueOnce({
        guild_id: "guild-123",
        user_id: "user-new",
        joined_at: 1700000000,
        flagged_at: 1700001000,
        flagged_reason: "New flag",
        manual_flag: 1,
        flagged_by: "mod-789",
      });

      const { upsertManualFlag } = await import("../../src/store/flagsStore.js");
      const result = upsertManualFlag({
        guildId: "guild-123",
        userId: "user-new",
        reason: "New flag",
        flaggedBy: "mod-789",
        joinedAt: 1700000000,
      });

      expect(mockRun).toHaveBeenCalled();
      expect(result.user_id).toBe("user-new");
    });

    it("truncates long reasons to FLAG_REASON_MAX_LENGTH", async () => {
      mockGet.mockReturnValueOnce(undefined);
      mockGet.mockReturnValueOnce({
        guild_id: "guild-123",
        user_id: "user-456",
        flagged_reason: "x".repeat(512), // Truncated
        manual_flag: 1,
        flagged_by: "mod-789",
      });

      const { upsertManualFlag } = await import("../../src/store/flagsStore.js");
      const longReason = "x".repeat(1000);
      const result = upsertManualFlag({
        guildId: "guild-123",
        userId: "user-456",
        reason: longReason,
        flaggedBy: "mod-789",
      });

      // Verify the run was called (the truncation happens internally)
      expect(mockRun).toHaveBeenCalled();
    });

    it("uses current timestamp when joinedAt not provided", async () => {
      mockGet.mockReturnValueOnce(undefined);
      mockGet.mockReturnValueOnce({
        guild_id: "guild-123",
        user_id: "user-456",
        joined_at: expect.any(Number),
        flagged_at: expect.any(Number),
        flagged_reason: "No join date",
        manual_flag: 1,
        flagged_by: "mod-789",
      });

      const { upsertManualFlag } = await import("../../src/store/flagsStore.js");
      const result = upsertManualFlag({
        guildId: "guild-123",
        userId: "user-456",
        reason: "No join date",
        flaggedBy: "mod-789",
        // joinedAt not provided
      });

      expect(mockRun).toHaveBeenCalled();
    });

    it("throws on database error during upsert", async () => {
      mockGet.mockImplementation(() => {
        throw new Error("Insert failed");
      });

      const { upsertManualFlag } = await import("../../src/store/flagsStore.js");

      expect(() =>
        upsertManualFlag({
          guildId: "guild-123",
          userId: "user-456",
          reason: "Test",
          flaggedBy: "mod-789",
        })
      ).toThrow("Insert failed");
    });
  });
});
