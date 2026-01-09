/**
 * Pawtropolis Tech — tests/lib/syncMarker.test.ts
 * WHAT: Unit tests for sync marker tracking.
 * WHY: Verify database freshness tracking for sync operations.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db and env before imports
vi.mock("../../src/db/db.js", () => {
  const mockRun = vi.fn();
  const mockGet = vi.fn();
  return {
    db: {
      prepare: vi.fn(() => ({
        run: mockRun,
        get: mockGet,
      })),
      _mockRun: mockRun,
      _mockGet: mockGet,
    },
  };
});

vi.mock("../../src/lib/env.js", () => ({
  BOT_LOCATION: "local",
}));

import { touchSyncMarker, getSyncMarker } from "../../src/lib/syncMarker.js";
import { db } from "../../src/db/db.js";

const mockFns = db as unknown as { _mockRun: ReturnType<typeof vi.fn>; _mockGet: ReturnType<typeof vi.fn> };

describe("syncMarker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("touchSyncMarker", () => {
    it("updates sync marker without action type", () => {
      touchSyncMarker();

      expect(mockFns._mockRun).toHaveBeenCalled();
    });

    it("updates sync marker with action type", () => {
      touchSyncMarker("review_action");

      expect(mockFns._mockRun).toHaveBeenCalled();
    });

    it("swallows errors gracefully", () => {
      mockFns._mockRun.mockImplementation(() => {
        throw new Error("Table does not exist");
      });

      expect(() => touchSyncMarker()).not.toThrow();
    });
  });

  describe("getSyncMarker", () => {
    it("returns sync marker when found", () => {
      const mockMarker = {
        id: 1,
        last_modified_at: 1700000000,
        last_modified_by: "local",
        action_count: 42,
        last_action_type: "review_action",
        updated_at: "2024-01-01T00:00:00.000Z",
      };
      mockFns._mockGet.mockReturnValue(mockMarker);

      const result = getSyncMarker();

      expect(result).toEqual(mockMarker);
    });

    it("returns null when no marker found", () => {
      mockFns._mockGet.mockReturnValue(null);

      const result = getSyncMarker();

      expect(result).toBeNull();
    });

    it("returns null on database error", () => {
      mockFns._mockGet.mockImplementation(() => {
        throw new Error("Query failed");
      });

      const result = getSyncMarker();

      expect(result).toBeNull();
    });
  });
});
