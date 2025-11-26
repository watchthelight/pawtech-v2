// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Performance Sanity Tests for review_action
 *
 * These aren't rigorous benchmarks - they're guard rails to catch regressions.
 * If a schema change accidentally drops an index or changes query plans,
 * these tests will fail before it hits production.
 *
 * Key scenarios tested:
 * - Bulk insert throughput (should handle 1k+ rows quickly)
 * - Index utilization verified via EXPLAIN QUERY PLAN
 * - Transaction batching performance
 * - Covering index eliminates sort step for ORDER BY
 *
 * Note: Timing thresholds are intentionally generous (500ms-1000ms) to avoid
 * flaky failures on slow CI runners. The goal is catching 10x regressions,
 * not micro-benchmarking.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";

type BetterDb = Database.Database;

describe("review_action performance with 1k inserts", () => {
  let db: BetterDb;

  // Fresh in-memory database for each test - no disk I/O overhead
  beforeEach(() => {
    db = new Database(":memory:");

    db.exec(`
      CREATE TABLE application (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL
      );

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

      -- Primary index for "show recent actions for this application" queries
      CREATE INDEX idx_review_action_app_time ON review_action(app_id, created_at DESC);
      -- Secondary index for "show all actions by this moderator" queries
      CREATE INDEX idx_review_moderator ON review_action(moderator_id);
    `);
  });

  // Baseline test: 1000 inserts across 100 applications.
  // Tests both the insert path and that indexes don't create unacceptable overhead.
  it("inserts 1000 rows efficiently", () => {
    const start = Date.now();

    // Insert 100 applications
    const insertApp = db.prepare(
      `INSERT INTO application (id, guild_id, user_id, status) VALUES (?, ?, ?, ?)`
    );
    for (let i = 0; i < 100; i++) {
      insertApp.run(`app-${i}`, "guild-1", `user-${i}`, "submitted");
    }

    // Insert 10 actions per application (1000 total)
    const insertAction = db.prepare(`
      INSERT INTO review_action (app_id, moderator_id, action, created_at, reason)
      VALUES (?, ?, ?, ?, ?)
    `);

    const baseTimestamp = 1729468800;
    const actions = [
      "approve",
      "reject",
      "need_info",
      "kick",
      "avatar_viewsrc",
      "perm_reject",
      "copy_uid",
    ];

    for (let appIdx = 0; appIdx < 100; appIdx++) {
      for (let actionIdx = 0; actionIdx < 10; actionIdx++) {
        const action = actions[actionIdx % actions.length];
        const timestamp = baseTimestamp + appIdx * 100 + actionIdx;
        insertAction.run(`app-${appIdx}`, "mod-1", action, timestamp, null);
      }
    }

    const elapsed = Date.now() - start;

    const count = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
      count: number;
    };
    expect(count.count).toBe(1000);

    // Generous threshold - this typically completes in ~50-100ms on modern hardware.
    // The 1000ms cap catches catastrophic regressions without being flaky.
    expect(elapsed).toBeLessThan(1000);
  });

  // Prepared statements are reused across iterations, avoiding repeated query parsing.
  // This is how the production code should work.
  it("uses prepared statement for batch inserts (faster)", () => {
    const insertAction = db.prepare(`
      INSERT INTO review_action (app_id, moderator_id, action, created_at)
      VALUES (?, ?, ?, ?)
    `);

    db.exec(
      `INSERT INTO application (id, guild_id, user_id, status) VALUES ('app-1', 'guild-1', 'user-1', 'submitted')`
    );

    const start = Date.now();

    for (let i = 0; i < 1000; i++) {
      insertAction.run("app-1", "mod-1", "approve", 1729468800 + i);
    }

    const elapsed = Date.now() - start;

    const count = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
      count: number;
    };
    expect(count.count).toBe(1000);

    // Prepared statements should be fast
    expect(elapsed).toBeLessThan(500);
  });

  // EXPLAIN QUERY PLAN is SQLite's way of showing how it will execute a query.
  // We're checking that it mentions our index name, proving the optimizer picked it.
  it("query by app_id uses idx_review_action_app_time index (EXPLAIN QUERY PLAN)", () => {
    db.exec(`
      INSERT INTO application (id, guild_id, user_id, status) VALUES ('app-1', 'guild-1', 'user-1', 'submitted');
    `);

    const insertAction = db.prepare(`
      INSERT INTO review_action (app_id, moderator_id, action, created_at)
      VALUES (?, ?, ?, ?)
    `);

    for (let i = 0; i < 100; i++) {
      insertAction.run("app-1", "mod-1", "approve", 1729468800 + i);
    }

    // EXPLAIN QUERY PLAN for query with app_id filter + ORDER BY created_at DESC
    const plan = db
      .prepare(
        `
      EXPLAIN QUERY PLAN
      SELECT action, created_at FROM review_action
      WHERE app_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `
      )
      .all("app-1") as Array<{ detail: string }>;

    const planText = plan.map((p) => p.detail).join(" ");

    // The plan output should mention our index. If it says "SCAN" without an index,
    // that means full table scan - very bad for large tables.
    expect(planText.toLowerCase()).toMatch(/idx_review_action_app_time/);
    expect(planText.toLowerCase()).not.toMatch(/scan/);
  });

  // Moderator dashboard needs to show "all actions by mod X" - verify we have an index for it
  it("query by moderator_id uses idx_review_moderator index", () => {
    db.exec(`
      INSERT INTO application (id, guild_id, user_id, status) VALUES ('app-1', 'guild-1', 'user-1', 'submitted');
    `);

    const insertAction = db.prepare(`
      INSERT INTO review_action (app_id, moderator_id, action, created_at)
      VALUES (?, ?, ?, ?)
    `);

    for (let i = 0; i < 100; i++) {
      insertAction.run("app-1", `mod-${i % 10}`, "approve", 1729468800 + i);
    }

    // EXPLAIN QUERY PLAN for moderator_id query
    const plan = db
      .prepare(
        `
      EXPLAIN QUERY PLAN
      SELECT COUNT(*) FROM review_action
      WHERE moderator_id = ?
    `
      )
      .all("mod-1") as Array<{ detail: string }>;

    const planText = plan.map((p) => p.detail).join(" ");

    // Verify moderator index is used
    expect(planText.toLowerCase()).toMatch(/idx_review_moderator/);
  });

  // SQLite commits each INSERT as a separate transaction by default.
  // Wrapping in an explicit transaction batches all writes into one disk sync.
  // This can be 10-100x faster for bulk operations.
  it("transaction for bulk inserts is fast", () => {
    db.exec(`
      INSERT INTO application (id, guild_id, user_id, status) VALUES ('app-1', 'guild-1', 'user-1', 'submitted');
    `);

    const start = Date.now();

    // better-sqlite3's transaction() helper handles BEGIN/COMMIT automatically
    const insertMany = db.transaction((rows: Array<{ action: string; timestamp: number }>) => {
      const stmt = db.prepare(`
        INSERT INTO review_action (app_id, moderator_id, action, created_at)
        VALUES (?, ?, ?, ?)
      `);

      for (const row of rows) {
        stmt.run("app-1", "mod-1", row.action, row.timestamp);
      }
    });

    const rows = Array.from({ length: 1000 }, (_, i) => ({
      action: "approve",
      timestamp: 1729468800 + i,
    }));

    insertMany(rows);

    const elapsed = Date.now() - start;

    const count = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
      count: number;
    };
    expect(count.count).toBe(1000);

    // Transaction batching should complete in ~20-50ms. 300ms is the failure threshold.
    expect(elapsed).toBeLessThan(300);
  });

  // The index is (app_id, created_at DESC). When we query with WHERE app_id = ?
  // and ORDER BY created_at DESC, SQLite can walk the index in order without
  // sorting. "USE TEMP B-TREE FOR ORDER BY" in the plan would indicate a sort.
  it("index covers ORDER BY created_at DESC without sort step", () => {
    db.exec(`
      INSERT INTO application (id, guild_id, user_id, status) VALUES ('app-1', 'guild-1', 'user-1', 'submitted');
    `);

    const insertAction = db.prepare(`
      INSERT INTO review_action (app_id, moderator_id, action, created_at)
      VALUES (?, ?, ?, ?)
    `);

    // Insert in random order
    const timestamps = [1729469000, 1729468800, 1729468900];
    timestamps.forEach((ts) => {
      insertAction.run("app-1", "mod-1", "approve", ts);
    });

    // Query with ORDER BY created_at DESC
    const plan = db
      .prepare(
        `
      EXPLAIN QUERY PLAN
      SELECT created_at FROM review_action
      WHERE app_id = ?
      ORDER BY created_at DESC
    `
      )
      .all("app-1") as Array<{ detail: string }>;

    const planText = plan.map((p) => p.detail).join(" ");

    // "TEMP B-TREE FOR ORDER BY" in the plan means SQLite has to sort results.
    // Our DESC index should eliminate this overhead.
    expect(planText.toLowerCase()).toMatch(/idx_review_action_app_time/);
    expect(planText.toLowerCase()).not.toMatch(/temp b-tree for order by/);
  });

  // Real-world scenario: showing the last 5 actions on an application review card.
  // With proper indexing, this is an index seek + limit, not a table scan.
  it("query recent actions per application is efficient", () => {
    // Seed 10 applications with 100 actions each
    for (let appIdx = 0; appIdx < 10; appIdx++) {
      db.prepare(`INSERT INTO application (id, guild_id, user_id, status) VALUES (?, ?, ?, ?)`).run(
        `app-${appIdx}`,
        "guild-1",
        `user-${appIdx}`,
        "submitted"
      );

      const insertAction = db.prepare(`
        INSERT INTO review_action (app_id, moderator_id, action, created_at)
        VALUES (?, ?, ?, ?)
      `);

      for (let i = 0; i < 100; i++) {
        insertAction.run(`app-${appIdx}`, "mod-1", "approve", 1729468800 + appIdx * 1000 + i);
      }
    }

    const totalCount = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
      count: number;
    };
    expect(totalCount.count).toBe(1000);

    // Query: get last 5 actions for app-5
    const start = Date.now();

    const recent = db
      .prepare(
        `
      SELECT action, created_at FROM review_action
      WHERE app_id = ?
      ORDER BY created_at DESC
      LIMIT 5
    `
      )
      .all("app-5") as Array<{ action: string; created_at: number }>;

    const elapsed = Date.now() - start;

    expect(recent).toHaveLength(5);
    expect(recent[0].created_at).toBeGreaterThan(recent[4].created_at); // DESC order

    // This should be sub-millisecond with proper indexing.
    // 10ms threshold catches if we accidentally trigger a table scan.
    expect(elapsed).toBeLessThan(10);
  });
});
