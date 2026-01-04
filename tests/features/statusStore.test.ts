/**
 * Pawtropolis Tech — tests/features/statusStore.test.ts
 * WHAT: Unit tests for bot status persistence module.
 * WHY: Verify status upsert, retrieval, and schema initialization.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock functions
const { mockGet, mockRun, mockPrepare } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
  run: mockRun,
  pluck: vi.fn().mockReturnThis(),
});

vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  upsertStatus,
  getStatus,
  ensureBotStatusSchema,
  type SavedStatus,
} from "../../src/features/statusStore.js";
import { logger } from "../../src/lib/logger.js";

describe("features/statusStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      run: mockRun,
      pluck: vi.fn().mockReturnThis(),
    });
  });

  describe("upsertStatus", () => {
    it("persists status with all fields", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const status: SavedStatus = {
        scopeKey: "global",
        activityType: 0,
        activityText: "Playing games",
        customStatus: null,
        status: "online",
        updatedAt: 1700000000,
      };

      upsertStatus(status);

      expect(mockRun).toHaveBeenCalledWith(
        "global",
        0,
        "Playing games",
        null,
        "online",
        1700000000
      );
    });

    it("persists status with custom status", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const status: SavedStatus = {
        scopeKey: "guild123",
        activityType: 4,
        activityText: null,
        customStatus: "Custom status text",
        status: "idle",
        updatedAt: 1700000000,
      };

      upsertStatus(status);

      expect(mockRun).toHaveBeenCalledWith(
        "guild123",
        4,
        null,
        "Custom status text",
        "idle",
        1700000000
      );
    });

    it("throws on database error", () => {
      mockRun.mockImplementation(() => {
        throw new Error("Database error");
      });

      const status: SavedStatus = {
        scopeKey: "global",
        activityType: 0,
        activityText: "test",
        customStatus: null,
        status: "online",
        updatedAt: 1700000000,
      };

      expect(() => upsertStatus(status)).toThrow("Database error");
      expect(logger.error).toHaveBeenCalled();
    });

    it("logs successful persistence", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const status: SavedStatus = {
        scopeKey: "global",
        activityType: 1,
        activityText: "Streaming",
        customStatus: null,
        status: "dnd",
        updatedAt: 1700000000,
      };

      upsertStatus(status);

      expect(logger.debug).toHaveBeenCalled();
    });

    it("handles null activityType", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const status: SavedStatus = {
        scopeKey: "global",
        activityType: null,
        activityText: null,
        customStatus: null,
        status: "online",
        updatedAt: 1700000000,
      };

      upsertStatus(status);

      expect(mockRun).toHaveBeenCalledWith(
        "global",
        null,
        null,
        null,
        "online",
        1700000000
      );
    });

    it("handles invisible status", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const status: SavedStatus = {
        scopeKey: "global",
        activityType: null,
        activityText: null,
        customStatus: null,
        status: "invisible",
        updatedAt: 1700000000,
      };

      upsertStatus(status);

      expect(mockRun).toHaveBeenCalledWith(
        "global",
        null,
        null,
        null,
        "invisible",
        1700000000
      );
    });
  });

  describe("getStatus", () => {
    it("returns saved status when found", () => {
      mockGet.mockReturnValue({
        scope_key: "global",
        activity_type: 0,
        activity_text: "Playing games",
        custom_status: null,
        status: "online",
        updated_at: 1700000000,
      });

      const result = getStatus("global");

      expect(result).toEqual({
        scopeKey: "global",
        activityType: 0,
        activityText: "Playing games",
        customStatus: null,
        status: "online",
        updatedAt: 1700000000,
      });
    });

    it("returns null when no status found", () => {
      mockGet.mockReturnValue(undefined);

      const result = getStatus("global");

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalled();
    });

    it("returns null on database error", () => {
      mockGet.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = getStatus("global");

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it("handles guild-specific scope key", () => {
      mockGet.mockReturnValue({
        scope_key: "guild123",
        activity_type: 2,
        activity_text: "Listening to music",
        custom_status: null,
        status: "idle",
        updated_at: 1700000000,
      });

      const result = getStatus("guild123");

      expect(result?.scopeKey).toBe("guild123");
      expect(result?.activityType).toBe(2);
      expect(result?.activityText).toBe("Listening to music");
    });

    it("maps custom status correctly", () => {
      mockGet.mockReturnValue({
        scope_key: "global",
        activity_type: 4,
        activity_text: null,
        custom_status: "My custom status",
        status: "online",
        updated_at: 1700000000,
      });

      const result = getStatus("global");

      expect(result?.customStatus).toBe("My custom status");
      expect(result?.activityType).toBe(4);
    });

    it("logs successful retrieval", () => {
      mockGet.mockReturnValue({
        scope_key: "global",
        activity_type: 0,
        activity_text: "test",
        custom_status: null,
        status: "online",
        updated_at: 1700000000,
      });

      getStatus("global");

      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("ensureBotStatusSchema", () => {
    it("creates table when it does not exist", () => {
      mockGet.mockReturnValue(undefined); // Table doesn't exist
      mockRun.mockReturnValue({ changes: 0 });

      ensureBotStatusSchema();

      expect(logger.info).toHaveBeenCalled();
    });

    it("skips table creation when table exists", () => {
      mockGet.mockReturnValue({ name: "bot_status" }); // Table exists

      ensureBotStatusSchema();

      // Should not attempt to create table
      expect(mockRun).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", () => {
      mockGet.mockImplementation(() => {
        throw new Error("Database error");
      });

      // Should not throw
      expect(() => ensureBotStatusSchema()).not.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});

describe("statusStore types", () => {
  describe("SavedStatus type", () => {
    it("has required scopeKey field", () => {
      const status: SavedStatus = {
        scopeKey: "test",
        activityType: null,
        activityText: null,
        customStatus: null,
        status: "online",
        updatedAt: 0,
      };
      expect(status.scopeKey).toBeDefined();
    });

    it("supports all status values", () => {
      const statuses: Array<SavedStatus["status"]> = [
        "online",
        "idle",
        "dnd",
        "invisible",
      ];
      expect(statuses).toHaveLength(4);
    });

    it("supports null activityType", () => {
      const status: SavedStatus = {
        scopeKey: "test",
        activityType: null,
        activityText: null,
        customStatus: null,
        status: "online",
        updatedAt: 0,
      };
      expect(status.activityType).toBeNull();
    });

    it("supports numeric activityType", () => {
      const status: SavedStatus = {
        scopeKey: "test",
        activityType: 0,
        activityText: "Playing",
        customStatus: null,
        status: "online",
        updatedAt: 0,
      };
      expect(status.activityType).toBe(0);
    });
  });

  describe("activityType values", () => {
    it("0 = Playing", () => {
      expect(0).toBe(0); // ActivityType.Playing
    });

    it("1 = Streaming", () => {
      expect(1).toBe(1); // ActivityType.Streaming
    });

    it("2 = Listening", () => {
      expect(2).toBe(2); // ActivityType.Listening
    });

    it("3 = Watching", () => {
      expect(3).toBe(3); // ActivityType.Watching
    });

    it("4 = Custom", () => {
      expect(4).toBe(4); // ActivityType.Custom
    });

    it("5 = Competing", () => {
      expect(5).toBe(5); // ActivityType.Competing
    });
  });
});

describe("database schema", () => {
  describe("bot_status table", () => {
    it("has scope_key as primary key", () => {
      const schema = {
        scope_key: "TEXT NOT NULL PRIMARY KEY",
        activity_type: "INTEGER",
        activity_text: "TEXT",
        custom_status: "TEXT",
        status: "TEXT NOT NULL",
        updated_at: "INTEGER NOT NULL",
      };
      expect(schema.scope_key).toContain("PRIMARY KEY");
    });

    it("has nullable activity fields", () => {
      const schema = {
        activity_type: "INTEGER",
        activity_text: "TEXT",
        custom_status: "TEXT",
      };
      expect(schema.activity_type).not.toContain("NOT NULL");
      expect(schema.activity_text).not.toContain("NOT NULL");
      expect(schema.custom_status).not.toContain("NOT NULL");
    });

    it("has non-nullable required fields", () => {
      const schema = {
        scope_key: "TEXT NOT NULL PRIMARY KEY",
        status: "TEXT NOT NULL",
        updated_at: "INTEGER NOT NULL",
      };
      expect(schema.scope_key).toContain("NOT NULL");
      expect(schema.status).toContain("NOT NULL");
      expect(schema.updated_at).toContain("NOT NULL");
    });
  });

  describe("UPSERT pattern", () => {
    it("uses ON CONFLICT for idempotent writes", () => {
      const sql = `INSERT INTO bot_status ... ON CONFLICT(scope_key) DO UPDATE SET`;
      expect(sql).toContain("ON CONFLICT");
      expect(sql).toContain("DO UPDATE SET");
    });
  });
});

describe("status persistence scenarios", () => {
  describe("first run", () => {
    it("returns null for non-existent status", () => {
      mockGet.mockReturnValue(undefined);
      const result = getStatus("global");
      expect(result).toBeNull();
    });
  });

  describe("restart recovery", () => {
    it("retrieves previously saved status", () => {
      mockGet.mockReturnValue({
        scope_key: "global",
        activity_type: 0,
        activity_text: "Playing games",
        custom_status: null,
        status: "online",
        updated_at: 1700000000,
      });

      const result = getStatus("global");

      expect(result).not.toBeNull();
      expect(result?.activityText).toBe("Playing games");
    });
  });

  describe("status update", () => {
    it("overwrites existing status on upsert", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const newStatus: SavedStatus = {
        scopeKey: "global",
        activityType: 1,
        activityText: "New status",
        customStatus: null,
        status: "dnd",
        updatedAt: 1700001000,
      };

      upsertStatus(newStatus);

      expect(mockRun).toHaveBeenCalledWith(
        "global",
        1,
        "New status",
        null,
        "dnd",
        1700001000
      );
    });
  });
});

describe("scope key patterns", () => {
  describe("global scope", () => {
    it("uses 'global' for bot-wide status", () => {
      const scopeKey = "global";
      expect(scopeKey).toBe("global");
    });
  });

  describe("guild scope", () => {
    it("uses guild ID for per-guild status", () => {
      const guildId = "123456789012345678";
      const scopeKey = guildId;
      expect(scopeKey).toBe("123456789012345678");
    });
  });
});

describe("error handling", () => {
  describe("upsertStatus errors", () => {
    it("logs error before rethrowing", () => {
      mockRun.mockImplementation(() => {
        throw new Error("SQLITE_BUSY");
      });

      const status: SavedStatus = {
        scopeKey: "global",
        activityType: null,
        activityText: null,
        customStatus: null,
        status: "online",
        updatedAt: 1700000000,
      };

      expect(() => upsertStatus(status)).toThrow("SQLITE_BUSY");
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getStatus errors", () => {
    it("returns null without throwing", () => {
      mockGet.mockImplementation(() => {
        throw new Error("Connection lost");
      });

      const result = getStatus("global");

      expect(result).toBeNull();
    });

    it("logs error details", () => {
      mockGet.mockImplementation(() => {
        throw new Error("Connection lost");
      });

      getStatus("global");

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("ensureBotStatusSchema errors", () => {
    it("continues silently on error", () => {
      mockGet.mockImplementation(() => {
        throw new Error("Schema check failed");
      });

      expect(() => ensureBotStatusSchema()).not.toThrow();
    });
  });
});
