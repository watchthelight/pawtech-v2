/**
 * WHAT: Proves zod environment schema validates required vars and defaults others.
 * HOW: Validates minimal and defaulted shapes.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import { z } from "zod";

describe("Environment Validation", () => {
  const envSchema = z.object({
    DISCORD_TOKEN: z.string().min(1, "Missing DISCORD_TOKEN"),
    CLIENT_ID: z.string().min(1, "Missing CLIENT_ID"),
    GUILD_ID: z.string().optional(),
    NODE_ENV: z.enum(["development", "production"]).default("development"),
    DB_PATH: z.string().default("data/data.db"),
    TEST_GUILD_ID: z.string().optional(),
    TEST_REVIEWER_ROLE_ID: z.string().optional(),
  });

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

  it("should fail when NODE_ENV is invalid", () => {
    const testEnv = {
      DISCORD_TOKEN: "test_token",
      CLIENT_ID: "123456789012345678",
      NODE_ENV: "staging", // Invalid value
    };

    const result = envSchema.safeParse(testEnv);
    expect(result.success).toBe(false);
  });

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
