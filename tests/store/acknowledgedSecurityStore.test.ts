/**
 * Pawtropolis Tech — tests/store/acknowledgedSecurityStore.test.ts
 * WHAT: Unit tests for acknowledged security issues storage.
 * WHY: Verify acknowledgment tracking, caching, and cleanup logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// All mocks need to be defined inside the factory functions due to hoisting
vi.mock("../../src/lib/lruCache.js", () => {
  const mockCacheGet = vi.fn();
  const mockCacheSet = vi.fn();
  const mockCacheDelete = vi.fn();
  return {
    LRUCache: class {
      get = mockCacheGet;
      set = mockCacheSet;
      delete = mockCacheDelete;
      static _mockFns = { get: mockCacheGet, set: mockCacheSet, delete: mockCacheDelete };
    },
  };
});

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
  acknowledgeIssue,
  getAcknowledgedIssues,
  listAcknowledgedIssues,
  unacknowledgeIssue,
  clearStaleAcknowledgments,
  clearAckCache,
} from "../../src/store/acknowledgedSecurityStore.js";
import { logger } from "../../src/lib/logger.js";
import { db } from "../../src/db/db.js";
import { LRUCache } from "../../src/lib/lruCache.js";

// Get references to the mock functions
const mockFns = (db as unknown as { _statementFns: { run: ReturnType<typeof vi.fn>, get: ReturnType<typeof vi.fn>, all: ReturnType<typeof vi.fn> } })._statementFns;
const mockCacheFns = (LRUCache as unknown as { _mockFns: { get: ReturnType<typeof vi.fn>, set: ReturnType<typeof vi.fn>, delete: ReturnType<typeof vi.fn> } })._mockFns;

describe("acknowledgedSecurityStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFns.run.mockReturnValue({ lastInsertRowid: 1, changes: 1 });
    mockFns.get.mockReturnValue(undefined);
    mockFns.all.mockReturnValue([]);
    mockCacheFns.get.mockReturnValue(undefined);
  });

  describe("acknowledgeIssue", () => {
    it("upserts acknowledgment into database", () => {
      acknowledgeIssue({
        guildId: "guild-123",
        issueKey: "role:456:admin",
        severity: "high",
        title: "Admin Role Accessible",
        permissionHash: "abc123",
        acknowledgedBy: "mod-789",
        reason: "Intentional for trusted members",
      });

      expect(mockFns.run).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "guild-123",
          issueKey: "role:456:admin",
          severity: "high",
        }),
        expect.stringContaining("Issue acknowledged")
      );
    });

    it("handles missing reason parameter", () => {
      acknowledgeIssue({
        guildId: "guild-123",
        issueKey: "channel:456:public",
        severity: "medium",
        title: "Public Channel",
        permissionHash: "def456",
        acknowledgedBy: "mod-789",
      });

      expect(mockFns.run).toHaveBeenCalled();
    });

    it("invalidates cache after acknowledgment", () => {
      acknowledgeIssue({
        guildId: "guild-123",
        issueKey: "role:456:admin",
        severity: "high",
        title: "Admin Role",
        permissionHash: "abc123",
        acknowledgedBy: "mod-789",
      });

      expect(mockCacheFns.delete).toHaveBeenCalledWith("guild-123");
    });

    it("throws and logs error on database failure", () => {
      const dbError = new Error("Constraint violation");
      mockFns.run.mockImplementation(() => {
        throw dbError;
      });

      expect(() =>
        acknowledgeIssue({
          guildId: "guild-123",
          issueKey: "role:456",
          severity: "low",
          title: "Test",
          permissionHash: "hash",
          acknowledgedBy: "mod-123",
        })
      ).toThrow("Constraint violation");

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getAcknowledgedIssues", () => {
    it("returns cached data when available", () => {
      const cachedMap = new Map([
        ["role:123", { issueKey: "role:123", severity: "high" }],
      ]);
      mockCacheFns.get.mockReturnValue(cachedMap);

      const result = getAcknowledgedIssues("guild-123");

      expect(result).toBe(cachedMap);
      expect(mockFns.all).not.toHaveBeenCalled();
    });

    it("queries database when cache miss", () => {
      mockCacheFns.get.mockReturnValue(undefined);
      mockFns.all.mockReturnValue([
        {
          id: 1,
          guild_id: "guild-123",
          issue_key: "role:456:admin",
          severity: "high",
          title: "Admin Role",
          permission_hash: "abc123",
          acknowledged_by: "mod-789",
          acknowledged_at: 1700000000,
          reason: "Intentional",
        },
      ]);

      const result = getAcknowledgedIssues("guild-123");

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(1);
      expect(result.has("role:456:admin")).toBe(true);
      expect(result.get("role:456:admin")).toEqual(
        expect.objectContaining({
          issueKey: "role:456:admin",
          severity: "high",
          acknowledgedBy: "mod-789",
        })
      );
    });

    it("caches database results", () => {
      mockCacheFns.get.mockReturnValue(undefined);
      mockFns.all.mockReturnValue([]);

      getAcknowledgedIssues("guild-123");

      expect(mockCacheFns.set).toHaveBeenCalledWith("guild-123", expect.any(Map));
    });

    it("returns empty Map on database error", () => {
      mockCacheFns.get.mockReturnValue(undefined);
      mockFns.all.mockImplementation(() => {
        throw new Error("Query failed");
      });

      const result = getAcknowledgedIssues("guild-123");

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("maps database rows to AcknowledgedIssue objects", () => {
      mockCacheFns.get.mockReturnValue(undefined);
      mockFns.all.mockReturnValue([
        {
          id: 42,
          guild_id: "guild-123",
          issue_key: "channel:789:nsfw",
          severity: "low",
          title: "NSFW Channel",
          permission_hash: "xyz789",
          acknowledged_by: "admin-111",
          acknowledged_at: 1699999999,
          reason: null,
        },
      ]);

      const result = getAcknowledgedIssues("guild-123");
      const issue = result.get("channel:789:nsfw");

      expect(issue).toEqual({
        id: 42,
        guildId: "guild-123",
        issueKey: "channel:789:nsfw",
        severity: "low",
        title: "NSFW Channel",
        permissionHash: "xyz789",
        acknowledgedBy: "admin-111",
        acknowledgedAt: 1699999999,
        reason: null,
      });
    });
  });

  describe("listAcknowledgedIssues", () => {
    it("returns array of acknowledged issues", () => {
      mockCacheFns.get.mockReturnValue(undefined);
      mockFns.all.mockReturnValue([
        {
          id: 1,
          guild_id: "guild-123",
          issue_key: "role:1",
          severity: "high",
          title: "Issue 1",
          permission_hash: "h1",
          acknowledged_by: "mod-1",
          acknowledged_at: 1700000000,
          reason: null,
        },
        {
          id: 2,
          guild_id: "guild-123",
          issue_key: "role:2",
          severity: "medium",
          title: "Issue 2",
          permission_hash: "h2",
          acknowledged_by: "mod-2",
          acknowledged_at: 1700000001,
          reason: "Test",
        },
      ]);

      const result = listAcknowledgedIssues("guild-123");

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it("returns empty array when no issues", () => {
      mockCacheFns.get.mockReturnValue(undefined);
      mockFns.all.mockReturnValue([]);

      const result = listAcknowledgedIssues("guild-123");

      expect(result).toEqual([]);
    });
  });

  describe("unacknowledgeIssue", () => {
    it("returns true when acknowledgment is deleted", () => {
      mockFns.run.mockReturnValue({ changes: 1 });

      const result = unacknowledgeIssue("guild-123", "role:456:admin");

      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "guild-123",
          issueKey: "role:456:admin",
        }),
        expect.stringContaining("Issue unacknowledged")
      );
    });

    it("returns false when no acknowledgment existed", () => {
      mockFns.run.mockReturnValue({ changes: 0 });

      const result = unacknowledgeIssue("guild-123", "nonexistent:key");

      expect(result).toBe(false);
    });

    it("invalidates cache after unacknowledgment", () => {
      mockFns.run.mockReturnValue({ changes: 1 });

      unacknowledgeIssue("guild-123", "role:456");

      expect(mockCacheFns.delete).toHaveBeenCalledWith("guild-123");
    });

    it("throws and logs error on database failure", () => {
      mockFns.run.mockImplementation(() => {
        throw new Error("Delete failed");
      });

      expect(() => unacknowledgeIssue("guild-123", "role:456")).toThrow(
        "Delete failed"
      );
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("clearStaleAcknowledgments", () => {
    it("returns number of deleted stale acknowledgments", () => {
      mockFns.run.mockReturnValue({ changes: 3 });
      const validKeys = new Set(["role:1", "role:2"]);

      const result = clearStaleAcknowledgments("guild-123", validKeys);

      expect(result).toBe(3);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ deletedCount: 3 }),
        expect.stringContaining("Cleared stale acknowledgments")
      );
    });

    it("returns 0 when no stale acknowledgments", () => {
      mockFns.run.mockReturnValue({ changes: 0 });
      const validKeys = new Set(["role:1", "role:2", "role:3"]);

      const result = clearStaleAcknowledgments("guild-123", validKeys);

      expect(result).toBe(0);
    });

    it("invalidates cache when stale acks are deleted", () => {
      mockFns.run.mockReturnValue({ changes: 2 });

      clearStaleAcknowledgments("guild-123", new Set(["role:1"]));

      expect(mockCacheFns.delete).toHaveBeenCalledWith("guild-123");
    });

    it("does not invalidate cache when no acks deleted", () => {
      mockFns.run.mockReturnValue({ changes: 0 });

      clearStaleAcknowledgments("guild-123", new Set(["role:1"]));

      expect(mockCacheFns.delete).not.toHaveBeenCalled();
    });

    it("returns 0 on database error", () => {
      mockFns.run.mockImplementation(() => {
        throw new Error("Delete failed");
      });

      const result = clearStaleAcknowledgments("guild-123", new Set());

      expect(result).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("clearAckCache", () => {
    it("clears cache for specified guild", () => {
      clearAckCache("guild-123");

      expect(mockCacheFns.delete).toHaveBeenCalledWith("guild-123");
    });
  });
});
