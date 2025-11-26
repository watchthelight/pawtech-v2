/**
 * WHAT: Proves zod environment schema validates required vars and defaults others.
 * HOW: Validates minimal and defaulted shapes.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import { z } from "zod";

/**
 * Tests for environment variable validation using Zod.
 *
 * The bot needs certain env vars to function (DISCORD_TOKEN, CLIENT_ID).
 * Others have sensible defaults or are optional. These tests verify that
 * the schema catches missing/invalid values at startup rather than failing
 * mysteriously later.
 *
 * Why test the schema separately? The actual env parsing happens at module
 * load time, which is hard to test in isolation. Testing the schema directly
 * lets us verify validation logic without touching process.env.
 */
describe("Environment Validation", () => {
  /**
   * This schema mirrors src/lib/env.ts. Keep them in sync.
   * - DISCORD_TOKEN and CLIENT_ID are required (bot can't start without them)
   * - NODE_ENV only allows "development" or "production" (no "staging", "test", etc.)
   * - Optional vars are for guild-scoped command registration and testing
   */
  const envSchema = z.object({
    DISCORD_TOKEN: z.string().min(1, "Missing DISCORD_TOKEN"),
    CLIENT_ID: z.string().min(1, "Missing CLIENT_ID"),
    GUILD_ID: z.string().optional(),
    NODE_ENV: z.enum(["development", "production"]).default("development"),
    DB_PATH: z.string().default("data/data.db"),
    TEST_GUILD_ID: z.string().optional(),
    TEST_REVIEWER_ROLE_ID: z.string().optional(),
  });

  /** Happy path: All required fields present with explicit values. */
  it("should validate complete environment", () => {
    const testEnv = {
      DISCORD_TOKEN: "test_token_123",
      CLIENT_ID: "123456789012345678",
      NODE_ENV: "development" as const,
      DB_PATH: "data/test.db",
    };

    const result = envSchema.safeParse(testEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DISCORD_TOKEN).toBe("test_token_123");
      expect(result.data.CLIENT_ID).toBe("123456789012345678");
    }
  });

  /**
   * Minimal config: Only required fields provided, defaults should kick in.
   * This is the likely scenario for a quick dev setup.
   */
  it("should apply default values", () => {
    const testEnv = {
      DISCORD_TOKEN: "test_token",
      CLIENT_ID: "123456789012345678",
    };

    const result = envSchema.safeParse(testEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe("development");
      expect(result.data.DB_PATH).toBe("data/data.db");
    }
  });

  /**
   * Edge case: Empty string should fail validation (min(1) constraint).
   * This catches the common mistake of setting DISCORD_TOKEN="" in .env.
   */
  it("should fail when required fields are missing", () => {
    const testEnv = {
      DISCORD_TOKEN: "",
      CLIENT_ID: "123456789012345678",
    };

    const result = envSchema.safeParse(testEnv);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      expect(result.error.issues[0].message).toContain("DISCORD_TOKEN");
    }
  });

  /**
   * Enum validation: NODE_ENV must be exactly "development" or "production".
   * Other values like "staging", "test", "local" are rejected.
   */
  it("should fail when NODE_ENV is invalid", () => {
    const testEnv = {
      DISCORD_TOKEN: "test_token",
      CLIENT_ID: "123456789012345678",
      NODE_ENV: "staging", // Invalid value
    };

    const result = envSchema.safeParse(testEnv);
    expect(result.success).toBe(false);
  });

  /**
   * Optional fields test: GUILD_ID and TEST_* vars are for development.
   * When present, they should pass through unchanged. When absent, no error.
   */
  it("should accept optional fields", () => {
    const testEnv = {
      DISCORD_TOKEN: "test_token",
      CLIENT_ID: "123456789012345678",
      GUILD_ID: "111222333444555666",
      TEST_GUILD_ID: "777888999000111222",
      TEST_REVIEWER_ROLE_ID: "333444555666777888",
    };

    const result = envSchema.safeParse(testEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.GUILD_ID).toBe("111222333444555666");
      expect(result.data.TEST_GUILD_ID).toBe("777888999000111222");
    }
  });
});
