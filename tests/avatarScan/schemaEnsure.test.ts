// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";

type BetterDb = Database;

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

function columnNames(db: BetterDb): string[] {
  const rows = db.prepare(`PRAGMA table_info(avatar_scan)`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function hasUniqueIndex(db: BetterDb, name: string): boolean {
  const indexes = db.prepare(`PRAGMA index_list('avatar_scan')`).all() as Array<{
    name: string;
    unique: number;
  }>;
  return indexes.some((idx) => idx.name === name && idx.unique === 1);
}

describe("ensureAvatarScanSchema", () => {
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

  it("is idempotent when schema is already correct", async () => {
    const db = new Database(":memory:");
    const ensure = await loadEnsure(db);
    try {
      ensure();
      ensure();

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
