/**
 * Pawtropolis Tech — tests/dashboard.test.ts
 * WHAT: Integration tests for dashboard JSON feed endpoint.
 * WHY: Ensures GET /logs/dashboard.json returns correct shape and filters.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { startDashboardServer } from "../src/server/dashboard.js";
import { db } from "../src/db/db.js";
import { nowUtc } from "../src/lib/time.js";

describe("Dashboard API", () => {
  let server: http.Server;
  const TEST_PORT = 3333; // Use different port to avoid conflicts
  const BASE_URL = `http://localhost:${TEST_PORT}`;

  beforeAll(async () => {
    // Start server
    server = startDashboardServer(TEST_PORT);

    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Insert test data
    const testGuildId = "test-guild-dashboard";
    const testActorId = "test-actor-123";
    const testSubjectId = "test-subject-456";
    const now = nowUtc();

    for (let i = 0; i < 5; i++) {
      db.prepare(
        `
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        testGuildId,
        `app-${i}`,
        `CODE${i}`,
        testActorId,
        testSubjectId,
        i % 2 === 0 ? "approve" : "claim",
        `Test reason ${i}`,
        JSON.stringify({ test: true, index: i }),
        now - i * 10
      );
    }
  });

  afterAll(() => {
    // Clean up test data
    db.prepare(`DELETE FROM action_log WHERE guild_id = 'test-guild-dashboard'`).run();

    // Close server
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("should return recent action logs", async () => {
    const response = await fetch(`${BASE_URL}/logs/dashboard.json`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("items");
    expect(data).toHaveProperty("count");
    expect(Array.isArray(data.items)).toBe(true);
  });

  it("should respect limit parameter", async () => {
    const response = await fetch(`${BASE_URL}/logs/dashboard.json?limit=2`);
    const data = await response.json();

    expect(data.count).toBeLessThanOrEqual(2);
    expect(data.limit).toBe(2);
  });

  it("should filter by action type", async () => {
    const response = await fetch(`${BASE_URL}/logs/dashboard.json?action=approve`);
    const data = await response.json();

    const testGuildActions = data.items.filter(
      (item: any) => item.guild_id === "test-guild-dashboard"
    );

    // Should only include approve actions
    testGuildActions.forEach((item: any) => {
      expect(item.action).toBe("approve");
    });
  });

  it("should include correct fields in response", async () => {
    const response = await fetch(`${BASE_URL}/logs/dashboard.json?limit=1`);
    const data = await response.json();

    if (data.items.length > 0) {
      const item = data.items[0];
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("action");
      expect(item).toHaveProperty("timestamp");
      expect(item).toHaveProperty("guild_id");
      expect(item).toHaveProperty("moderator_id");
      expect(item).toHaveProperty("app_id");
    }
  });

  it("should return 200 for health check", async () => {
    const response = await fetch(`${BASE_URL}/health`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe("ok");
  });

  it("should return 404 for unknown routes", async () => {
    const response = await fetch(`${BASE_URL}/unknown`);
    expect(response.status).toBe(404);
  });

  it("should handle CORS preflight", async () => {
    const response = await fetch(`${BASE_URL}/logs/dashboard.json`, {
      method: "OPTIONS",
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
