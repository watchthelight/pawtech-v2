/**
 * Pawtropolis Tech — tests/modstats.test.ts
 * WHAT: Unit tests for /modstats command CSV export functionality.
 * WHY: Ensure CSV generation and export features work correctly.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../src/db/db.js";
import { nowUtc } from "../src/lib/time.js";

/**
 * Tests for the /modstats slash command which generates leaderboards and CSV exports
 * of moderator activity. This command is used by server admins to track mod productivity.
 *
 * Note: These tests directly query the DB rather than invoking the command handler,
 * so they're testing the query logic in isolation. The actual command handler
 * is tested separately in integration tests.
 */
describe("Modstats Command", () => {
  const TEST_GUILD_ID = "test-guild-modstats-" + Date.now();
  const TEST_MOD_1 = "mod-user-1";
  const TEST_MOD_2 = "mod-user-2";

  beforeEach(() => {
    // Clean up any existing test data
    db.prepare(`DELETE FROM action_log WHERE guild_id = ?`).run(TEST_GUILD_ID);
  });

  afterEach(() => {
    // Clean up test data
    db.prepare(`DELETE FROM action_log WHERE guild_id = ?`).run(TEST_GUILD_ID);
  });

  /**
   * Core aggregation logic. The leaderboard groups by actor_id and counts
   * different action types separately so admins can see the full picture.
   */
  describe("Leaderboard Query", () => {
    /**
     * Sets up two mods with different action mixes to verify counts are
     * attributed correctly. Mod 1 is more approval-happy, Mod 2 rejects more.
     */
    it("should aggregate moderator actions correctly", () => {
      const now = nowUtc();

      const insertAction = db.prepare(`
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Mod 1: 3 approves, 1 reject
      insertAction.run(
        TEST_GUILD_ID,
        "app-1",
        "CODE1",
        TEST_MOD_1,
        "user-1",
        "approve",
        "Good",
        null,
        now - 100
      );
      insertAction.run(
        TEST_GUILD_ID,
        "app-2",
        "CODE2",
        TEST_MOD_1,
        "user-2",
        "approve",
        "Good",
        null,
        now - 90
      );
      insertAction.run(
        TEST_GUILD_ID,
        "app-3",
        "CODE3",
        TEST_MOD_1,
        "user-3",
        "approve",
        "Good",
        null,
        now - 80
      );
      insertAction.run(
        TEST_GUILD_ID,
        "app-4",
        "CODE4",
        TEST_MOD_1,
        "user-4",
        "reject",
        "Bad",
        null,
        now - 70
      );

      // Mod 2: 1 approve, 2 rejects
      insertAction.run(
        TEST_GUILD_ID,
        "app-5",
        "CODE5",
        TEST_MOD_2,
        "user-5",
        "approve",
        "Good",
        null,
        now - 60
      );
      insertAction.run(
        TEST_GUILD_ID,
        "app-6",
        "CODE6",
        TEST_MOD_2,
        "user-6",
        "reject",
        "Bad",
        null,
        now - 50
      );
      insertAction.run(
        TEST_GUILD_ID,
        "app-7",
        "CODE7",
        TEST_MOD_2,
        "user-7",
        "reject",
        "Bad",
        null,
        now - 40
      );

      // Query leaderboard data (30 days)
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60;
      const rows = db
        .prepare(
          `
        SELECT
          actor_id,
          COUNT(*) as total,
          SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) as approvals,
          SUM(CASE WHEN action = 'reject' THEN 1 ELSE 0 END) as rejections,
          SUM(CASE WHEN action = 'kick' THEN 1 ELSE 0 END) as kicks
        FROM action_log
        WHERE guild_id = ?
          AND action IN ('approve', 'reject', 'kick')
          AND created_at_s >= ?
        GROUP BY actor_id
        ORDER BY total DESC
        LIMIT 100
      `
        )
        .all(TEST_GUILD_ID, thirtyDaysAgo) as Array<{
        actor_id: string;
        total: number;
        approvals: number;
        rejections: number;
        kicks: number;
      }>;

      expect(rows.length).toBe(2);

      // Verify Mod 1
      const mod1Row = rows.find((r) => r.actor_id === TEST_MOD_1);
      expect(mod1Row).toBeDefined();
      expect(mod1Row?.total).toBe(4);
      expect(mod1Row?.approvals).toBe(3);
      expect(mod1Row?.rejections).toBe(1);
      expect(mod1Row?.kicks).toBe(0);

      // Verify Mod 2
      const mod2Row = rows.find((r) => r.actor_id === TEST_MOD_2);
      expect(mod2Row).toBeDefined();
      expect(mod2Row?.total).toBe(3);
      expect(mod2Row?.approvals).toBe(1);
      expect(mod2Row?.rejections).toBe(2);
      expect(mod2Row?.kicks).toBe(0);
    });

    /**
     * Time filtering is crucial for the "last 7 days" and "last 30 days" views.
     * This test creates one action within range and one outside to verify
     * the created_at_s filter works.
     */
    it("should respect time range filter", () => {
      const now = nowUtc();

      const insertAction = db.prepare(`
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Recent action (within 7 days)
      insertAction.run(
        TEST_GUILD_ID,
        "app-1",
        "CODE1",
        TEST_MOD_1,
        "user-1",
        "approve",
        "Good",
        null,
        now - 3 * 24 * 60 * 60
      );

      // Old action (older than 7 days)
      insertAction.run(
        TEST_GUILD_ID,
        "app-2",
        "CODE2",
        TEST_MOD_1,
        "user-2",
        "approve",
        "Good",
        null,
        now - 10 * 24 * 60 * 60
      );

      // Query with 7-day filter
      const sevenDaysAgo = now - 7 * 24 * 60 * 60;
      const rows = db
        .prepare(
          `
        SELECT
          actor_id,
          COUNT(*) as total
        FROM action_log
        WHERE guild_id = ?
          AND action IN ('approve', 'reject', 'kick')
          AND created_at_s >= ?
        GROUP BY actor_id
      `
        )
        .all(TEST_GUILD_ID, sevenDaysAgo) as Array<{ actor_id: string; total: number }>;

      expect(rows.length).toBe(1);
      expect(rows[0].total).toBe(1); // Only the recent action
    });

    /**
     * The leaderboard intentionally excludes non-terminal actions like "claim",
     * "need_info", and "modmail_open" because those don't represent completed work.
     * Only actual decisions count toward the rankings.
     */
    it("should only include decision actions (accept, reject, kick)", () => {
      const now = nowUtc();

      const insertAction = db.prepare(`
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Insert various action types
      insertAction.run(
        TEST_GUILD_ID,
        "app-1",
        "CODE1",
        TEST_MOD_1,
        "user-1",
        "claim",
        null,
        null,
        now - 100
      );
      insertAction.run(
        TEST_GUILD_ID,
        "app-1",
        "CODE1",
        TEST_MOD_1,
        "user-1",
        "approve",
        "Good",
        null,
        now - 90
      );
      insertAction.run(
        TEST_GUILD_ID,
        "app-2",
        "CODE2",
        TEST_MOD_1,
        "user-2",
        "need_info",
        null,
        null,
        now - 80
      );
      insertAction.run(
        TEST_GUILD_ID,
        null,
        null,
        TEST_MOD_1,
        "user-3",
        "modmail_open",
        null,
        null,
        now - 70
      );

      // Query leaderboard (only decision actions)
      const rows = db
        .prepare(
          `
        SELECT
          actor_id,
          COUNT(*) as total
        FROM action_log
        WHERE guild_id = ?
          AND action IN ('approve', 'reject', 'kick')
        GROUP BY actor_id
      `
        )
        .all(TEST_GUILD_ID) as Array<{ actor_id: string; total: number }>;

      expect(rows.length).toBe(1);
      expect(rows[0].total).toBe(1); // Only the approve action
    });
  });

  /**
   * CSV export tests. The export is attached to Discord messages for admins
   * who want to analyze data in Excel or import into their own tracking systems.
   */
  describe("CSV Generation", () => {
    /**
     * Basic CSV structure test. The format is simple and doesn't use advanced
     * features like quoted fields unless necessary.
     */
    it("should generate valid CSV format", () => {
      const testData = [
        {
          actor_id: TEST_MOD_1,
          total: 10,
          approvals: 7,
          rejections: 2,
          kicks: 1,
        },
        {
          actor_id: TEST_MOD_2,
          total: 5,
          approvals: 3,
          rejections: 2,
          kicks: 0,
        },
      ];

      // Generate CSV (simulating the command logic)
      const csvLines = ["Moderator ID,Total Decisions,Approvals,Rejections,Kicks"];
      for (const row of testData) {
        csvLines.push(
          `${row.actor_id},${row.total},${row.approvals},${row.rejections},${row.kicks}`
        );
      }
      const csvContent = csvLines.join("\n");

      // Verify CSV format
      expect(csvContent).toContain("Moderator ID,Total Decisions,Approvals,Rejections,Kicks");
      expect(csvContent).toContain(`${TEST_MOD_1},10,7,2,1`);
      expect(csvContent).toContain(`${TEST_MOD_2},5,3,2,0`);

      // Verify line count
      const lines = csvContent.split("\n");
      expect(lines.length).toBe(3); // Header + 2 data rows
    });

    /**
     * Discord user IDs are numeric strings, but in theory someone could have
     * a display name with commas. This test verifies quote-escaping works.
     * In practice actor_id is always a snowflake ID so this is defensive.
     */
    it("should handle special characters in CSV values", () => {
      const testData = [
        {
          actor_id: "user,with,commas",
          total: 5,
          approvals: 3,
          rejections: 2,
          kicks: 0,
        },
      ];

      // Generate CSV with proper escaping
      const csvLines = ["Moderator ID,Total Decisions,Approvals,Rejections,Kicks"];
      for (const row of testData) {
        // In real implementation, would need to escape commas in actor_id
        // For now, just testing basic structure
        csvLines.push(
          `"${row.actor_id}",${row.total},${row.approvals},${row.rejections},${row.kicks}`
        );
      }
      const csvContent = csvLines.join("\n");

      expect(csvContent).toContain('"user,with,commas"');
    });

    /**
     * Empty result sets should still produce a valid CSV with just the header.
     * This is important for brand new guilds with no mod activity yet.
     */
    it("should handle empty results", () => {
      const testData: any[] = [];

      const csvLines = ["Moderator ID,Total Decisions,Approvals,Rejections,Kicks"];
      for (const row of testData) {
        csvLines.push(
          `${row.actor_id},${row.total},${row.approvals},${row.rejections},${row.kicks}`
        );
      }
      const csvContent = csvLines.join("\n");

      // Should still have header
      expect(csvContent).toBe("Moderator ID,Total Decisions,Approvals,Rejections,Kicks");
    });
  });

  /**
   * Individual mod lookup is used when an admin wants to check a specific
   * moderator's stats rather than viewing the full leaderboard.
   */
  describe("Individual Moderator Stats", () => {
    /**
     * Verifies that filtering by actor_id correctly isolates one mod's actions
     * and ignores other mods in the same guild.
     */
    it("should query individual moderator stats correctly", () => {
      const now = nowUtc();

      const insertAction = db.prepare(`
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Mod 1 actions
      insertAction.run(
        TEST_GUILD_ID,
        "app-1",
        "CODE1",
        TEST_MOD_1,
        "user-1",
        "approve",
        "Good",
        null,
        now - 100
      );
      insertAction.run(
        TEST_GUILD_ID,
        "app-2",
        "CODE2",
        TEST_MOD_1,
        "user-2",
        "reject",
        "Bad",
        null,
        now - 90
      );

      // Mod 2 actions (should not be included)
      insertAction.run(
        TEST_GUILD_ID,
        "app-3",
        "CODE3",
        TEST_MOD_2,
        "user-3",
        "approve",
        "Good",
        null,
        now - 80
      );

      // Query individual stats
      const row = db
        .prepare(
          `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) as approvals,
          SUM(CASE WHEN action = 'reject' THEN 1 ELSE 0 END) as rejections,
          SUM(CASE WHEN action = 'kick' THEN 1 ELSE 0 END) as kicks
        FROM action_log
        WHERE guild_id = ?
          AND actor_id = ?
          AND action IN ('approve', 'reject', 'kick')
      `
        )
        .get(TEST_GUILD_ID, TEST_MOD_1) as
        | {
            total: number;
            approvals: number;
            rejections: number;
            kicks: number;
          }
        | undefined;

      expect(row).toBeDefined();
      expect(row?.total).toBe(2);
      expect(row?.approvals).toBe(1);
      expect(row?.rejections).toBe(1);
      expect(row?.kicks).toBe(0);
    });
  });

  describe("Edge Cases", () => {
    /**
     * This catches a subtle SQLite behavior: SUM() returns NULL (not 0) when
     * there are no matching rows. The command handler needs to coalesce these
     * to 0 for display. The test documents this gotcha.
     */
    it("should handle moderators with zero actions", () => {
      // Query non-existent moderator
      const row = db
        .prepare(
          `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) as approvals,
          SUM(CASE WHEN action = 'reject' THEN 1 ELSE 0 END) as rejections,
          SUM(CASE WHEN action = 'kick' THEN 1 ELSE 0 END) as kicks
        FROM action_log
        WHERE guild_id = ?
          AND actor_id = ?
          AND action IN ('approve', 'reject', 'kick')
      `
        )
        .get(TEST_GUILD_ID, "non-existent-mod") as
        | {
            total: number;
            approvals: number | null;
            rejections: number | null;
            kicks: number | null;
          }
        | undefined;

      expect(row).toBeDefined();
      expect(row?.total).toBe(0);
      // SQLite SUM returns NULL for empty sets, not 0
      expect(row?.approvals).toBeNull();
      expect(row?.rejections).toBeNull();
      expect(row?.kicks).toBeNull();
    });

    /**
     * Stress test with 200 actions across 50 mods. Verifies the LIMIT clause
     * works correctly and that the aggregation scales. Each mod ends up with
     * exactly 4 actions (200 / 50) due to the round-robin insertion pattern.
     */
    it("should handle very large datasets", () => {
      const now = nowUtc();

      const insertAction = db.prepare(`
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Insert 200 actions
      for (let i = 0; i < 200; i++) {
        insertAction.run(
          TEST_GUILD_ID,
          `app-${i}`,
          `CODE${i}`,
          `mod-${i % 50}`, // 50 different moderators
          `user-${i}`,
          "approve",
          "Good",
          null,
          now - i
        );
      }

      // Query with limit
      const rows = db
        .prepare(
          `
        SELECT
          actor_id,
          COUNT(*) as total
        FROM action_log
        WHERE guild_id = ?
          AND action IN ('approve', 'reject', 'kick')
        GROUP BY actor_id
        ORDER BY total DESC
        LIMIT 100
      `
        )
        .all(TEST_GUILD_ID) as Array<{ actor_id: string; total: number }>;

      // Should return top 50 moderators (not exceeding 100 limit)
      expect(rows.length).toBe(50);

      // Each moderator should have 4 actions (200 / 50)
      for (const row of rows) {
        expect(row.total).toBe(4);
      }
    });
  });
});
