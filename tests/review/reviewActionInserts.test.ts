// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Tests for review_action inserts with all allowed actions
 * WHAT: Verifies all action types (including permreject, copy_uid) can be inserted.
 * WHY: Ensures no CHECK constraint blocks new actions; validates explicit created_at.
 * FLOWS:
 *  - Insert one row for each allowed action
 *  - Verify created_at is INTEGER and matches input
 *  - Verify meta JSON is preserved
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { nowUtc } from "../../src/lib/time.js";
import { ALLOWED_ACTIONS } from "../../src/features/review.js";

type BetterDb = Database.Database;

describe("review_action inserts with all allowed actions", () => {
  let db: BetterDb;

  beforeEach(() => {
    db = new Database(":memory:");

    // Create migrated schema (no CHECK, INTEGER created_at)
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

      INSERT INTO application (id, guild_id, user_id, status) VALUES
        ('app-1', 'guild-1', 'user-1', 'submitted');
    `);
  });

  it("allows all actions in ALLOWED_ACTIONS set", () => {
    const timestamp = nowUtc();

    // Verify ALLOWED_ACTIONS contains expected actions
    expect(ALLOWED_ACTIONS.has("approve")).toBe(true);
    expect(ALLOWED_ACTIONS.has("reject")).toBe(true);
    expect(ALLOWED_ACTIONS.has("perm_reject")).toBe(true);
    expect(ALLOWED_ACTIONS.has("need_info")).toBe(true);
    expect(ALLOWED_ACTIONS.has("kick")).toBe(true);
    expect(ALLOWED_ACTIONS.has("copy_uid")).toBe(true);
    expect(ALLOWED_ACTIONS.has("claim")).toBe(true);

    // Insert one row for each allowed action
    const actions = Array.from(ALLOWED_ACTIONS);
    actions.forEach((action, i) => {
      const result = db
        .prepare(
          `
        INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, meta)
        VALUES (?, ?, ?, ?, ?, ?)
      `
        )
        .run("app-1", "mod-1", action, timestamp + i, `Test ${action}`, null);

      expect(result.changes).toBe(1);
    });

    const count = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
      count: number;
    };
    expect(count.count).toBe(actions.length);
  });

  it("inserts perm_reject action successfully", () => {
    const timestamp = nowUtc();
    const result = db
      .prepare(
        `
      INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, meta)
      VALUES (?, ?, 'perm_reject', ?, ?, ?)
    `
      )
      .run("app-1", "mod-1", timestamp, "Permanent ban", null);

    expect(result.changes).toBe(1);

    const row = db
      .prepare(
        `
      SELECT action, reason, created_at FROM review_action WHERE id = ?
    `
      )
      .get(result.lastInsertRowid) as { action: string; reason: string; created_at: number };

    expect(row.action).toBe("perm_reject");
    expect(row.reason).toBe("Permanent ban");
    expect(row.created_at).toBe(timestamp);
  });

  it("inserts copy_uid action successfully", () => {
    const timestamp = nowUtc();
    const result = db
      .prepare(
        `
      INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, meta)
      VALUES (?, ?, 'copy_uid', ?, ?, ?)
    `
      )
      .run("app-1", "mod-1", timestamp, null, null);

    expect(result.changes).toBe(1);

    const row = db
      .prepare(
        `
      SELECT action, created_at FROM review_action WHERE id = ?
    `
      )
      .get(result.lastInsertRowid) as { action: string; created_at: number };

    expect(row.action).toBe("copy_uid");
    expect(row.created_at).toBe(timestamp);
  });

  it("preserves meta JSON in insert", () => {
    const timestamp = nowUtc();
    const meta = { dmDelivered: true, roleApplied: true };

    const result = db
      .prepare(
        `
      INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, meta)
      VALUES (?, ?, 'approve', ?, ?, json(?))
    `
      )
      .run("app-1", "mod-1", timestamp, null, JSON.stringify(meta));

    expect(result.changes).toBe(1);

    const row = db
      .prepare(
        `
      SELECT meta FROM review_action WHERE id = ?
    `
      )
      .get(result.lastInsertRowid) as { meta: string };

    const parsed = JSON.parse(row.meta);
    expect(parsed.dmDelivered).toBe(true);
    expect(parsed.roleApplied).toBe(true);
  });

  it("uses explicit created_at (not DB default)", () => {
    const explicitTimestamp = 1000000000; // Old timestamp (2001-09-09)

    const result = db
      .prepare(
        `
      INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, meta)
      VALUES (?, ?, 'approve', ?, ?, ?)
    `
      )
      .run("app-1", "mod-1", explicitTimestamp, null, null);

    const row = db
      .prepare(
        `
      SELECT created_at FROM review_action WHERE id = ?
    `
      )
      .get(result.lastInsertRowid) as { created_at: number };

    expect(row.created_at).toBe(explicitTimestamp);
    expect(row.created_at).not.toBeCloseTo(nowUtc(), -2); // Not current time
  });

  it("query by app_id uses idx_review_action_app_time index", () => {
    // Insert multiple actions
    const timestamps = [1729468800, 1729468900, 1729469000];
    timestamps.forEach((ts, i) => {
      db.prepare(
        `
        INSERT INTO review_action (app_id, moderator_id, action, created_at)
        VALUES (?, ?, 'approve', ?)
      `
      ).run("app-1", "mod-1", ts);
    });

    // Query with ORDER BY created_at DESC (should use index)
    const rows = db
      .prepare(
        `
      SELECT created_at FROM review_action
      WHERE app_id = ?
      ORDER BY created_at DESC
    `
      )
      .all("app-1") as Array<{ created_at: number }>;

    expect(rows).toHaveLength(3);
    expect(rows[0].created_at).toBe(1729469000); // Most recent first
    expect(rows[1].created_at).toBe(1729468900);
    expect(rows[2].created_at).toBe(1729468800);

    // Verify index is used (EXPLAIN QUERY PLAN)
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
    expect(planText).toMatch(/idx_review_action_app_time/i);
  });

  it("foreign key CASCADE on application delete", () => {
    const timestamp = nowUtc();

    db.prepare(
      `
      INSERT INTO review_action (app_id, moderator_id, action, created_at)
      VALUES (?, ?, 'approve', ?)
    `
    ).run("app-1", "mod-1", timestamp);

    const countBefore = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
      count: number;
    };
    expect(countBefore.count).toBe(1);

    // Enable foreign keys (required for CASCADE)
    db.exec(`PRAGMA foreign_keys = ON`);

    // Delete application → should cascade delete review_action
    db.prepare(`DELETE FROM application WHERE id = ?`).run("app-1");

    const countAfter = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
      count: number;
    };
    expect(countAfter.count).toBe(0); // Cascaded
  });
});

describe("nowUtc time utility", () => {
  it("returns Unix seconds (not milliseconds)", () => {
    const timestamp = nowUtc();
    const milliseconds = Date.now();

    // Unix seconds should be ~1000x smaller than milliseconds
    expect(timestamp).toBeLessThan(milliseconds);
    expect(timestamp).toBeGreaterThan(1000000000); // Sanity: after year 2001
    expect(timestamp).toBeLessThan(2000000000); // Sanity: before year 2033
  });

  it("matches floor(Date.now() / 1000)", () => {
    const timestamp = nowUtc();
    const expected = Math.floor(Date.now() / 1000);

    // Allow 1 second difference due to execution timing
    expect(Math.abs(timestamp - expected)).toBeLessThanOrEqual(1);
  });
});
