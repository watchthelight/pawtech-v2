// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";

type BetterDb = Database;

/**
 * Dynamic loader that injects a test database into the ensure module.
 *
 * Why this indirection: The ensure module imports `db` at the top level, so we
 * can't just swap out the database after import. We need to reset modules and
 * re-mock before each test gets its own fresh in-memory DB.
 *
 * The logger mock prevents console spam during tests and lets us verify
 * logging behavior if needed.
 */
async function loadEnsure(db: BetterDb) {
  vi.resetModules();
  vi.doMock("../../src/db/db.js", () => ({ db }));
  vi.doMock("../../src/lib/logger.js", () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

  const mod = await import("../../src/db/ensure.js");
  return mod.ensureAvatarScanSchema as () => void;
}

/** Helper: Extract column names from avatar_scan table using SQLite's PRAGMA introspection. */
function columnNames(db: BetterDb): string[] {
  const rows = db.prepare(`PRAGMA table_info(avatar_scan)`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

/** Helper: Check if a unique index exists. Used to verify constraint creation. */
function hasUniqueIndex(db: BetterDb, name: string): boolean {
  const indexes = db.prepare(`PRAGMA index_list('avatar_scan')`).all() as Array<{
    name: string;
    unique: number;
  }>;
  return indexes.some((idx) => idx.name === name && idx.unique === 1);
}

/**
 * Tests for the schema migration/creation logic.
 *
 * These tests verify that ensureAvatarScanSchema handles three scenarios:
 * 1. Fresh install (no table exists)
 * 2. Legacy schema (old column names that need renaming)
 * 3. Already-migrated schema (running ensure again should be safe)
 *
 * Each test gets a fresh in-memory SQLite DB to avoid cross-test pollution.
 * The try/finally pattern ensures we always close the DB, even on assertion failure.
 */
describe("ensureAvatarScanSchema", () => {
  /**
   * Fresh install scenario: No avatar_scan table exists yet.
   * Verifies all expected columns are created and the unique index is in place.
   */
  it("creates avatar_scan table when missing", async () => {
    const db = new Database(":memory:");
    const ensure = await loadEnsure(db);
    try {
      ensure();

      const cols = columnNames(db);
      expect(cols).toEqual(
        expect.arrayContaining([
          "application_id",
          "avatar_url",
          "nsfw_score",
          "edge_score",
          "final_pct",
          "reason",
          "scanned_at",
          "updated_at",
        ])
      );

      expect(hasUniqueIndex(db, "ux_avatar_scan_application")).toBe(true);
    } finally {
      db.close();
    }
  });

  /**
   * Migration scenario: Simulates an older database that used "app_id" instead
   * of "application_id". The ensure function should:
   * 1. Rename the column (SQLite doesn't support ALTER COLUMN, so this likely
   *    involves table recreation behind the scenes)
   * 2. Add any missing columns (like final_pct) with sensible defaults
   * 3. Preserve existing data
   *
   * The final_pct=0 assertion verifies that new columns get their default values.
   */
  it("renames legacy app_id column and keeps existing data", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE avatar_scan (
        app_id TEXT PRIMARY KEY,
        avatar_url TEXT
      );
      INSERT INTO avatar_scan (app_id, avatar_url) VALUES ('app-123', 'https://cdn.example/avatar.png');
    `);

    const ensure = await loadEnsure(db);
    try {
      ensure();

      const cols = columnNames(db);
      expect(cols).toContain("application_id");
      expect(cols).not.toContain("app_id");
      expect(cols).toContain("final_pct");

      const row = db
        .prepare(
          `SELECT application_id, avatar_url, final_pct FROM avatar_scan WHERE application_id = ?`
        )
        .get("app-123") as
        | { application_id: string; avatar_url: string; final_pct: number }
        | undefined;

      expect(row).toBeDefined();
      expect(row?.application_id).toBe("app-123");
      expect(row?.avatar_url).toBe("https://cdn.example/avatar.png");
      expect(row?.final_pct).toBe(0);
    } finally {
      db.close();
    }
  });

  /**
   * Idempotency test: Running ensure() multiple times should be safe.
   * This is critical because the bot might restart and call ensure() on startup.
   * We verify:
   * 1. No duplicate columns created
   * 2. No duplicate indexes created
   * 3. No errors thrown
   */
  it("is idempotent when schema is already correct", async () => {
    const db = new Database(":memory:");
    const ensure = await loadEnsure(db);
    try {
      ensure();
      ensure(); // Second call should be a no-op

      const cols = columnNames(db);
      const filtered = cols.filter((name) => name === "application_id");
      expect(filtered).toHaveLength(1);

      const indexes = db.prepare(`PRAGMA index_list('avatar_scan')`).all() as Array<{
        name: string;
      }>;
      const matching = indexes.filter((idx) => idx.name === "ux_avatar_scan_application");
      expect(matching).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
