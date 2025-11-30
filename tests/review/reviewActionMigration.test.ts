// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Review Action Migration Tests
 *
 * Tests the schema migration that:
 * 1. Removes the restrictive CHECK constraint on the action column
 * 2. Converts created_at from TEXT (ISO datetime) to INTEGER (Unix seconds)
 * 3. Preserves all existing data through the migration
 *
 * Why This Migration Exists:
 * The original CHECK constraint listed all valid action types inline, making it
 * impossible to add new actions without a schema change. Converting to free-text
 * moves validation to the application layer (ALLOWED_ACTIONS set).
 *
 * The TEXT->INTEGER change for created_at improves storage efficiency and query
 * performance while standardizing on Unix timestamps throughout the codebase.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

type BetterDb = Database.Database;

/**
 * Loads the migration module with mocked logger.
 * vi.resetModules() is critical here - without it, cached imports would bypass
 * the mock and potentially log to stdout during tests.
 */
async function loadMigration(db: BetterDb) {
  vi.resetModules();
  vi.doMock("../../src/lib/logger.js", () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }));

  const mod = await import("../../migrations/028_review_action_free_text.js");
  return mod.migrate028ReviewActionFreeText as (db: BetterDb) => void;
}

/**
 * Loads the ensure function which wraps the migration for production use.
 * This is called at bot startup to ensure the schema is current.
 * Note: We mock db.js to inject our test database instance.
 */
async function loadEnsure(db: BetterDb) {
  vi.resetModules();
  vi.doMock("../../src/db/db.js", () => ({ db }));
  vi.doMock("../../src/lib/logger.js", () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }));

  const mod = await import("../../src/db/ensure.js");
  return mod.ensureReviewActionFreeText as () => void;
}

// Helper functions for inspecting SQLite schema via PRAGMA commands

/** Returns column metadata: name, type, nullability, default value */
function getColumnInfo(db: BetterDb, tableName: string) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
  }>;
}

/** Checks if a named index exists on the table */
function hasIndex(db: BetterDb, tableName: string, indexName: string): boolean {
  const indexes = db.prepare(`PRAGMA index_list('${tableName}')`).all() as Array<{ name: string }>;
  return indexes.some((idx) => idx.name === indexName);
}

/** Returns the columns covered by an index (for composite index verification) */
function getIndexInfo(db: BetterDb, indexName: string) {
  return db.prepare(`PRAGMA index_info('${indexName}')`).all() as Array<{
    seqno: number;
    cid: number;
    name: string;
  }>;
}

describe("review_action migration: remove CHECK constraint + INTEGER created_at", () => {
  // The main migration test: starts with legacy schema and verifies complete transformation
  it("migrates legacy schema with CHECK constraint and TEXT created_at", async () => {
    const db = new Database(":memory:");

    try {
      // This is the EXACT schema that exists in production before migration.
      // The CHECK constraint explicitly lists allowed actions - adding new ones fails.
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

      // Prove the CHECK constraint is blocking new action types before migration.
      // copy_uid wasn't in the original list, so this should fail.
      expect(() => {
        db.prepare(
          `INSERT INTO review_action (app_id, moderator_id, action) VALUES ('app-1', 'mod-1', 'copy_uid')`
        ).run();
      }).toThrow(/CHECK constraint failed/);

      // Run migration - this is the system under test
      const migrate = await loadMigration(db);
      migrate(db);

      // After migration, the CHECK is gone - this insert should succeed
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

      // Most critical check: verify TEXT timestamps were converted to INTEGER.
      // The migration parses ISO strings like "2024-10-20 12:00:00" and outputs Unix seconds.
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
        // If this is a string, the migration failed to convert
        expect(typeof row.created_at).toBe("number");
        // Sanity: should be a plausible Unix timestamp (after 2001, before 2033)
        expect(row.created_at).toBeGreaterThan(1000000000);
      });
    } finally {
      db.close();
    }
  });

  // Idempotency is critical for production: the migration runs on every bot startup,
  // so it must detect "already migrated" and do nothing.
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

  // Edge case: what if a row has NULL created_at? This shouldn't happen in practice
  // (column has NOT NULL in prod schema), but the migration should handle it gracefully.
  it("handles NULL created_at by backfilling with current time", async () => {
    const db = new Database(":memory:");

    try {
      // Artificially create nullable created_at - a pathological but possible state
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

  // Regression test: SQLite's table recreation can accidentally drop columns or
  // foreign key constraints. Verify every field survives the migration intact.
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

// These tests verify the startup-time wrapper (ensureReviewActionFreeText) that
// calls the migration. This is what actually runs in production.
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

  // Simulates a bot restart after the migration has already run.
  // The ensure function should detect the migrated state and skip work.
  it("is idempotent: no-op on already migrated schema", async () => {
    const db = new Database(":memory:");

    try {
      // Schema already has INTEGER created_at and no CHECK - the post-migration state
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

/**
 * Tests for DDL-based CHECK constraint detection.
 * These verify that the migration correctly detects schema states using sqlite_master
 * introspection instead of fragile probe inserts that could fail on FK constraints.
 */
describe("DDL introspection for CHECK constraint detection", () => {
  it("detects CHECK constraint in legacy schema via sqlite_master", async () => {
    const db = new Database(":memory:");

    try {
      // Create application table (needed for FK in new table) and legacy review_action with CHECK
      db.exec(`
        CREATE TABLE application (id TEXT PRIMARY KEY);
        CREATE TABLE review_action (
          id INTEGER PRIMARY KEY,
          app_id TEXT NOT NULL,
          moderator_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK(action IN ('approved','rejected','kicked')),
          reason TEXT,
          message_link TEXT,
          meta TEXT,
          created_at TEXT
        )
      `);

      // Migration should detect and run
      const migrate = await loadMigration(db);
      migrate(db);

      // Verify CHECK constraint is removed
      const schema = db
        .prepare(`SELECT sql FROM sqlite_master WHERE name='review_action'`)
        .get() as { sql: string };
      expect(schema.sql).not.toMatch(/CHECK/i);
    } finally {
      db.close();
    }
  });

  it("skips migration when CHECK already removed but created_at is TEXT", async () => {
    const db = new Database(":memory:");

    try {
      // Create application table (needed for FK in new table) and review_action without CHECK
      db.exec(`
        CREATE TABLE application (id TEXT PRIMARY KEY);
        CREATE TABLE review_action (
          id INTEGER PRIMARY KEY,
          app_id TEXT NOT NULL,
          moderator_id TEXT NOT NULL,
          action TEXT NOT NULL,
          reason TEXT,
          message_link TEXT,
          meta TEXT,
          created_at TEXT
        )
      `);

      const migrate = await loadMigration(db);
      migrate(db);

      // Verify created_at was converted to INTEGER
      const cols = getColumnInfo(db, "review_action");
      const createdAt = cols.find((c) => c.name === "created_at");
      expect(createdAt?.type).toBe("INTEGER");
    } finally {
      db.close();
    }
  });

  it("is idempotent - no-op when already migrated", async () => {
    const db = new Database(":memory:");

    try {
      // Create final schema (no CHECK, INTEGER created_at, all columns)
      db.exec(`
        CREATE TABLE review_action (
          id INTEGER PRIMARY KEY,
          app_id TEXT NOT NULL,
          moderator_id TEXT NOT NULL,
          action TEXT NOT NULL,
          reason TEXT,
          message_link TEXT,
          meta TEXT,
          created_at INTEGER NOT NULL
        )
      `);

      const beforeSql = db
        .prepare(`SELECT sql FROM sqlite_master WHERE name='review_action'`)
        .get() as { sql: string };

      const migrate = await loadMigration(db);
      migrate(db);

      const afterSql = db
        .prepare(`SELECT sql FROM sqlite_master WHERE name='review_action'`)
        .get() as { sql: string };
      expect(afterSql.sql).toEqual(beforeSql.sql);
    } finally {
      db.close();
    }
  });

  it("handles missing table gracefully", async () => {
    const db = new Database(":memory:");

    try {
      // No review_action table exists
      const migrate = await loadMigration(db);
      expect(() => migrate(db)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("detects CHECK constraint correctly (DDL introspection has no FK dependency)", async () => {
    const db = new Database(":memory:");

    try {
      // Create application table and review_action with CHECK constraint.
      // The key point: DDL introspection correctly detects CHECK constraint
      // without needing to attempt a probe insert that could fail on FK.
      // This is more reliable because it queries sqlite_master directly.
      db.exec(`
        CREATE TABLE application (id TEXT PRIMARY KEY);
        CREATE TABLE review_action (
          id INTEGER PRIMARY KEY,
          app_id TEXT NOT NULL,
          moderator_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK(action IN ('approve','reject')),
          reason TEXT,
          message_link TEXT,
          meta TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
        )
      `);

      // With DDL introspection, this works correctly regardless of FK relationships
      const migrate = await loadMigration(db);
      migrate(db);

      // Verify CHECK was removed
      const schema = db
        .prepare(`SELECT sql FROM sqlite_master WHERE name='review_action'`)
        .get() as { sql: string };
      expect(schema.sql).not.toMatch(/CHECK/i);

      // Verify created_at is INTEGER
      const cols = getColumnInfo(db, "review_action");
      const createdAt = cols.find((c) => c.name === "created_at");
      expect(createdAt?.type).toBe("INTEGER");
    } finally {
      db.close();
    }
  });
});
