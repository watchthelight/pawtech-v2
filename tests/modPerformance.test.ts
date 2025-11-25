/**
 * Pawtropolis Tech — tests/modPerformance.test.ts
 * WHAT: Unit and integration tests for mod performance metrics engine.
 * WHY: Ensure percentile calculations, caching, and metrics computation work correctly.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { db } from "../src/db/db.js";
import { nowUtc } from "../src/lib/time.js";
import {
  recalcModMetrics,
  getCachedMetrics,
  getModeratorMetrics,
  getTopModerators,
  __test__clearModMetricsCache,
} from "../src/features/modPerformance.js";

describe("Mod Performance Engine", () => {
  const TEST_GUILD_ID = "test-guild-metrics-" + Date.now();
  const TEST_MOD_1 = "mod-user-1";
  const TEST_MOD_2 = "mod-user-2";
  const TEST_MOD_3 = "mod-user-3";

  beforeAll(() => {
    // Ensure mod_metrics table exists
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mod_metrics (
          moderator_id        TEXT NOT NULL,
          guild_id            TEXT NOT NULL,
          total_claims        INTEGER NOT NULL DEFAULT 0,
          total_accepts       INTEGER NOT NULL DEFAULT 0,
          total_rejects       INTEGER NOT NULL DEFAULT 0,
          total_kicks         INTEGER NOT NULL DEFAULT 0,
          total_modmail_opens INTEGER NOT NULL DEFAULT 0,
          avg_response_time_s REAL DEFAULT NULL,
          p50_response_time_s REAL DEFAULT NULL,
          p95_response_time_s REAL DEFAULT NULL,
          updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (moderator_id, guild_id)
        )
      `);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_mod_metrics_guild_id
               ON mod_metrics(guild_id, total_accepts DESC)`);
    } catch (err) {
      // Ignore if table already exists
    }
  });

  beforeEach(() => {
    // Clean up any existing test data
    db.prepare(`DELETE FROM action_log WHERE guild_id LIKE ?`).run("test-guild-metrics-%");
    db.prepare(`DELETE FROM mod_metrics WHERE guild_id LIKE ?`).run("test-guild-metrics-%");
    __test__clearModMetricsCache();
  });

  afterEach(() => {
    // Clean up test data
    db.prepare(`DELETE FROM action_log WHERE guild_id LIKE ?`).run("test-guild-metrics-%");
    db.prepare(`DELETE FROM mod_metrics WHERE guild_id LIKE ?`).run("test-guild-metrics-%");
    __test__clearModMetricsCache();
    vi.clearAllTimers();
  });

  describe("recalcModMetrics", () => {
    it("should calculate basic action counts correctly", async () => {
      const now = nowUtc();

      // Insert test actions
      const insertAction = db.prepare(`
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Mod 1: 3 accepts, 1 reject, 2 claims
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
        "claim",
        null,
        null,
        now - 80
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
        now - 70
      );
      insertAction.run(
        TEST_GUILD_ID,
        "app-3",
        "CODE3",
        TEST_MOD_1,
        "user-3",
        "claim",
        null,
        null,
        now - 60
      );
      insertAction.run(
        TEST_GUILD_ID,
        "app-3",
        "CODE3",
        TEST_MOD_1,
        "user-3",
        "reject",
        "Bad",
        null,
        now - 50
      );

      // Mod 2: 1 accept
      insertAction.run(
        TEST_GUILD_ID,
        "app-4",
        "CODE4",
        TEST_MOD_2,
        "user-4",
        "claim",
        null,
        null,
        now - 40
      );
      insertAction.run(
        TEST_GUILD_ID,
        "app-4",
        "CODE4",
        TEST_MOD_2,
        "user-4",
        "approve",
        "Good",
        null,
        now - 30
      );

      // Recalculate metrics
      const updatedCount = await recalcModMetrics(TEST_GUILD_ID);
      expect(updatedCount).toBe(2); // 2 moderators

      // Verify mod 1 metrics
      const mod1Metrics = await getModeratorMetrics(TEST_GUILD_ID, TEST_MOD_1);
      expect(mod1Metrics).toBeDefined();
      expect(mod1Metrics?.total_claims).toBe(3); // Changed from 2 to 3 to match the data
      expect(mod1Metrics?.total_accepts).toBe(2);
      expect(mod1Metrics?.total_rejects).toBe(1);

      // Verify mod 2 metrics
      const mod2Metrics = await getModeratorMetrics(TEST_GUILD_ID, TEST_MOD_2);
      expect(mod2Metrics).toBeDefined();
      expect(mod2Metrics?.total_claims).toBe(1);
      expect(mod2Metrics?.total_accepts).toBe(1);
      expect(mod2Metrics?.total_rejects).toBe(0);
    });

    it("should calculate response time percentiles correctly", async () => {
      const now = nowUtc();

      // Insert test data with known response times
      const insertAction = db.prepare(`
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Create response times: 10s, 20s, 30s, 40s, 50s
      const responseTimes = [10, 20, 30, 40, 50];
      for (let i = 0; i < responseTimes.length; i++) {
        const submitTime = now - 200 - i * 100;
        const responseTime = responseTimes[i];
        const claimTime = submitTime + responseTime;
        const decideTime = claimTime + 5; // approve 5s after claim

        // Insert app_submitted (required for response time calculation)
        insertAction.run(
          TEST_GUILD_ID,
          `app-${i}`,
          `CODE${i}`,
          `user-${i}`, // applicant is the actor for app_submitted
          `user-${i}`,
          "app_submitted",
          null,
          null,
          submitTime
        );

        insertAction.run(
          TEST_GUILD_ID,
          `app-${i}`,
          `CODE${i}`,
          TEST_MOD_1,
          `user-${i}`,
          "claim",
          null,
          null,
          claimTime
        );
        insertAction.run(
          TEST_GUILD_ID,
          `app-${i}`,
          `CODE${i}`,
          TEST_MOD_1,
          `user-${i}`,
          "approve",
          "Good",
          null,
          decideTime
        );
      }

      // Recalculate
      await recalcModMetrics(TEST_GUILD_ID);

      // Verify percentiles
      const metrics = await getModeratorMetrics(TEST_GUILD_ID, TEST_MOD_1);
      expect(metrics).toBeDefined();

      // Average should be 30s (10+20+30+40+50)/5
      expect(metrics?.avg_response_time_s).toBeCloseTo(30, 1);

      // p50 (median) should be 30s (middle value)
      expect(metrics?.p50_response_time_s).toBeCloseTo(30, 1);

      // p95 should be ~48s (95th percentile between 40 and 50)
      expect(metrics?.p95_response_time_s).toBeGreaterThan(40);
      expect(metrics?.p95_response_time_s).toBeLessThanOrEqual(50);
    });

    it("should handle moderators with only claims (no decisions)", async () => {
      const now = nowUtc();

      // Insert only claim action
      db.prepare(
        `
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(TEST_GUILD_ID, "app-1", "CODE1", TEST_MOD_1, "user-1", "claim", null, null, now);

      await recalcModMetrics(TEST_GUILD_ID);

      const metrics = await getModeratorMetrics(TEST_GUILD_ID, TEST_MOD_1);
      expect(metrics).toBeDefined();
      expect(metrics?.total_claims).toBe(1);
      expect(metrics?.total_accepts).toBe(0);
      expect(metrics?.total_rejects).toBe(0);
      expect(metrics?.avg_response_time_s).toBeNull();
      expect(metrics?.p50_response_time_s).toBeNull();
      expect(metrics?.p95_response_time_s).toBeNull();
    });

    it("should update existing metrics on recalculation", async () => {
      const now = nowUtc();

      // Insert initial action
      db.prepare(
        `
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(TEST_GUILD_ID, "app-1", "CODE1", TEST_MOD_1, "user-1", "approve", "Good", null, now);

      // First calculation
      await recalcModMetrics(TEST_GUILD_ID);
      const metrics1 = await getModeratorMetrics(TEST_GUILD_ID, TEST_MOD_1);
      expect(metrics1?.total_accepts).toBe(1);

      // Add another action
      db.prepare(
        `
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        TEST_GUILD_ID,
        "app-2",
        "CODE2",
        TEST_MOD_1,
        "user-2",
        "approve",
        "Good",
        null,
        now + 10
      );

      // Second calculation
      await recalcModMetrics(TEST_GUILD_ID);
      const metrics2 = await getModeratorMetrics(TEST_GUILD_ID, TEST_MOD_1);
      expect(metrics2?.total_accepts).toBe(2);
    });

    it("should handle empty action log", async () => {
      const emptyGuildId = "test-guild-empty-" + Date.now();
      const updatedCount = await recalcModMetrics(emptyGuildId);
      expect(updatedCount).toBe(0);

      const metrics = await getCachedMetrics(emptyGuildId);
      expect(metrics).toEqual([]);
    });
  });

  describe("getCachedMetrics", () => {
    it("should refresh when cache stale (TTL=0 in tests)", async () => {
      const cacheGuildId = "test-guild-cache-" + Date.now();
      const now = nowUtc();

      // Insert test data
      db.prepare(
        `
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(cacheGuildId, "app-1", "CODE1", TEST_MOD_1, "user-1", "approve", "Good", null, now);

      // First call - should hit DB
      const metrics1 = await getCachedMetrics(cacheGuildId);
      expect(metrics1.length).toBe(1);

      // Add more data
      db.prepare(
        `
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        cacheGuildId,
        "app-2",
        "CODE2",
        TEST_MOD_2,
        "user-2",
        "approve",
        "Good",
        null,
        now + 10
      );

      // With TTL=0, cache is always stale - should auto-refresh
      const metrics2 = await getCachedMetrics(cacheGuildId);
      expect(metrics2.length).toBe(2); // Auto-refreshed

      // Clean up
      db.prepare(`DELETE FROM action_log WHERE guild_id = ?`).run(cacheGuildId);
      db.prepare(`DELETE FROM mod_metrics WHERE guild_id = ?`).run(cacheGuildId);
    });
  });

  describe("getTopModerators", () => {
    it("should return moderators sorted by total_accepts DESC", async () => {
      const now = nowUtc();

      const insertAction = db.prepare(`
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Mod 1: 5 accepts
      for (let i = 0; i < 5; i++) {
        insertAction.run(
          TEST_GUILD_ID,
          `app-1-${i}`,
          `CODE${i}`,
          TEST_MOD_1,
          `user-${i}`,
          "approve",
          "Good",
          null,
          now - i
        );
      }

      // Mod 2: 3 accepts
      for (let i = 0; i < 3; i++) {
        insertAction.run(
          TEST_GUILD_ID,
          `app-2-${i}`,
          `CODE${i}`,
          TEST_MOD_2,
          `user-${i}`,
          "approve",
          "Good",
          null,
          now - i
        );
      }

      // Mod 3: 1 accept
      insertAction.run(
        TEST_GUILD_ID,
        "app-3-0",
        "CODE0",
        TEST_MOD_3,
        "user-0",
        "approve",
        "Good",
        null,
        now
      );

      await recalcModMetrics(TEST_GUILD_ID);

      // Get top 10
      const topMods = await getTopModerators(TEST_GUILD_ID, 10);
      expect(topMods.length).toBe(3);
      expect(topMods[0].moderator_id).toBe(TEST_MOD_1);
      expect(topMods[0].total_accepts).toBe(5);
      expect(topMods[1].moderator_id).toBe(TEST_MOD_2);
      expect(topMods[1].total_accepts).toBe(3);
      expect(topMods[2].moderator_id).toBe(TEST_MOD_3);
      expect(topMods[2].total_accepts).toBe(1);
    });

    it("should respect limit parameter", async () => {
      const limitGuildId = "test-guild-limit-" + Date.now();
      const now = nowUtc();

      const insertAction = db.prepare(`
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Create 5 moderators
      for (let modIdx = 0; modIdx < 5; modIdx++) {
        insertAction.run(
          limitGuildId,
          `app-${modIdx}`,
          `CODE${modIdx}`,
          `mod-${modIdx}`,
          `user-${modIdx}`,
          "approve",
          "Good",
          null,
          now - modIdx
        );
      }

      await recalcModMetrics(limitGuildId);

      // Get top 3 (sortBy defaults to "accepts")
      const topMods = await getTopModerators(limitGuildId, "accepts", 3);
      expect(topMods.length).toBe(3);

      // Clean up
      db.prepare(`DELETE FROM action_log WHERE guild_id = ?`).run(limitGuildId);
      db.prepare(`DELETE FROM mod_metrics WHERE guild_id = ?`).run(limitGuildId);
    });
  });

  describe("Edge Cases", () => {
    it("should handle modmail_open actions", async () => {
      const now = nowUtc();

      db.prepare(
        `
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(TEST_GUILD_ID, null, null, TEST_MOD_1, "user-1", "modmail_open", null, null, now);

      await recalcModMetrics(TEST_GUILD_ID);

      const metrics = await getModeratorMetrics(TEST_GUILD_ID, TEST_MOD_1);
      expect(metrics).toBeDefined();
      expect(metrics?.total_modmail_opens).toBe(1);
    });

    it("should handle kick actions", async () => {
      const now = nowUtc();

      db.prepare(
        `
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(TEST_GUILD_ID, "app-1", "CODE1", TEST_MOD_1, "user-1", "kick", "Spam", null, now);

      await recalcModMetrics(TEST_GUILD_ID);

      const metrics = await getModeratorMetrics(TEST_GUILD_ID, TEST_MOD_1);
      expect(metrics).toBeDefined();
      expect(metrics?.total_kicks).toBe(1);
    });

    it("should calculate response time from claim to decision", async () => {
      const now = nowUtc();

      const insertAction = db.prepare(`
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Submit app, claim after 20s, then approve after another 10s
      insertAction.run(
        TEST_GUILD_ID,
        "app-1",
        "CODE1",
        "user-1", // applicant submits
        "user-1",
        "app_submitted",
        null,
        null,
        now - 50
      );
      insertAction.run(
        TEST_GUILD_ID,
        "app-1",
        "CODE1",
        TEST_MOD_1,
        "user-1",
        "claim",
        null,
        null,
        now - 30 // 20s after submission
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
        now - 20 // 10s after claim, 30s after submission
      );

      await recalcModMetrics(TEST_GUILD_ID);

      const metrics = await getModeratorMetrics(TEST_GUILD_ID, TEST_MOD_1);
      expect(metrics).toBeDefined();

      // Should calculate response time from submission (50s ago) to claim (30s ago) = 20s
      expect(metrics?.avg_response_time_s).toBeCloseTo(20, 1);
    });
  });
});
