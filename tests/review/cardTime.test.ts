/**
 * Pawtropolis Tech — tests/review/cardTime.test.ts
 * WHAT: Tests for unified timestamps and action history on review cards.
 * WHY: Ensure time displays are consistent and history field renders correctly.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/db.js";
import { renderReviewEmbed } from "../../src/features/review.js";
import { getRecentActionsForApp } from "../../src/features/review/queries.js";
import { nowUtc } from "../../src/lib/time.js";

describe("Review Card Time Display", () => {
  const now = nowUtc();
  let testGuildId: string;
  let testUserId: string;
  let testModId: string;
  let testAppId: string;

  beforeEach(() => {
    // Generate unique IDs for each test to avoid UNIQUE constraint conflicts
    testGuildId = "test-guild-time-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    testUserId = "test-user-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    testModId = "test-mod-" + Date.now() + "-" + Math.random().toString(36).slice(2);

    // Create test guild config
    db.prepare(
      `INSERT OR IGNORE INTO guild_config (guild_id, review_channel_id) VALUES (?, ?)`
    ).run(testGuildId, "channel-123");

    // Create test application with known epoch timestamp
    const appId = `app-time-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testAppId = appId;

    db.prepare(
      `INSERT INTO application (id, guild_id, user_id, status, created_at, submitted_at, updated_at)
       VALUES (?, ?, ?, 'submitted', ?, ?, ?)`
    ).run(appId, testGuildId, testUserId, now - 3600, now - 3600, now - 3600);

    // Insert application responses
    db.prepare(
      `INSERT INTO application_response (app_id, q_index, question, answer)
       VALUES (?, 0, 'Test Question', 'Test Answer')`
    ).run(appId);
  });

  describe("Footer timestamps", () => {
    it("includes both absolute and relative Discord timestamps", () => {
      const app = {
        id: testAppId,
        guild_id: testGuildId,
        user_id: testUserId,
        status: "submitted" as const,
        created_at: now - 3600, // 1 hour ago
        submitted_at: now - 3600,
        updated_at: now - 3600,
        resolved_at: null,
        resolver_id: null,
        resolution_reason: null,
        userTag: "TestUser#1234",
        avatarUrl: undefined,
        lastAction: null,
      };

      const embed = renderReviewEmbed(app, [], []);
      const embedData = embed.toJSON();

      expect(embedData.footer?.text).toBeDefined();
      // PR3: Footer now uses plain text timestamps (Discord doesn't render <t:...> in footers)
      expect(embedData.footer?.text).toContain("UTC");
      expect(embedData.footer?.text).toMatch(/ago|just now/);
      expect(embedData.footer?.text).not.toMatch(/<t:/);
      expect(embedData.footer?.text).toContain("App ID:");
    });
  });

  describe("Action history field", () => {
    it("shows last 4 actions with moderator mentions and timestamps", () => {
      // Insert 5 review actions (should show only last 4)
      for (let i = 0; i < 5; i++) {
        db.prepare(
          `INSERT INTO review_action (app_id, moderator_id, action, reason, created_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(
          testAppId,
          testModId,
          i === 0 ? "approve" : "need_info",
          `Reason ${i}`,
          now - i * 600 // Spaced 10 minutes apart
        );
      }

      const recentActions = getRecentActionsForApp(testAppId, 4);
      expect(recentActions).toHaveLength(4);

      const app = {
        id: testAppId,
        guild_id: testGuildId,
        user_id: testUserId,
        status: "submitted" as const,
        created_at: now - 3600,
        submitted_at: now - 3600,
        updated_at: now - 3600,
        resolved_at: null,
        resolver_id: null,
        resolution_reason: null,
        userTag: "TestUser#1234",
        avatarUrl: undefined,
        lastAction: null,
      };

      const embed = renderReviewEmbed(
        app,
        [],
        [],
        null,
        null,
        undefined,
        null,
        null,
        recentActions
      );
      const embedData = embed.toJSON();

      const historyField = embedData.fields?.find((f) => f.name === "History (last 4)");
      expect(historyField).toBeDefined();
      expect(historyField?.value).toContain("<@" + testModId + ">");
      expect(historyField?.value).toContain("<t:");
      expect(historyField?.value).toContain(":R>");
      expect(historyField?.value).toContain(":F>");

      // Should show newest first
      expect(historyField?.value).toContain("approve");
    });

    it("truncates long reasons to 80 chars with ellipsis", () => {
      const longReason = "A".repeat(100);

      db.prepare(
        `INSERT INTO review_action (app_id, moderator_id, action, reason, created_at)
         VALUES (?, ?, 'reject', ?, ?)`
      ).run(testAppId, testModId, longReason, now - 60);

      const recentActions = getRecentActionsForApp(testAppId, 4);

      const app = {
        id: testAppId,
        guild_id: testGuildId,
        user_id: testUserId,
        status: "submitted" as const,
        created_at: now - 3600,
        submitted_at: now - 3600,
        updated_at: now - 3600,
        resolved_at: null,
        resolver_id: null,
        resolution_reason: null,
        userTag: "TestUser#1234",
        avatarUrl: undefined,
        lastAction: null,
      };

      const embed = renderReviewEmbed(
        app,
        [],
        [],
        null,
        null,
        undefined,
        null,
        null,
        recentActions
      );
      const embedData = embed.toJSON();

      const historyField = embedData.fields?.find((f) => f.name === "History (last 4)");
      expect(historyField).toBeDefined();

      // Reason should be truncated to 77 chars + "..."
      const displayedReason = historyField?.value.match(/"([^"]+)"/)?.[1];
      expect(displayedReason).toBeDefined();
      expect(displayedReason!.length).toBeLessThanOrEqual(80);
      expect(displayedReason).toContain("...");
    });

    it("shows '—' when no actions exist", () => {
      const app = {
        id: testAppId,
        guild_id: testGuildId,
        user_id: testUserId,
        status: "submitted" as const,
        created_at: now - 3600,
        submitted_at: now - 3600,
        updated_at: now - 3600,
        resolved_at: null,
        resolver_id: null,
        resolution_reason: null,
        userTag: "TestUser#1234",
        avatarUrl: undefined,
        lastAction: null,
      };

      const embed = renderReviewEmbed(app, [], [], null, null, undefined, null, null, []);
      const embedData = embed.toJSON();

      const historyField = embedData.fields?.find((f) => f.name === "History (last 4)");
      expect(historyField).toBeDefined();
      expect(historyField?.value).toBe("—");
    });
  });

  describe("Query performance", () => {
    it("returns 4 actions quickly from 1000+ rows", () => {
      // Insert 1000 actions
      const stmt = db.prepare(
        `INSERT INTO review_action (app_id, moderator_id, action, reason, created_at)
         VALUES (?, ?, ?, ?, ?)`
      );

      for (let i = 0; i < 1000; i++) {
        stmt.run(testAppId, testModId, "need_info", `Reason ${i}`, now - i);
      }

      const start = Date.now();
      const actions = getRecentActionsForApp(testAppId, 4);
      const duration = Date.now() - start;

      expect(actions).toHaveLength(4);
      // Be lenient for CI - 50ms should be more than enough
      expect(duration).toBeLessThan(50);

      // Verify newest first
      expect(actions[0].created_at).toBeGreaterThan(actions[1].created_at);
    });
  });

  describe("Claim status display", () => {
    it("shows claim status with relative time when claimed", () => {
      const claimTime = now - 300; // 5 minutes ago

      const claim = {
        app_id: testAppId,
        moderator_id: testModId,
        reviewer_id: testModId,
        claimed_at: claimTime,
      };

      const app = {
        id: testAppId,
        guild_id: testGuildId,
        user_id: testUserId,
        status: "submitted" as const,
        created_at: now - 3600,
        submitted_at: now - 3600,
        updated_at: now - 3600,
        resolved_at: null,
        resolver_id: null,
        resolution_reason: null,
        userTag: "TestUser#1234",
        avatarUrl: undefined,
        lastAction: null,
      };

      const embed = renderReviewEmbed(app, [], [], null, claim, undefined, null, null, []);
      const embedData = embed.toJSON();

      const claimField = embedData.fields?.find((f) => f.name === "Claim Status");
      expect(claimField).toBeDefined();
      expect(claimField?.value).toContain("<@" + testModId + ">");
      expect(claimField?.value).toContain("<t:");
      expect(claimField?.value).toContain(":R>");
    });
  });
});
