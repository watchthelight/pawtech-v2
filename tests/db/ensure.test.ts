/**
 * Pawtropolis Tech — tests/db/ensure.test.ts
 * WHAT: Unit tests for schema ensure functions.
 * WHY: Verify table/column creation and migration logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db with prepared statements - factory pattern for hoisting
vi.mock("../../src/db/db.js", () => {
  const mockPrepareGet = vi.fn();
  const mockPrepareAll = vi.fn();
  const mockPrepareRun = vi.fn();
  const mockExec = vi.fn();
  const mockPragma = vi.fn();
  const mockTransaction = vi.fn((fn: () => void) => fn);

  return {
    db: {
      prepare: vi.fn(() => ({
        get: mockPrepareGet,
        all: mockPrepareAll,
        run: mockPrepareRun,
      })),
      exec: mockExec,
      pragma: mockPragma,
      transaction: mockTransaction,
      _mockFns: {
        get: mockPrepareGet,
        all: mockPrepareAll,
        run: mockPrepareRun,
        exec: mockExec,
        pragma: mockPragma,
        transaction: mockTransaction,
      },
    },
  };
});

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  ensureAvatarScanSchema,
  ensureApplicationPermaRejectColumn,
  ensureOpenModmailTable,
  ensureApplicationStatusIndex,
  ensureManualFlagColumns,
  ensureActionLogSchema,
  ensureSearchIndexes,
  ensurePanicModeColumn,
  ensureArtistRotationConfigColumns,
  ensureApplicationStaleAlertColumns,
} from "../../src/db/ensure.js";
import { db } from "../../src/db/db.js";
import { logger } from "../../src/lib/logger.js";

type MockFns = {
  get: ReturnType<typeof vi.fn>;
  all: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  pragma: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

const mockFns = (db as unknown as { _mockFns: MockFns })._mockFns;

describe("ensure.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFns.get.mockReturnValue(undefined);
    mockFns.all.mockReturnValue([]);
  });

  describe("ensureAvatarScanSchema", () => {
    it("creates table when it does not exist", () => {
      mockFns.get.mockReturnValue(undefined); // table doesn't exist

      ensureAvatarScanSchema();

      expect(mockFns.run).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });

    it("adds missing columns when table exists", () => {
      mockFns.get.mockReturnValue({ name: "avatar_scan" }); // table exists
      mockFns.all.mockReturnValue([
        { name: "application_id" },
        { name: "avatar_url" },
      ]); // only some columns

      ensureAvatarScanSchema();

      expect(mockFns.run).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });

    it("renames app_id to application_id if needed", () => {
      mockFns.get.mockReturnValue({ name: "avatar_scan" });
      mockFns.all.mockReturnValue([{ name: "app_id" }]); // old column name

      ensureAvatarScanSchema();

      expect(mockFns.exec).toHaveBeenCalled();
    });

    it("handles errors gracefully", () => {
      mockFns.get.mockImplementation(() => {
        throw new Error("DB error");
      });

      expect(() => ensureAvatarScanSchema()).toThrow("DB error");
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("ensureApplicationPermaRejectColumn", () => {
    it("skips when application table does not exist", () => {
      mockFns.get.mockReturnValue(undefined);

      ensureApplicationPermaRejectColumn();

      expect(logger.warn).toHaveBeenCalled();
    });

    it("adds columns when table exists but columns missing", () => {
      mockFns.get.mockReturnValue({ name: "application" });
      mockFns.all.mockReturnValue([{ name: "id" }]); // missing perm reject columns

      ensureApplicationPermaRejectColumn();

      expect(mockFns.run).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });

    it("skips column addition when columns already exist", () => {
      mockFns.get.mockReturnValue({ name: "application" });
      mockFns.all.mockReturnValue([
        { name: "id" },
        { name: "permanently_rejected" },
        { name: "permanent_reject_at" },
      ]);

      ensureApplicationPermaRejectColumn();

      // Should still create index
      expect(mockFns.run).toHaveBeenCalled();
    });
  });

  describe("ensureOpenModmailTable", () => {
    it("creates table and index", () => {
      ensureOpenModmailTable();

      expect(mockFns.run).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });

    it("handles errors", () => {
      mockFns.run.mockImplementation(() => {
        throw new Error("Create failed");
      });

      expect(() => ensureOpenModmailTable()).toThrow("Create failed");
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("ensureApplicationStatusIndex", () => {
    it("creates index", () => {
      ensureApplicationStatusIndex();

      expect(mockFns.run).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });

    it("handles errors", () => {
      mockFns.run.mockImplementation(() => {
        throw new Error("Index failed");
      });

      expect(() => ensureApplicationStatusIndex()).toThrow("Index failed");
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("ensureManualFlagColumns", () => {
    it("skips when user_activity table does not exist", () => {
      mockFns.get.mockReturnValue(undefined);

      ensureManualFlagColumns();

      expect(logger.warn).toHaveBeenCalled();
    });

    it("adds columns when table exists but columns missing", () => {
      mockFns.get.mockReturnValue({ name: "user_activity" });
      mockFns.all.mockReturnValue([{ name: "id" }]);

      ensureManualFlagColumns();

      expect(mockFns.run).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("ensureActionLogSchema", () => {
    it("creates action_log table when it does not exist", () => {
      mockFns.get
        .mockReturnValueOnce(undefined) // action_log doesn't exist
        .mockReturnValueOnce({ name: "guild_config" }); // guild_config exists

      mockFns.all.mockReturnValue([{ name: "logging_channel_id" }]);

      ensureActionLogSchema();

      expect(mockFns.exec).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });

    it("creates guild_config table when it does not exist", () => {
      mockFns.get
        .mockReturnValueOnce({ name: "action_log" }) // action_log exists
        .mockReturnValueOnce(undefined); // guild_config doesn't exist

      ensureActionLogSchema();

      expect(mockFns.exec).toHaveBeenCalled();
    });

    it("adds logging_channel_id column to existing guild_config", () => {
      mockFns.get
        .mockReturnValueOnce({ name: "action_log" })
        .mockReturnValueOnce({ name: "guild_config" });
      mockFns.pragma.mockReturnValue([]); // no columns

      ensureActionLogSchema();

      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("ensureSearchIndexes", () => {
    it("skips when application table does not exist", () => {
      mockFns.get.mockReturnValue(undefined);

      ensureSearchIndexes();

      expect(logger.warn).toHaveBeenCalled();
    });

    it("creates indexes when table exists", () => {
      mockFns.get.mockReturnValue({ name: "application" });

      ensureSearchIndexes();

      expect(mockFns.run).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("ensurePanicModeColumn", () => {
    it("skips when guild_config table does not exist", () => {
      mockFns.get.mockReturnValue(undefined);

      ensurePanicModeColumn();

      expect(logger.warn).toHaveBeenCalled();
    });

    it("adds panic_mode columns when table exists", () => {
      mockFns.get.mockReturnValue({ name: "guild_config" });
      mockFns.pragma.mockReturnValue([]); // no columns exist yet

      ensurePanicModeColumn();

      expect(mockFns.exec).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("ensureArtistRotationConfigColumns", () => {
    it("skips when guild_config table does not exist", () => {
      mockFns.get.mockReturnValue(undefined);

      ensureArtistRotationConfigColumns();

      expect(logger.warn).toHaveBeenCalled();
    });

    it("adds columns when table exists but columns missing", () => {
      mockFns.get.mockReturnValue({ name: "guild_config" });
      mockFns.all.mockReturnValue([{ name: "guild_id" }]);

      ensureArtistRotationConfigColumns();

      expect(mockFns.run).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });

    it("skips when all columns exist", () => {
      mockFns.get.mockReturnValue({ name: "guild_config" });
      mockFns.all.mockReturnValue([
        { name: "artist_role_id" },
        { name: "ambassador_role_id" },
        { name: "server_artist_channel_id" },
        { name: "artist_ticket_roles_json" },
      ]);

      ensureArtistRotationConfigColumns();

      // Only the final log should happen
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("ensureApplicationStaleAlertColumns", () => {
    it("skips when application table does not exist", () => {
      mockFns.get.mockReturnValue(undefined);

      ensureApplicationStaleAlertColumns();

      expect(logger.warn).toHaveBeenCalled();
    });

    it("adds columns when table exists but columns missing", () => {
      mockFns.get.mockReturnValue({ name: "application" });
      mockFns.all.mockReturnValue([{ name: "id" }]);

      ensureApplicationStaleAlertColumns();

      expect(mockFns.run).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });

    it("skips when all columns exist", () => {
      mockFns.get.mockReturnValue({ name: "application" });
      mockFns.all.mockReturnValue([
        { name: "stale_alert_sent" },
        { name: "stale_alert_sent_at" },
      ]);

      ensureApplicationStaleAlertColumns();

      expect(logger.info).toHaveBeenCalled();
    });
  });
});
