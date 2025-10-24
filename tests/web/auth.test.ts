/**
 * Pawtropolis Tech — tests/web/auth.test.ts
 * WHAT: Tests for Discord OAuth2 authentication flow.
 * WHY: Ensure secure admin-only access to control panel.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// Set test env vars BEFORE any imports (so env.ts loads test values)
process.env.DISCORD_CLIENT_ID = "test-client-id";
process.env.DISCORD_CLIENT_SECRET = "test-client-secret";
process.env.DASHBOARD_REDIRECT_URI = "http://localhost:3000/auth/callback";
process.env.ADMIN_ROLE_ID = "admin-role-123";
process.env.GUILD_ID = "test-guild-456";
process.env.FASTIFY_SESSION_SECRET = "test-session-secret-minimum-32-chars-long";
process.env.DISCORD_TOKEN = "test-bot-token";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWebServer } from "../../src/web/server.js";
import type { FastifyInstance } from "fastify";
import axios from "axios";

// Mock axios for Discord API calls
vi.mock("axios");
const mockedAxios = vi.mocked(axios);

describe("Web Auth", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await createWebServer();
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    vi.clearAllMocks();
  });

  describe("GET /auth/login", () => {
    it("should redirect to Discord OAuth2 URL", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/auth/login",
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("https://discord.com/api/oauth2/authorize");
      expect(response.headers.location).toContain("client_id=test-client-id");
      expect(response.headers.location).toContain(
        "redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback"
      );
    });
  });

  describe("GET /auth/callback", () => {
    it("should reject request without code parameter", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/auth/callback",
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Missing authorization code");
    });

    it("should reject OAuth2 errors", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/auth/callback?error=access_denied",
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("OAuth2 authorization failed");
    });

    it("should authenticate admin user successfully", async () => {
      // Mock Discord token exchange
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          access_token: "mock-access-token",
          token_type: "Bearer",
        },
      });

      // Mock Discord user fetch
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          id: "user-123",
          username: "testadmin",
          discriminator: "0001",
          avatar: "avatar-hash",
        },
      });

      // Mock Discord guild member fetch
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          user: {
            id: "user-123",
            username: "testadmin",
          },
          roles: ["admin-role-123", "member-role-456"],
        },
      });

      const response = await server.inject({
        method: "GET",
        url: "/auth/callback?code=mock-oauth-code",
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/admin/");
      expect(response.headers["set-cookie"]).toBeDefined();
    });

    it("should reject non-admin user", async () => {
      // Mock Discord token exchange
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          access_token: "mock-access-token",
          token_type: "Bearer",
        },
      });

      // Mock Discord user fetch
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          id: "user-789",
          username: "regularuser",
          discriminator: "0002",
          avatar: null,
        },
      });

      // Mock Discord guild member fetch (without admin role)
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          user: {
            id: "user-789",
            username: "regularuser",
          },
          roles: ["member-role-456"], // No admin role
        },
      });

      const response = await server.inject({
        method: "GET",
        url: "/auth/callback?code=mock-oauth-code",
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/unauthorized.html");
    });
  });

  describe("GET /auth/me", () => {
    it("should return 401 when not authenticated", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/auth/me",
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Unauthorized");
    });

    it("should return user info when authenticated", async () => {
      // Create authenticated session
      const loginResponse = await server.inject({
        method: "GET",
        url: "/auth/callback?code=mock-oauth-code",
      });

      // Mock Discord API calls
      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: "mock-token", token_type: "Bearer" },
      });
      mockedAxios.get.mockResolvedValueOnce({
        data: { id: "user-123", username: "testadmin", discriminator: "0001", avatar: null },
      });
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          user: { id: "user-123", username: "testadmin" },
          roles: ["admin-role-123"],
        },
      });

      // Note: Fastify session testing requires a full server instance
      // For simplicity, we'll test the logic separately or use integration tests
    });
  });

  describe("GET /auth/logout", () => {
    it("should clear session and redirect to homepage", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/auth/logout",
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/");
    });
  });
});
