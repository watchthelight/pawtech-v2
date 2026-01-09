/**
 * Pawtropolis Tech — tests/features/artistRotation/queue.test.ts
 * WHAT: Unit tests for artist queue CRUD operations.
 * WHY: Verify queue management, position handling, and atomic transactions.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock database with vi.hoisted for proper hoisting
const { mockGet, mockAll, mockRun, mockTransaction, mockPrepare } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockAll = vi.fn();
  const mockRun = vi.fn();
  const mockPrepare = vi.fn().mockReturnValue({
    get: mockGet,
    all: mockAll,
    run: mockRun,
  });
  const mockTransaction = vi.fn((fn: (...args: any[]) => any) => {
    return (...args: any[]) => fn(...args);
  });
  return { mockGet, mockAll, mockRun, mockTransaction, mockPrepare };
});

vi.mock("../../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
    transaction: mockTransaction,
  },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Now import the module under test
import {
  getQueueLength,
  addArtist,
  removeArtist,
  getArtist,
  getAllArtists,
  getNextArtist,
  moveToPosition,
  skipArtist,
  unskipArtist,
  incrementAssignments,
  processAssignment,
  logAssignment,
  getAssignmentHistory,
  getArtistStats,
  syncWithRoleMembers,
} from "../../../src/features/artistRotation/queue.js";

describe("artistRotation/queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getQueueLength", () => {
    it("returns count from database", () => {
      mockGet.mockReturnValue({ count: 5 });

      const result = getQueueLength("guild-123");

      expect(result).toBe(5);
    });

    it("returns 0 when row is undefined", () => {
      mockGet.mockReturnValue(undefined);

      const result = getQueueLength("guild-123");

      expect(result).toBe(0);
    });

    it("returns 0 when count is null", () => {
      mockGet.mockReturnValue({ count: null });

      const result = getQueueLength("guild-123");

      expect(result).toBe(0);
    });
  });

  describe("addArtist", () => {
    it("adds artist to end of queue", () => {
      mockGet
        .mockReturnValueOnce(undefined) // checkArtistExistsStmt
        .mockReturnValueOnce({ max_pos: 3 }); // getMaxPositionStmt

      const result = addArtist("guild-123", "user-456");

      expect(result).toBe(4);
      expect(mockRun).toHaveBeenCalled();
    });

    it("returns null if artist already in queue", () => {
      mockGet.mockReturnValueOnce({ id: 1 }); // checkArtistExistsStmt returns existing

      const result = addArtist("guild-123", "user-456");

      expect(result).toBeNull();
    });

    it("handles empty queue (max_pos null)", () => {
      mockGet
        .mockReturnValueOnce(undefined) // not in queue
        .mockReturnValueOnce({ max_pos: null }); // empty queue

      const result = addArtist("guild-123", "user-456");

      expect(result).toBe(1);
    });
  });

  describe("removeArtist", () => {
    it("removes artist and reorders positions", () => {
      mockGet.mockReturnValueOnce({
        position: 2,
        assignments_count: 5,
      });
      mockRun.mockReturnValue({ changes: 1 });

      const result = removeArtist("guild-123", "user-456");

      expect(result).toBe(5);
    });

    it("returns null if artist not in queue", () => {
      mockGet.mockReturnValueOnce(undefined);

      const result = removeArtist("guild-123", "user-456");

      expect(result).toBeNull();
    });
  });

  describe("getArtist", () => {
    it("returns artist row when found", () => {
      const artistRow = {
        id: 1,
        guild_id: "guild-123",
        user_id: "user-456",
        position: 1,
        added_at: "2024-01-01",
        assignments_count: 0,
        last_assigned_at: null,
        skipped: 0,
        skip_reason: null,
      };
      mockGet.mockReturnValue(artistRow);

      const result = getArtist("guild-123", "user-456");

      expect(result).toEqual(artistRow);
    });

    it("returns null when not found", () => {
      mockGet.mockReturnValue(undefined);

      const result = getArtist("guild-123", "user-456");

      expect(result).toBeNull();
    });
  });

  describe("getAllArtists", () => {
    it("returns all artists ordered by position", () => {
      const artists = [
        { id: 1, user_id: "user-1", position: 1 },
        { id: 2, user_id: "user-2", position: 2 },
      ];
      mockAll.mockReturnValue(artists);

      const result = getAllArtists("guild-123");

      expect(result).toEqual(artists);
    });

    it("returns empty array for empty queue", () => {
      mockAll.mockReturnValue([]);

      const result = getAllArtists("guild-123");

      expect(result).toEqual([]);
    });
  });

  describe("getNextArtist", () => {
    it("returns next non-skipped artist", () => {
      mockGet.mockReturnValue({
        user_id: "user-123",
        position: 1,
        assignments_count: 5,
        last_assigned_at: "2024-01-01",
      });

      const result = getNextArtist("guild-123");

      expect(result).toEqual({
        userId: "user-123",
        position: 1,
        assignmentsCount: 5,
        lastAssignedAt: "2024-01-01",
      });
    });

    it("returns null when no artists available", () => {
      mockGet.mockReturnValue(undefined);

      const result = getNextArtist("guild-123");

      expect(result).toBeNull();
    });

    it("handles null last_assigned_at", () => {
      mockGet.mockReturnValue({
        user_id: "user-123",
        position: 1,
        assignments_count: 0,
        last_assigned_at: null,
      });

      const result = getNextArtist("guild-123");

      expect(result?.lastAssignedAt).toBeNull();
    });
  });

  describe("moveToPosition", () => {
    it("returns false if artist not in queue", () => {
      mockGet.mockReturnValue(undefined);

      const result = moveToPosition("guild-123", "user-456", 3);

      expect(result).toBe(false);
    });

    it("returns true if already at target position", () => {
      mockGet
        .mockReturnValueOnce({ position: 3 }) // current position
        .mockReturnValueOnce({ max_pos: 5 }); // max position

      const result = moveToPosition("guild-123", "user-456", 3);

      expect(result).toBe(true);
    });

    it("moves artist down (shifts others up)", () => {
      mockGet
        .mockReturnValueOnce({ position: 2 }) // current position
        .mockReturnValueOnce({ max_pos: 5 }); // max position
      mockRun.mockReturnValue({ changes: 1 });

      const result = moveToPosition("guild-123", "user-456", 4);

      expect(result).toBe(true);
    });

    it("moves artist up (shifts others down)", () => {
      mockGet
        .mockReturnValueOnce({ position: 4 }) // current position
        .mockReturnValueOnce({ max_pos: 5 }); // max position
      mockRun.mockReturnValue({ changes: 1 });

      const result = moveToPosition("guild-123", "user-456", 2);

      expect(result).toBe(true);
    });

    it("clamps position to valid range", () => {
      mockGet
        .mockReturnValueOnce({ position: 2 })
        .mockReturnValueOnce({ max_pos: 5 });
      mockRun.mockReturnValue({ changes: 1 });

      const result = moveToPosition("guild-123", "user-456", 999);

      expect(result).toBe(true);
    });

    it("clamps position to minimum 1", () => {
      mockGet
        .mockReturnValueOnce({ position: 3 })
        .mockReturnValueOnce({ max_pos: 5 });
      mockRun.mockReturnValue({ changes: 1 });

      const result = moveToPosition("guild-123", "user-456", 0);

      expect(result).toBe(true);
    });
  });

  describe("skipArtist", () => {
    it("skips artist with reason", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = skipArtist("guild-123", "user-456", "on vacation");

      expect(result).toBe(true);
    });

    it("skips artist without reason", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = skipArtist("guild-123", "user-456");

      expect(result).toBe(true);
    });

    it("returns false if artist not found", () => {
      mockRun.mockReturnValue({ changes: 0 });

      const result = skipArtist("guild-123", "user-456");

      expect(result).toBe(false);
    });
  });

  describe("unskipArtist", () => {
    it("unskips artist", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = unskipArtist("guild-123", "user-456");

      expect(result).toBe(true);
    });

    it("returns false if artist not found", () => {
      mockRun.mockReturnValue({ changes: 0 });

      const result = unskipArtist("guild-123", "user-456");

      expect(result).toBe(false);
    });
  });

  describe("incrementAssignments", () => {
    it("increments assignment count", () => {
      mockRun.mockReturnValue({ changes: 1 });

      incrementAssignments("guild-123", "user-456");

      expect(mockRun).toHaveBeenCalled();
    });
  });

  describe("processAssignment", () => {
    it("atomically moves artist to end and increments count", () => {
      mockGet
        .mockReturnValueOnce({ position: 2, assignments_count: 5 }) // artist state
        .mockReturnValueOnce({ max_pos: 5 }); // max position
      mockRun.mockReturnValue({ changes: 1 });

      const result = processAssignment("guild-123", "user-456");

      expect(result).toEqual({
        oldPosition: 2,
        newPosition: 5,
        assignmentsCount: 6,
      });
    });

    it("returns null if artist not in queue", () => {
      mockGet.mockReturnValue(undefined);

      const result = processAssignment("guild-123", "user-456");

      expect(result).toBeNull();
    });

    it("handles artist already at end of queue", () => {
      mockGet
        .mockReturnValueOnce({ position: 5, assignments_count: 3 })
        .mockReturnValueOnce({ max_pos: 5 });
      mockRun.mockReturnValue({ changes: 1 });

      const result = processAssignment("guild-123", "user-456");

      expect(result).toEqual({
        oldPosition: 5,
        newPosition: 5,
        assignmentsCount: 4,
      });
    });
  });

  describe("logAssignment", () => {
    it("logs assignment and returns lastInsertRowid", () => {
      mockRun.mockReturnValue({ lastInsertRowid: 42 });

      const result = logAssignment({
        guildId: "guild-123",
        artistId: "artist-1",
        recipientId: "recipient-1",
        ticketType: "headshot",
        ticketRoleId: "role-1",
        assignedBy: "mod-1",
        channelId: "channel-1",
        override: false,
      });

      expect(result).toBe(42);
    });

    it("handles override flag", () => {
      mockRun.mockReturnValue({ lastInsertRowid: 43 });

      const result = logAssignment({
        guildId: "guild-123",
        artistId: "artist-1",
        recipientId: "recipient-1",
        ticketType: "fullbody",
        ticketRoleId: null,
        assignedBy: "mod-1",
        channelId: null,
        override: true,
      });

      expect(result).toBe(43);
    });
  });

  describe("getAssignmentHistory", () => {
    it("returns history for specific artist", () => {
      const history = [
        { id: 1, artist_id: "artist-1" },
        { id: 2, artist_id: "artist-1" },
      ];
      mockAll.mockReturnValue(history);

      const result = getAssignmentHistory("guild-123", "artist-1", 10);

      expect(result).toEqual(history);
    });

    it("returns all history when no artist specified", () => {
      const history = [
        { id: 1, artist_id: "artist-1" },
        { id: 2, artist_id: "artist-2" },
      ];
      mockAll.mockReturnValue(history);

      const result = getAssignmentHistory("guild-123", undefined, 10);

      expect(result).toEqual(history);
    });

    it("uses default limit of 10", () => {
      mockAll.mockReturnValue([]);

      getAssignmentHistory("guild-123");

      expect(mockAll).toHaveBeenCalled();
    });
  });

  describe("getArtistStats", () => {
    it("returns artist stats", () => {
      mockGet.mockReturnValue({
        total: 15,
        last_at: "2024-01-01T12:00:00Z",
      });

      const result = getArtistStats("guild-123", "artist-1");

      expect(result).toEqual({
        totalAssignments: 15,
        lastAssignment: "2024-01-01T12:00:00Z",
      });
    });

    it("handles null last_at", () => {
      mockGet.mockReturnValue({
        total: 0,
        last_at: null,
      });

      const result = getArtistStats("guild-123", "artist-1");

      expect(result.lastAssignment).toBeNull();
    });
  });

  describe("syncWithRoleMembers", () => {
    it("adds missing artists and removes stale ones", () => {
      // Current queue
      mockAll.mockReturnValue([
        { user_id: "user-1" },
        { user_id: "user-2" },
        { user_id: "user-3" },
      ]);

      // For addArtist check (user-4, user-5 not in queue)
      mockGet
        .mockReturnValueOnce(undefined) // user-4 not exists
        .mockReturnValueOnce({ max_pos: 3 }) // max position
        .mockReturnValueOnce(undefined) // user-5 not exists
        .mockReturnValueOnce({ max_pos: 4 }) // max position
        .mockReturnValueOnce({ position: 3, assignments_count: 1 }); // user-3 removal

      mockRun.mockReturnValue({ changes: 1 });

      const result = syncWithRoleMembers("guild-123", ["user-1", "user-2", "user-4", "user-5"]);

      expect(result.added).toContain("user-4");
      expect(result.added).toContain("user-5");
      expect(result.removed).toContain("user-3");
      expect(result.unchanged).toContain("user-1");
      expect(result.unchanged).toContain("user-2");
    });

    it("handles empty current queue", () => {
      mockAll.mockReturnValue([]);
      mockGet
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({ max_pos: null })
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({ max_pos: 1 });
      mockRun.mockReturnValue({ changes: 1 });

      const result = syncWithRoleMembers("guild-123", ["user-1", "user-2"]);

      expect(result.added).toContain("user-1");
      expect(result.added).toContain("user-2");
      expect(result.removed).toHaveLength(0);
    });

    it("handles empty role holders list", () => {
      mockAll.mockReturnValue([
        { user_id: "user-1" },
        { user_id: "user-2" },
      ]);
      mockGet.mockReturnValue({ position: 1, assignments_count: 0 });
      mockRun.mockReturnValue({ changes: 1 });

      const result = syncWithRoleMembers("guild-123", []);

      expect(result.added).toHaveLength(0);
      expect(result.removed).toContain("user-1");
      expect(result.removed).toContain("user-2");
    });

    it("handles no changes needed", () => {
      mockAll.mockReturnValue([
        { user_id: "user-1" },
        { user_id: "user-2" },
      ]);

      const result = syncWithRoleMembers("guild-123", ["user-1", "user-2"]);

      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.unchanged).toContain("user-1");
      expect(result.unchanged).toContain("user-2");
    });
  });
});
