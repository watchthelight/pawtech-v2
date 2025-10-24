/**
 * Pawtropolis Tech — tests/logger.test.ts
 * WHAT: Unit tests for logging channel resolution with fallbacks.
 * WHY: Ensures getLoggingChannel follows priority: DB > env > null.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getLoggingChannelId, setLoggingChannelId } from "../src/config/loggingStore.js";
import { logActionJSON } from "../src/features/logger.js";

describe("Logging Channel Resolution", () => {
  const TEST_GUILD_ID = "test-guild-logger-" + Date.now();
  const originalEnv = process.env.LOGGING_CHANNEL;

  afterEach(() => {
    // Restore original env
    if (originalEnv) {
      process.env.LOGGING_CHANNEL = originalEnv;
    } else {
      delete process.env.LOGGING_CHANNEL;
    }
  });

  it("should return DB config when set (priority 1)", () => {
    const dbChannelId = "123456789";
    setLoggingChannelId(TEST_GUILD_ID, dbChannelId);

    const result = getLoggingChannelId(TEST_GUILD_ID);
    expect(result).toBe(dbChannelId);
  });

  it("should fall back to env LOGGING_CHANNEL when DB not set (priority 2)", () => {
    const envChannelId = "987654321";
    process.env.LOGGING_CHANNEL = envChannelId;

    // Don't set DB config for this guild
    const result = getLoggingChannelId("some-other-guild-" + Date.now());
    expect(result).toBe(envChannelId);
  });

  it("should return null when neither DB nor env set (priority 3)", () => {
    delete process.env.LOGGING_CHANNEL;

    // Don't set DB config
    const result = getLoggingChannelId("another-guild-" + Date.now());
    expect(result).toBeNull();
  });

  it("should prefer DB config over env when both set", () => {
    const dbChannelId = "111111111";
    const envChannelId = "222222222";

    setLoggingChannelId(TEST_GUILD_ID, dbChannelId);
    process.env.LOGGING_CHANNEL = envChannelId;

    const result = getLoggingChannelId(TEST_GUILD_ID);
    expect(result).toBe(dbChannelId); // DB wins
  });
});

describe("logActionJSON", () => {
  it("should emit structured JSON to console", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logActionJSON({
      action: "approve",
      appId: "app-123",
      moderatorId: "mod-456",
      timestamp: 1234567890,
    });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"module":"action_log"'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"action":"approve"'));

    consoleSpy.mockRestore();
  });
});
