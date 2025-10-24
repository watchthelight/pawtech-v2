/**
 * WHAT: Tests for bot status persistence (statusStore)
 * HOW: Uses in-memory better-sqlite3 to test save/load operations
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Mock logger before importing statusStore module
vi.mock("../src/lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock db module
let testDb: Database.Database;
vi.mock("../src/db/db.js", () => ({
  get db() {
    return testDb;
  },
}));

import { upsertStatus, getStatus, ensureBotStatusSchema } from "../src/features/statusStore.js";

describe("bot status persistence", () => {
  const testDbPath = path.join(process.cwd(), "tests", "test-status-store.db");

  beforeEach(() => {
    // Create fresh test database
    testDb = new Database(testDbPath);
    testDb.pragma("foreign_keys = ON");

    // Create bot_status table
    ensureBotStatusSchema();
  });

  afterEach(() => {
    testDb.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe("upsertStatus", () => {
    it("inserts a new status when none exists", () => {
      upsertStatus({
        scopeKey: "global",
        activityType: 0, // ActivityType.Playing
        activityText: "Test Game",
        status: "online",
        updatedAt: Date.now(),
      });

      const result = getStatus("global");
      expect(result).not.toBeNull();
      expect(result?.scopeKey).toBe("global");
      expect(result?.activityType).toBe(0);
      expect(result?.activityText).toBe("Test Game");
      expect(result?.status).toBe("online");
    });

    it("updates existing status when called again", () => {
      const now = Date.now();

      // Insert first status
      upsertStatus({
        scopeKey: "global",
        activityType: 0,
        activityText: "First Status",
        status: "online",
        updatedAt: now,
      });

      // Update status
      upsertStatus({
        scopeKey: "global",
        activityType: 0,
        activityText: "Updated Status",
        status: "idle",
        updatedAt: now + 1000,
      });

      const result = getStatus("global");
      expect(result).not.toBeNull();
      expect(result?.activityText).toBe("Updated Status");
      expect(result?.status).toBe("idle");
      expect(result?.updatedAt).toBe(now + 1000);
    });

    it("supports different scope keys", () => {
      upsertStatus({
        scopeKey: "global",
        activityType: 0,
        activityText: "Global Status",
        status: "online",
        updatedAt: Date.now(),
      });

      upsertStatus({
        scopeKey: "guild123",
        activityType: 1,
        activityText: "Guild Status",
        status: "dnd",
        updatedAt: Date.now(),
      });

      const globalStatus = getStatus("global");
      const guildStatus = getStatus("guild123");

      expect(globalStatus?.activityText).toBe("Global Status");
      expect(guildStatus?.activityText).toBe("Guild Status");
    });

    it("supports all status types", () => {
      const statuses: Array<"online" | "idle" | "dnd" | "invisible"> = [
        "online",
        "idle",
        "dnd",
        "invisible",
      ];

      for (const status of statuses) {
        upsertStatus({
          scopeKey: `test-${status}`,
          activityType: 0,
          activityText: `Test ${status}`,
          status,
          updatedAt: Date.now(),
        });

        const result = getStatus(`test-${status}`);
        expect(result?.status).toBe(status);
      }
    });
  });

  describe("getStatus", () => {
    it("returns null when no status exists", () => {
      const result = getStatus("nonexistent");
      expect(result).toBeNull();
    });

    it("retrieves the most recent status", () => {
      const now = Date.now();

      upsertStatus({
        scopeKey: "global",
        activityType: 0,
        activityText: "Status 1",
        status: "online",
        updatedAt: now,
      });

      upsertStatus({
        scopeKey: "global",
        activityType: 0,
        activityText: "Status 2",
        status: "idle",
        updatedAt: now + 1000,
      });

      const result = getStatus("global");
      expect(result?.activityText).toBe("Status 2");
      expect(result?.updatedAt).toBe(now + 1000);
    });

    it("returns complete status object", () => {
      const testStatus = {
        scopeKey: "global",
        activityType: 2, // ActivityType.Listening
        activityText: "Spotify",
        status: "online" as const,
        updatedAt: Date.now(),
      };

      upsertStatus(testStatus);
      const result = getStatus("global");

      expect(result).toEqual(testStatus);
    });
  });

  describe("ensureBotStatusSchema", () => {
    it("creates table when it doesn't exist", () => {
      // Drop the table first
      testDb.prepare("DROP TABLE IF EXISTS bot_status").run();

      // Ensure schema
      ensureBotStatusSchema();

      // Verify table exists
      const tableExists = testDb
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='bot_status'`)
        .get() as { name: string } | undefined;

      expect(tableExists).toBeDefined();
      expect(tableExists?.name).toBe("bot_status");
    });

    it("does not error if table already exists", () => {
      // First creation
      ensureBotStatusSchema();

      // Second creation should not throw
      expect(() => ensureBotStatusSchema()).not.toThrow();
    });
  });

  describe("restart simulation", () => {
    it("status persists across 'restarts'", () => {
      // Simulate setting status before shutdown
      const testStatus = {
        scopeKey: "global",
        activityType: 0,
        activityText: "Playing before restart",
        status: "online" as const,
        updatedAt: Date.now(),
      };

      upsertStatus(testStatus);

      // Simulate restart by getting status (as startup would)
      const restored = getStatus("global");

      expect(restored).not.toBeNull();
      expect(restored?.activityText).toBe("Playing before restart");
      expect(restored?.activityType).toBe(0);
      expect(restored?.status).toBe("online");
    });
  });
});
