/**
 * Pawtropolis Tech — tests/store/auditSessionStore.test.ts
 * WHAT: Unit tests for audit session storage layer.
 * WHY: Verify session tracking, progress updates, and resume functionality.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock functions that will be shared across all prepared statements
const mockStatementFns = {
  run: vi.fn(),
  get: vi.fn(),
  all: vi.fn(),
};

// Mock must be hoisted - use factory function that returns static object
vi.mock("../../src/db/db.js", () => {
  const statementFns = {
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
  };
  return {
    db: {
      prepare: vi.fn(() => statementFns),
      _statementFns: statementFns,
    },
  };
});

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks
import {
  createSession,
  getActiveSession,
  markUserScanned,
  getScannedUserIds,
  updateProgress,
  completeSession,
  cancelSession,
} from "../../src/store/auditSessionStore.js";
import { logger } from "../../src/lib/logger.js";
import { db } from "../../src/db/db.js";

// Get references to the mock functions
const mockFns = (db as unknown as { _statementFns: typeof mockStatementFns })._statementFns;

describe("auditSessionStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFns.run.mockReturnValue({ lastInsertRowid: 1, changes: 1 });
    mockFns.get.mockReturnValue(undefined);
    mockFns.all.mockReturnValue([]);
  });

  describe("createSession", () => {
    it("creates session and returns session ID", () => {
      mockFns.run.mockReturnValue({ lastInsertRowid: 42, changes: 1 });

      const result = createSession({
        guildId: "guild-123",
        auditType: "nsfw",
        scope: "all",
        startedBy: "mod-456",
        totalToScan: 100,
        channelId: "channel-789",
      });

      expect(result).toBe(42);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "guild-123",
          auditType: "nsfw",
          sessionId: 42,
        }),
        expect.any(String)
      );
    });

    it("handles members audit type", () => {
      mockFns.run.mockReturnValue({ lastInsertRowid: 1, changes: 1 });

      createSession({
        guildId: "guild-123",
        auditType: "members",
        scope: null,
        startedBy: "mod-456",
        totalToScan: 50,
        channelId: "channel-789",
      });

      expect(mockFns.run).toHaveBeenCalled();
    });

    it("throws and logs error on database failure", () => {
      const dbError = new Error("Database locked");
      mockFns.run.mockImplementation(() => {
        throw dbError;
      });

      expect(() =>
        createSession({
          guildId: "guild-123",
          auditType: "nsfw",
          scope: null,
          startedBy: "mod-456",
          totalToScan: 10,
          channelId: "channel-789",
        })
      ).toThrow("Database locked");

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: dbError }),
        expect.stringContaining("Failed to create session")
      );
    });
  });

  describe("getActiveSession", () => {
    it("returns session when found", () => {
      const mockSession = {
        id: 1,
        guild_id: "guild-123",
        audit_type: "nsfw",
        scope: "all",
        status: "in_progress",
        started_by: "mod-456",
        started_at: "2024-01-01T00:00:00.000Z",
        completed_at: null,
        total_to_scan: 100,
        scanned_count: 50,
        flagged_count: 5,
        api_calls: 50,
        channel_id: "channel-789",
      };
      mockFns.get.mockReturnValue(mockSession);

      const result = getActiveSession("guild-123", "nsfw");

      expect(result).toEqual(mockSession);
    });

    it("returns null when no active session", () => {
      mockFns.get.mockReturnValue(undefined);

      const result = getActiveSession("guild-123", "nsfw");

      expect(result).toBeNull();
    });

    it("returns null and logs error on database failure", () => {
      mockFns.get.mockImplementation(() => {
        throw new Error("Query failed");
      });

      const result = getActiveSession("guild-123", "nsfw");

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ guildId: "guild-123" }),
        expect.stringContaining("Failed to get active session")
      );
    });

    it("handles members audit type", () => {
      mockFns.get.mockReturnValue(undefined);

      getActiveSession("guild-123", "members");

      expect(mockFns.get).toHaveBeenCalled();
    });
  });

  describe("markUserScanned", () => {
    it("records user as scanned", () => {
      markUserScanned(42, "user-123");

      expect(mockFns.run).toHaveBeenCalled();
    });

    it("swallows errors gracefully", () => {
      mockFns.run.mockImplementation(() => {
        throw new Error("Constraint violation");
      });

      expect(() => markUserScanned(42, "user-123")).not.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getScannedUserIds", () => {
    it("returns Set of user IDs", () => {
      mockFns.all.mockReturnValue([
        { user_id: "user-1" },
        { user_id: "user-2" },
        { user_id: "user-3" },
      ]);

      const result = getScannedUserIds(42);

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(3);
      expect(result.has("user-1")).toBe(true);
      expect(result.has("user-2")).toBe(true);
      expect(result.has("user-3")).toBe(true);
    });

    it("returns empty Set when no users scanned", () => {
      mockFns.all.mockReturnValue([]);

      const result = getScannedUserIds(42);

      expect(result.size).toBe(0);
    });

    it("returns empty Set on database error", () => {
      mockFns.all.mockImplementation(() => {
        throw new Error("Query failed");
      });

      const result = getScannedUserIds(42);

      expect(result.size).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("updateProgress", () => {
    it("updates progress counters", () => {
      updateProgress(42, 50, 5, 50);

      expect(mockFns.run).toHaveBeenCalled();
    });

    it("swallows errors gracefully", () => {
      mockFns.run.mockImplementation(() => {
        throw new Error("Update failed");
      });

      expect(() => updateProgress(42, 50, 5, 50)).not.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("completeSession", () => {
    it("marks session as completed", () => {
      completeSession(42);

      expect(mockFns.run).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        { sessionId: 42 },
        expect.stringContaining("Completed audit session")
      );
    });

    it("swallows errors gracefully", () => {
      mockFns.run.mockImplementation(() => {
        throw new Error("Update failed");
      });

      expect(() => completeSession(42)).not.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("cancelSession", () => {
    it("marks session as cancelled", () => {
      cancelSession(42);

      expect(mockFns.run).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        { sessionId: 42 },
        expect.stringContaining("Cancelled audit session")
      );
    });

    it("swallows errors gracefully", () => {
      mockFns.run.mockImplementation(() => {
        throw new Error("Update failed");
      });

      expect(() => cancelSession(42)).not.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
