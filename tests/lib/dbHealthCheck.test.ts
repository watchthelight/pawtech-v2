/**
 * Pawtropolis Tech — tests/lib/dbHealthCheck.test.ts
 * WHAT: Unit tests for database health check utilities.
 * WHY: Verify integrity checking and table validation logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs sync
vi.mock("node:fs", () => ({
  statSync: vi.fn().mockReturnValue({ size: 1024 * 1024 }), // 1MB
}));

// Mock db
vi.mock("../../src/db/db.js", () => {
  const mockPrepare = vi.fn();
  return {
    db: {
      prepare: mockPrepare,
      name: "./data/data.db",
      _mockPrepare: mockPrepare,
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
    fatal: vi.fn(),
  },
}));

import { checkDatabaseHealth } from "../../src/lib/dbHealthCheck.js";
import { db } from "../../src/db/db.js";
import { logger } from "../../src/lib/logger.js";

const mockPrepare = (db as unknown as { _mockPrepare: ReturnType<typeof vi.fn> })._mockPrepare;

describe("dbHealthCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkDatabaseHealth", () => {
    it("returns healthy when all checks pass", () => {
      // Mock integrity check returns ok
      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes("integrity_check")) {
          return { all: () => [{ integrity_check: "ok" }] };
        }
        if (sql.includes("COUNT(*)")) {
          return { get: () => ({ c: 1000 }) };
        }
        if (sql.includes("sqlite_master")) {
          return { get: () => ({ name: "idx_test" }) };
        }
        return { all: () => [], get: () => ({}) };
      });

      const result = checkDatabaseHealth();

      expect(result.healthy).toBe(true);
      expect(result.integrity).toBe("ok");
      expect(result.errors).toHaveLength(0);
    });

    it("detects database corruption", () => {
      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes("integrity_check")) {
          return { all: () => [{ integrity_check: "corruption in table xyz" }] };
        }
        if (sql.includes("COUNT(*)")) {
          return { get: () => ({ c: 1000 }) };
        }
        if (sql.includes("sqlite_master")) {
          return { get: () => ({ name: "idx_test" }) };
        }
        return { all: () => [], get: () => ({}) };
      });

      const result = checkDatabaseHealth();

      expect(result.healthy).toBe(false);
      expect(result.integrity).toBe("corrupt");
      expect(result.errors.some(e => e.includes("corruption"))).toBe(true);
    });

    it("handles integrity check error", () => {
      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes("integrity_check")) {
          return {
            all: () => {
              throw new Error("Database is locked");
            },
          };
        }
        if (sql.includes("COUNT(*)")) {
          return { get: () => ({ c: 1000 }) };
        }
        if (sql.includes("sqlite_master")) {
          return { get: () => ({ name: "idx_test" }) };
        }
        return { all: () => [], get: () => ({}) };
      });

      const result = checkDatabaseHealth();

      expect(result.healthy).toBe(false);
      expect(result.integrity).toBe("error");
      expect(result.errors.some(e => e.includes("Database is locked"))).toBe(true);
    });

    it("adds warnings for tables below threshold", () => {
      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes("integrity_check")) {
          return { all: () => [{ integrity_check: "ok" }] };
        }
        if (sql.includes("COUNT(*)")) {
          // Return low count to trigger warning
          return { get: () => ({ c: 0 }) };
        }
        if (sql.includes("sqlite_master")) {
          return { get: () => ({ name: "idx_test" }) };
        }
        return { all: () => [], get: () => ({}) };
      });

      const result = checkDatabaseHealth();

      // Should still be healthy (warnings don't fail)
      expect(result.healthy).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("handles table query error", () => {
      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes("integrity_check")) {
          return { all: () => [{ integrity_check: "ok" }] };
        }
        if (sql.includes("COUNT(*)")) {
          return {
            get: () => {
              throw new Error("Table does not exist");
            },
          };
        }
        if (sql.includes("sqlite_master")) {
          return { get: () => ({ name: "idx_test" }) };
        }
        return { all: () => [], get: () => ({}) };
      });

      const result = checkDatabaseHealth();

      expect(result.healthy).toBe(false);
      expect(result.errors.some(e => e.includes("Cannot read table"))).toBe(true);
    });

    it("warns about missing indexes", () => {
      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes("integrity_check")) {
          return { all: () => [{ integrity_check: "ok" }] };
        }
        if (sql.includes("COUNT(*)")) {
          return { get: () => ({ c: 1000 }) };
        }
        if (sql.includes("sqlite_master")) {
          // Return undefined for missing index
          return { get: () => undefined };
        }
        return { all: () => [], get: () => ({}) };
      });

      const result = checkDatabaseHealth();

      // Missing indexes are warnings, not errors
      expect(result.healthy).toBe(true);
      expect(result.warnings.some(w => w.includes("index missing"))).toBe(true);
    });

    it("records table row counts", () => {
      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes("integrity_check")) {
          return { all: () => [{ integrity_check: "ok" }] };
        }
        if (sql.includes("COUNT(*)") && sql.includes("review_action")) {
          return { get: () => ({ c: 500 }) };
        }
        if (sql.includes("COUNT(*)")) {
          return { get: () => ({ c: 100 }) };
        }
        if (sql.includes("sqlite_master")) {
          return { get: () => ({ name: "idx_test" }) };
        }
        return { all: () => [], get: () => ({}) };
      });

      const result = checkDatabaseHealth();

      expect(result.tables).toBeDefined();
      expect(typeof result.tables.review_action).toBe("number");
    });

    it("handles complete exception during check", () => {
      mockPrepare.mockImplementation(() => {
        throw new Error("Connection lost");
      });

      const result = checkDatabaseHealth();

      expect(result.healthy).toBe(false);
      expect(result.errors.some(e => e.includes("Connection lost"))).toBe(true);
    });
  });
});
