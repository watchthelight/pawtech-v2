// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Performance sanity tests for review_action
 * WHAT: Verifies performance with 1k+ inserts and index usage.
 * WHY: Ensures schema changes don't degrade performance; validates index efficiency.
 * FLOWS:
 *  - Insert 1k rows
 *  - Query by app_id with ORDER BY created_at DESC
 *  - Verify EXPLAIN QUERY PLAN shows index usage
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";

type BetterDb = Database.Database;

describe("review_action performance with 1k inserts", () => {
  let db: BetterDb;

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

      CREATE INDEX idx_review_action_app_time ON review_action(app_id, created_at DESC);
      CREATE INDEX idx_review_moderator ON review_action(moderator_id);
    `);
  });

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

    // Sanity check: 1000 inserts should complete in under 1 second (generous)
    expect(elapsed).toBeLessThan(1000);
  });

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

  it("query by app_id uses idx_review_action_app_time index (EXPLAIN QUERY PLAN)", () => {
    // Insert test data
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

    // Verify index is used (should mention idx_review_action_app_time)
    expect(planText.toLowerCase()).toMatch(/idx_review_action_app_time/);
    expect(planText.toLowerCase()).not.toMatch(/scan/); // No full table scan
  });

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

  it("transaction for bulk inserts is fast", () => {
    db.exec(`
      INSERT INTO application (id, guild_id, user_id, status) VALUES ('app-1', 'guild-1', 'user-1', 'submitted');
    `);

    const start = Date.now();

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

    // Transaction should be very fast (single disk write)
    expect(elapsed).toBeLessThan(300);
  });

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

    // Index should provide DESC order natively (no "USE TEMP B-TREE FOR ORDER BY")
    expect(planText.toLowerCase()).toMatch(/idx_review_action_app_time/);
    expect(planText.toLowerCase()).not.toMatch(/temp b-tree for order by/);
  });

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

    // Should be instant (index seek)
    expect(elapsed).toBeLessThan(10);
  });
});
