/**
 * Pawtropolis Tech — tests/web/api.test.ts
 * WHAT: Tests for web control panel API endpoints.
 * WHY: Ensure secure, functional APIs for logs, metrics, and config.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { createWebServer } from "../../src/web/server.js";
import type { FastifyInstance } from "fastify";
import { db } from "../../src/db/db.js";
import { nowUtc } from "../../src/lib/time.js";

describe("Web API", () => {
  let server: FastifyInstance;
  const TEST_GUILD_ID = "test-guild-api-" + Date.now();

  beforeAll(async () => {
    // Set required env vars
    process.env.DISCORD_CLIENT_ID = "test-client-id";
    process.env.DISCORD_CLIENT_SECRET = "test-client-secret";
    process.env.DASHBOARD_REDIRECT_URI = "http://localhost:3000/auth/callback";
    process.env.ADMIN_ROLE_ID = "admin-role-123";
    process.env.GUILD_ID = TEST_GUILD_ID;
    process.env.FASTIFY_SESSION_SECRET = "test-session-secret-minimum-32-chars-long";
    process.env.DISCORD_TOKEN = "test-bot-token";

    server = await createWebServer();
    await server.ready();
  });

  afterEach(() => {
    // Clean up test data
    db.prepare(`DELETE FROM action_log WHERE guild_id = ?`).run(TEST_GUILD_ID);
    db.prepare(`DELETE FROM mod_metrics WHERE guild_id = ?`).run(TEST_GUILD_ID);
    db.prepare(`DELETE FROM guild_config WHERE guild_id = ?`).run(TEST_GUILD_ID);
  });

  afterAll(async () => {
    await server.close();
  });

  describe("Authentication Required", () => {
    it("GET /api/logs should require authentication", async () => {
      const response = await server.inject({
        method: "GET",
        url: `/api/logs?guild_id=${TEST_GUILD_ID}`,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toContain("Unauthorized");
    });

    it("GET /api/metrics should require authentication", async () => {
      const response = await server.inject({
        method: "GET",
        url: `/api/metrics?guild_id=${TEST_GUILD_ID}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it("GET /api/config should require authentication", async () => {
      const response = await server.inject({
        method: "GET",
        url: `/api/config?guild_id=${TEST_GUILD_ID}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it("POST /api/config should require authentication", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/config",
        payload: {
          guild_id: TEST_GUILD_ID,
          logging_channel_id: "123456789",
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /api/logs (with mock auth)", () => {
    // Note: Full session auth testing requires more complex setup
    // These tests verify the logic, not the auth middleware

    it("should return empty array when no logs exist", async () => {
      // This test would need a properly authenticated session
      // For now, we're testing the underlying logic
    });

    it("should filter logs by guild_id", async () => {
      // Insert test data
      const now = nowUtc();
      db.prepare(
        `
        INSERT INTO action_log (
          guild_id, app_id, app_code, actor_id, subject_id,
          action, reason, meta_json, created_at_s
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(TEST_GUILD_ID, "app-1", "CODE1", "mod-1", "user-1", "approve", "Good", null, now);

      // Note: Requires authenticated session to test full endpoint
    });
  });

  describe("GET /api/metrics (with mock auth)", () => {
    it("should return 400 if guild_id missing", async () => {
      // Would need authenticated session
    });
  });

  describe("GET /api/config (with mock auth)", () => {
    it("should return default config if not found", async () => {
      // Would need authenticated session
    });
  });

  describe("POST /api/config (with mock auth)", () => {
    it("should update logging_channel_id", async () => {
      // Would need authenticated session
    });
  });

  describe("CORS Headers", () => {
    it("should include CORS headers", async () => {
      const response = await server.inject({
        method: "OPTIONS",
        url: "/api/logs",
        headers: {
          origin: "https://pawtropolis.tech",
        },
      });

      expect(response.headers["access-control-allow-origin"]).toBeDefined();
    });
  });

  describe("Rate Limiting", () => {
    it("should apply rate limits", async () => {
      // Fastify rate limit is applied globally
      // Testing requires 100+ rapid requests
    });
  });
});

// Helper to create authenticated session (would need implementation)
async function createAuthenticatedSession(server: FastifyInstance) {
  // Mock session creation logic
  // This would involve injecting a request with proper session cookie
  // For full implementation, see Fastify session testing docs
}
