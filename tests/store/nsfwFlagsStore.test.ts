/**
 * Pawtropolis Tech — tests/store/nsfwFlagsStore.test.ts
 * WHAT: Unit tests for NSFW flag store operations.
 * WHY: Verify NSFW avatar flagging functionality.
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

// Mock the database
const mockRun = vi.fn();

vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: vi.fn(() => ({
      run: mockRun,
    })),
  },
}));

describe("nsfwFlagsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("NsfwFlagRow interface", () => {
    it("exports the interface type", async () => {
      // Just verify the module imports correctly with the interface
      const mod = await import("../../src/store/nsfwFlagsStore.js");
      expect(mod).toBeDefined();
    });
  });

  describe("upsertNsfwFlag", () => {
    it("inserts NSFW flag with all parameters", async () => {
      mockRun.mockReturnValue({ changes: 1 });

      const { upsertNsfwFlag } = await import("../../src/store/nsfwFlagsStore.js");
      const { logger } = await import("../../src/lib/logger.js");

      upsertNsfwFlag({
        guildId: "guild-123",
        userId: "user-456",
        avatarUrl: "https://cdn.discord.com/avatars/user-456/abc123.png",
        nsfwScore: 85,
        reason: "Adult content detected",
        flaggedBy: "audit-bot",
      });

      expect(mockRun).toHaveBeenCalledWith(
        "guild-123",
        "user-456",
        "https://cdn.discord.com/avatars/user-456/abc123.png",
        85,
        "Adult content detected",
        "audit-bot"
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "guild-123",
          userId: "user-456",
          nsfwScore: 85,
        }),
        expect.stringContaining("Upserted NSFW flag")
      );
    });

    it("handles high nsfw scores (80+)", async () => {
      mockRun.mockReturnValue({ changes: 1 });

      const { upsertNsfwFlag } = await import("../../src/store/nsfwFlagsStore.js");

      upsertNsfwFlag({
        guildId: "guild-123",
        userId: "user-456",
        avatarUrl: "https://example.com/avatar.png",
        nsfwScore: 95,
        reason: "Explicit content",
        flaggedBy: "nsfw-monitor",
      });

      expect(mockRun).toHaveBeenCalledWith(
        "guild-123",
        "user-456",
        "https://example.com/avatar.png",
        95,
        "Explicit content",
        "nsfw-monitor"
      );
    });

    it("handles borderline nsfw scores", async () => {
      mockRun.mockReturnValue({ changes: 1 });

      const { upsertNsfwFlag } = await import("../../src/store/nsfwFlagsStore.js");

      upsertNsfwFlag({
        guildId: "guild-123",
        userId: "user-456",
        avatarUrl: "https://example.com/avatar.png",
        nsfwScore: 80,
        reason: "Suggestive content",
        flaggedBy: "nsfw-monitor",
      });

      expect(mockRun).toHaveBeenCalledWith(
        "guild-123",
        "user-456",
        expect.any(String),
        80,
        "Suggestive content",
        "nsfw-monitor"
      );
    });

    it("throws and logs on database error", async () => {
      mockRun.mockImplementation(() => {
        throw new Error("Database insert failed");
      });

      const { upsertNsfwFlag } = await import("../../src/store/nsfwFlagsStore.js");
      const { logger } = await import("../../src/lib/logger.js");

      expect(() =>
        upsertNsfwFlag({
          guildId: "guild-123",
          userId: "user-456",
          avatarUrl: "https://example.com/avatar.png",
          nsfwScore: 90,
          reason: "Test",
          flaggedBy: "test",
        })
      ).toThrow("Database insert failed");

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "guild-123",
          userId: "user-456",
        }),
        expect.stringContaining("Failed to upsert NSFW flag")
      );
    });

    it("handles empty reason string", async () => {
      mockRun.mockReturnValue({ changes: 1 });

      const { upsertNsfwFlag } = await import("../../src/store/nsfwFlagsStore.js");

      upsertNsfwFlag({
        guildId: "guild-123",
        userId: "user-456",
        avatarUrl: "https://example.com/avatar.png",
        nsfwScore: 85,
        reason: "",
        flaggedBy: "audit-bot",
      });

      expect(mockRun).toHaveBeenCalledWith(
        "guild-123",
        "user-456",
        "https://example.com/avatar.png",
        85,
        "",
        "audit-bot"
      );
    });

    it("updates existing flag (upsert behavior)", async () => {
      // Mock for both insert and update (ON CONFLICT behavior)
      mockRun.mockReturnValue({ changes: 1 });

      const { upsertNsfwFlag } = await import("../../src/store/nsfwFlagsStore.js");

      // First flag
      upsertNsfwFlag({
        guildId: "guild-123",
        userId: "user-456",
        avatarUrl: "https://example.com/old-avatar.png",
        nsfwScore: 80,
        reason: "First flag",
        flaggedBy: "audit-bot",
      });

      // Second flag for same user (should update)
      upsertNsfwFlag({
        guildId: "guild-123",
        userId: "user-456",
        avatarUrl: "https://example.com/new-avatar.png",
        nsfwScore: 90,
        reason: "New violation",
        flaggedBy: "audit-bot",
      });

      // Both calls should succeed
      expect(mockRun).toHaveBeenCalledTimes(2);
    });
  });
});
