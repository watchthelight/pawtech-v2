// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Tests for review_action free-text migration
 * WHAT: Verifies migration removes CHECK constraint, converts created_at to INTEGER, preserves data.
 * WHY: Ensures safe schema evolution without data loss or corruption.
 * FLOWS:
 *  - Seed old schema with CHECK constraint and TEXT created_at
 *  - Run migration
 *  - Assert: no CHECK, INTEGER created_at, row count preserved, indexes exist
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

type BetterDb = Database.Database;

async function loadMigration(db: BetterDb) {
  vi.resetModules();
  vi.doMock("../../src/lib/logger.js", () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

  const mod = await import("../../migrations/2025-10-20_review_action_free_text.js");
  return mod.migrateReviewActionFreeText as (db: BetterDb) => void;
}

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
  return mod.ensureReviewActionFreeText as () => void;
}

function getColumnInfo(db: BetterDb, tableName: string) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
  }>;
}

function hasIndex(db: BetterDb, tableName: string, indexName: string): boolean {
  const indexes = db.prepare(`PRAGMA index_list('${tableName}')`).all() as Array<{ name: string }>;
  return indexes.some((idx) => idx.name === indexName);
}

function getIndexInfo(db: BetterDb, indexName: string) {
  return db.prepare(`PRAGMA index_info('${indexName}')`).all() as Array<{
    seqno: number;
    cid: number;
    name: string;
  }>;
}

describe("review_action migration: remove CHECK constraint + INTEGER created_at", () => {
  it("migrates legacy schema with CHECK constraint and TEXT created_at", async () => {
    const db = new Database(":memory:");

    try {
      // Seed old schema with CHECK constraint and TEXT created_at
      db.exec(`
        CREATE TABLE application (
          id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE review_action (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id TEXT NOT NULL,
          moderator_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('approve','reject','need_info','kick','avatar_viewsrc','perm_reject')),
          reason TEXT,
          message_link TEXT,
          meta TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_review_action_app_time ON review_action(app_id, created_at DESC);

        INSERT INTO application (id, guild_id, user_id, status) VALUES
          ('app-1', 'guild-1', 'user-1', 'submitted'),
          ('app-2', 'guild-1', 'user-2', 'approved');

        INSERT INTO review_action (app_id, moderator_id, action, reason, created_at) VALUES
          ('app-1', 'mod-1', 'approve', NULL, '2024-10-20 12:00:00'),
          ('app-2', 'mod-2', 'reject', 'Incomplete', '2024-10-19 10:30:00'),
          ('app-1', 'mod-1', 'kick', 'Spam', '2024-10-18 08:15:00');
      `);

      const countBefore = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
        count: number;
      };
      expect(countBefore.count).toBe(3);

      // Verify CHECK constraint exists (attempt invalid action)
      expect(() => {
        db.prepare(
          `INSERT INTO review_action (app_id, moderator_id, action) VALUES ('app-1', 'mod-1', 'copy_uid')`
        ).run();
      }).toThrow(/CHECK constraint failed/);

      // Run migration
      const migrate = await loadMigration(db);
      migrate(db);

      // Verify: no CHECK constraint (copy_uid should succeed)
      const insertResult = db
        .prepare(
          `
        INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, meta)
        VALUES ('app-1', 'mod-1', 'copy_uid', 1729468800, NULL, NULL)
      `
        )
        .run();
      expect(insertResult.changes).toBe(1);

      // Verify: created_at is now INTEGER
      const cols = getColumnInfo(db, "review_action");
      const createdAtCol = cols.find((c) => c.name === "created_at");
      expect(createdAtCol).toBeDefined();
      expect(createdAtCol?.type).toBe("INTEGER");
      expect(createdAtCol?.notnull).toBe(1); // NOT NULL

      // Verify: row count preserved
      const countAfter = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
        count: number;
      };
      expect(countAfter.count).toBe(4); // 3 original + 1 new

      // Verify: index exists
      expect(hasIndex(db, "review_action", "idx_review_action_app_time")).toBe(true);

      // Verify: index includes created_at DESC
      const indexCols = getIndexInfo(db, "idx_review_action_app_time");
      expect(indexCols).toHaveLength(2);
      expect(indexCols[0].name).toBe("app_id");
      expect(indexCols[1].name).toBe("created_at");

      // Verify: data integrity (timestamps converted from TEXT to INTEGER)
      const rows = db
        .prepare(
          `
        SELECT id, app_id, action, created_at
        FROM review_action
        WHERE id <= 3
        ORDER BY id
      `
        )
        .all() as Array<{ id: number; app_id: string; action: string; created_at: number }>;

      expect(rows).toHaveLength(3);
      rows.forEach((row) => {
        expect(typeof row.created_at).toBe("number");
        expect(row.created_at).toBeGreaterThan(1000000000); // Sanity check: valid Unix timestamp
      });
    } finally {
      db.close();
    }
  });

  it("is idempotent: running migration twice is safe", async () => {
    const db = new Database(":memory:");

    try {
      // Seed old schema
      db.exec(`
        CREATE TABLE application (id TEXT PRIMARY KEY);
        CREATE TABLE review_action (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id TEXT NOT NULL,
          moderator_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('approve','reject')),
          reason TEXT,
          message_link TEXT,
          meta TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
        );
        INSERT INTO application (id) VALUES ('app-1');
        INSERT INTO review_action (app_id, moderator_id, action, created_at) VALUES
          ('app-1', 'mod-1', 'approve', '2024-10-20 12:00:00');
      `);

      const migrate = await loadMigration(db);

      // Run migration twice
      migrate(db);
      const countAfterFirst = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
        count: number;
      };

      migrate(db); // Should be no-op
      const countAfterSecond = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
        count: number;
      };

      expect(countAfterFirst.count).toBe(countAfterSecond.count);

      // Verify: created_at is INTEGER
      const cols = getColumnInfo(db, "review_action");
      const createdAtCol = cols.find((c) => c.name === "created_at");
      expect(createdAtCol?.type).toBe("INTEGER");
    } finally {
      db.close();
    }
  });

  it("handles NULL created_at by backfilling with current time", async () => {
    const db = new Database(":memory:");

    try {
      // Seed schema with nullable created_at (pathological case)
      db.exec(`
        CREATE TABLE application (id TEXT PRIMARY KEY);
        CREATE TABLE review_action (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id TEXT NOT NULL,
          moderator_id TEXT NOT NULL,
          action TEXT NOT NULL,
          reason TEXT,
          message_link TEXT,
          meta TEXT,
          created_at TEXT
        );
        INSERT INTO application (id) VALUES ('app-1');
        INSERT INTO review_action (app_id, moderator_id, action, created_at) VALUES
          ('app-1', 'mod-1', 'approve', NULL);
      `);

      const migrate = await loadMigration(db);
      migrate(db);

      const row = db.prepare(`SELECT created_at FROM review_action WHERE id = 1`).get() as {
        created_at: number;
      };
      expect(row.created_at).toBeGreaterThan(1000000000); // Valid Unix timestamp
    } finally {
      db.close();
    }
  });

  it("preserves all columns and foreign keys after migration", async () => {
    const db = new Database(":memory:");

    try {
      db.exec(`
        CREATE TABLE application (id TEXT PRIMARY KEY);
        CREATE TABLE review_action (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id TEXT NOT NULL,
          moderator_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('approve','reject')),
          reason TEXT,
          message_link TEXT,
          meta TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
        );
        INSERT INTO application (id) VALUES ('app-1');
        INSERT INTO review_action (app_id, moderator_id, action, reason, message_link, meta, created_at)
        VALUES ('app-1', 'mod-1', 'approve', 'Good', 'https://example.com', '{"test":true}', '2024-10-20 12:00:00');
      `);

      const migrate = await loadMigration(db);
      migrate(db);

      const row = db
        .prepare(
          `
        SELECT id, app_id, moderator_id, action, reason, message_link, meta, created_at
        FROM review_action
        WHERE id = 1
      `
        )
        .get() as {
        id: number;
        app_id: string;
        moderator_id: string;
        action: string;
        reason: string;
        message_link: string;
        meta: string;
        created_at: number;
      };

      expect(row.app_id).toBe("app-1");
      expect(row.moderator_id).toBe("mod-1");
      expect(row.action).toBe("approve");
      expect(row.reason).toBe("Good");
      expect(row.message_link).toBe("https://example.com");
      expect(row.meta).toBe('{"test":true}');
      expect(typeof row.created_at).toBe("number");
    } finally {
      db.close();
    }
  });
});

describe("ensureReviewActionFreeText", () => {
  it("runs migration on legacy schema", async () => {
    const db = new Database(":memory:");

    try {
      // Seed old schema
      db.exec(`
        CREATE TABLE application (id TEXT PRIMARY KEY);
        CREATE TABLE review_action (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id TEXT NOT NULL,
          moderator_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('approve','reject')),
          reason TEXT,
          message_link TEXT,
          meta TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
        );
      `);

      const ensure = await loadEnsure(db);
      ensure();

      // Create application first (for foreign key)
      db.prepare(`INSERT INTO application (id) VALUES ('app-1')`).run();

      // Verify: can insert copy_uid
      const insertResult = db
        .prepare(
          `
        INSERT INTO review_action (app_id, moderator_id, action, created_at)
        VALUES ('app-1', 'mod-1', 'copy_uid', 1729468800)
      `
        )
        .run();
      expect(insertResult.changes).toBe(1);

      // Verify: created_at is INTEGER
      const cols = getColumnInfo(db, "review_action");
      const createdAtCol = cols.find((c) => c.name === "created_at");
      expect(createdAtCol?.type).toBe("INTEGER");
    } finally {
      db.close();
    }
  });

  it("is idempotent: no-op on already migrated schema", async () => {
    const db = new Database(":memory:");

    try {
      // Seed already-migrated schema (no CHECK, INTEGER created_at)
      db.exec(`
        CREATE TABLE application (id TEXT PRIMARY KEY);
        CREATE TABLE review_action (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id TEXT NOT NULL,
          moderator_id TEXT NOT NULL,
          action TEXT NOT NULL,
          reason TEXT,
          message_link TEXT,
          meta TEXT,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
        );
        INSERT INTO application (id) VALUES ('app-1');
        INSERT INTO review_action (app_id, moderator_id, action, created_at) VALUES
          ('app-1', 'mod-1', 'copy_uid', 1729468800);
      `);

      const ensure = await loadEnsure(db);
      ensure(); // Should detect already migrated

      const countAfter = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
        count: number;
      };
      expect(countAfter.count).toBe(1); // No duplication
    } finally {
      db.close();
    }
  });
});
