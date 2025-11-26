/**
 * Pawtropolis Tech — tests/logger.test.ts
 * WHAT: Unit tests for logging channel resolution with fallbacks.
 * WHY: Ensures getLoggingChannel follows priority: DB > env > null.
 *
 * The logging channel resolution follows a three-tier priority:
 * 1. Per-guild setting in DB (most specific)
 * 2. LOGGING_CHANNEL env var (deployment default)
 * 3. null (logging disabled for this guild)
 *
 * This lets operators set a global default while allowing per-guild overrides.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getLoggingChannelId, setLoggingChannelId } from "../src/config/loggingStore.js";
import { logActionJSON } from "../src/features/logger.js";

describe("Logging Channel Resolution", () => {
  // Use unique guild IDs per test to avoid cross-test pollution from DB state.
  const TEST_GUILD_ID = "test-guild-logger-" + Date.now();
  const originalEnv = process.env.LOGGING_CHANNEL;

  // Environment restoration is critical—tests modify process.env and we can't
  // leave pollution for other test files running in the same process.
  afterEach(() => {
    if (originalEnv) {
      process.env.LOGGING_CHANNEL = originalEnv;
    } else {
      delete process.env.LOGGING_CHANNEL;
    }
  });

  /**
   * Priority 2: No DB config for this guild, but env var is set.
   * This is the typical case for new guilds before admins configure logging.
   * The env var acts as a sensible default for the deployment.
   */
  it("should fall back to env LOGGING_CHANNEL when DB not set (priority 2)", () => {
    const envChannelId = "987654321";
    process.env.LOGGING_CHANNEL = envChannelId;

    // Fresh guild ID that won't have any DB config.
    const result = getLoggingChannelId("some-other-guild-" + Date.now());
    expect(result).toBe(envChannelId);
  });

  /**
   * Priority 3: Neither DB nor env configured—logging is disabled.
   * This might be intentional (private deployment) or a misconfiguration.
   * The function returns null rather than throwing, so callers must handle it.
   */
  it("should return null when neither DB nor env set (priority 3)", () => {
    delete process.env.LOGGING_CHANNEL;

    const result = getLoggingChannelId("another-guild-" + Date.now());
    expect(result).toBeNull();
  });

});

/**
 * logActionJSON outputs structured JSON for log aggregation pipelines.
 * The "module": "action_log" field lets log routers filter these events
 * separately from general application logs.
 */
describe("logActionJSON", () => {
  it("should emit structured JSON to console", () => {
    // Spy on console.log to capture output without actually printing.
    // mockImplementation(() => {}) suppresses output during test runs.
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logActionJSON({
      action: "approve",
      appId: "app-123",
      moderatorId: "mod-456",
      timestamp: 1234567890,
    });

    // Verify the JSON includes the required fields for log routing and filtering.
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"module":"action_log"'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"action":"approve"'));

    // Always restore spies to prevent interference with other tests.
    consoleSpy.mockRestore();
  });
});
