// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Review Action Insert Tests
 *
 * Tests database operations for the review_action table after the CHECK
 * constraint was removed. Key scenarios:
 * - All action types in ALLOWED_ACTIONS can be inserted without constraint violations
 * - created_at is stored as INTEGER (Unix seconds), not TEXT
 * - Foreign key CASCADE properly cleans up orphaned actions
 *
 * Schema Context:
 * The review_action table was migrated to remove a restrictive CHECK constraint
 * that prevented adding new action types. These tests verify the post-migration
 * schema accepts all current action types.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { nowUtc } from "../../src/lib/time.js";
import { ALLOWED_ACTIONS } from "../../src/features/review.js";

type BetterDb = Database.Database;

describe("review_action inserts with all allowed actions", () => {
  let db: BetterDb;

  // Fresh in-memory DB for each test - isolation prevents cross-test pollution
  beforeEach(() => {
    db = new Database(":memory:");

    // Schema matches the post-migration state: no CHECK constraint on action column,
    // created_at as INTEGER (Unix seconds), composite index for efficient app history queries
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

      -- Composite index: (app_id, created_at DESC) optimizes the common query pattern
      -- of fetching recent actions for a specific application
      CREATE INDEX idx_review_action_app_time ON review_action(app_id, created_at DESC);

      INSERT INTO application (id, guild_id, user_id, status) VALUES
        ('app-1', 'guild-1', 'user-1', 'submitted');
    `);
  });

  // Exhaustive test: insert every action type from ALLOWED_ACTIONS.
  // If a new action type is added but the schema blocks it, this test will catch it.
  it("allows all actions in ALLOWED_ACTIONS set", () => {
    const timestamp = nowUtc();

    // Sanity check: ALLOWED_ACTIONS should contain all expected moderator actions
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

  // perm_reject is a newer action type that wasn't in the original CHECK constraint.
  // This was one of the primary motivations for removing the CHECK.
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

  // copy_uid is a utility action (copy user ID to clipboard) - not a decision,
  // but still tracked in the action log for audit purposes
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

  // The meta column stores arbitrary JSON for action-specific data.
  // Common uses: dmDelivered (was the user notified?), roleApplied (did role assignment succeed?)
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

  // Verifies we can backdate actions (useful for data migration or testing).
  // The DB has a DEFAULT but our code should always provide explicit timestamps.
  it("uses explicit created_at (not DB default)", () => {
    const explicitTimestamp = 1000000000; // Sept 9, 2001 - obviously not "now"

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

  // Uses EXPLAIN QUERY PLAN to verify SQLite picks our composite index.
  // If the index isn't used, queries degrade to O(n) table scans.
  it("query by app_id uses idx_review_action_app_time index", () => {
    // Insert actions out of order to verify index handles sorting
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

  // Gotcha: SQLite foreign keys are OFF by default. The PRAGMA must be enabled
  // per-connection. This test verifies CASCADE works when properly configured.
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

    // IMPORTANT: Foreign keys are disabled by default in SQLite. Without this PRAGMA,
    // the CASCADE clause is ignored and orphan rows accumulate.
    db.exec(`PRAGMA foreign_keys = ON`);

    // Delete application → should cascade delete review_action
    db.prepare(`DELETE FROM application WHERE id = ?`).run("app-1");

    const countAfter = db.prepare(`SELECT COUNT(*) as count FROM review_action`).get() as {
      count: number;
    };
    expect(countAfter.count).toBe(0); // Cascaded
  });
});

// Separate describe block for the time utility - not strictly DB-related
// but used throughout the insert tests
describe("nowUtc time utility", () => {
  // Critical sanity check: JavaScript Date.now() returns milliseconds, but SQLite
  // and most Unix tooling expects seconds. A mismatch causes dates in year ~56000.
  it("returns Unix seconds (not milliseconds)", () => {
    const timestamp = nowUtc();
    const milliseconds = Date.now();

    // Unix seconds should be ~1000x smaller than milliseconds
    expect(timestamp).toBeLessThan(milliseconds);
    expect(timestamp).toBeGreaterThan(1000000000); // Sanity: after year 2001
    expect(timestamp).toBeLessThan(2000000000); // Sanity: before year 2033
  });

  // Flaky test mitigation: allow 1 second drift since test execution isn't instant
  it("matches floor(Date.now() / 1000)", () => {
    const timestamp = nowUtc();
    const expected = Math.floor(Date.now() / 1000);

    // The 1-second tolerance handles the race between calling nowUtc() and Date.now()
    expect(Math.abs(timestamp - expected)).toBeLessThanOrEqual(1);
  });
});
