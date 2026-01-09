/**
 * Pawtropolis Tech — tests/lib/constants.test.ts
 * WHAT: Unit tests for application constants.
 * WHY: Verify constants have sensible values and types.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import {
  SAFE_ALLOWED_MENTIONS,
  DISCORD_BULK_DELETE_AGE_LIMIT_MS,
  DISCORD_COMMAND_SYNC_DELAY_MS,
  FLAG_REASON_MAX_LENGTH,
  MAX_REASON_LENGTH,
  DADMODE_ODDS_MIN,
  DADMODE_ODDS_MAX,
  SKULLMODE_ODDS_MIN,
  SKULLMODE_ODDS_MAX,
  HEALTH_CHECK_TIMEOUT_MS,
  DISCORD_RETRY_DELAY_MS,
  MESSAGE_DELETE_BATCH_DELAY_MS,
  BULK_DELETE_ITERATION_DELAY_MS,
  UNCAUGHT_EXCEPTION_EXIT_DELAY_MS,
  OAUTH_RATE_LIMIT_MAX_REQUESTS,
} from "../../src/lib/constants.js";

describe("constants", () => {
  describe("SAFE_ALLOWED_MENTIONS", () => {
    it("suppresses all mentions", () => {
      expect(SAFE_ALLOWED_MENTIONS.parse).toEqual([]);
    });
  });

  describe("Discord API constants", () => {
    it("DISCORD_BULK_DELETE_AGE_LIMIT_MS is 14 days", () => {
      const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
      expect(DISCORD_BULK_DELETE_AGE_LIMIT_MS).toBe(fourteenDaysMs);
    });

    it("DISCORD_COMMAND_SYNC_DELAY_MS is reasonable", () => {
      expect(DISCORD_COMMAND_SYNC_DELAY_MS).toBeGreaterThan(500);
      expect(DISCORD_COMMAND_SYNC_DELAY_MS).toBeLessThan(2000);
    });
  });

  describe("reason length limits", () => {
    it("FLAG_REASON_MAX_LENGTH is 512", () => {
      expect(FLAG_REASON_MAX_LENGTH).toBe(512);
    });

    it("MAX_REASON_LENGTH is 512", () => {
      expect(MAX_REASON_LENGTH).toBe(512);
    });
  });

  describe("feature odds bounds", () => {
    it("DADMODE_ODDS has valid range", () => {
      expect(DADMODE_ODDS_MIN).toBe(2);
      expect(DADMODE_ODDS_MAX).toBe(100000);
      expect(DADMODE_ODDS_MIN).toBeLessThan(DADMODE_ODDS_MAX);
    });

    it("SKULLMODE_ODDS has valid range", () => {
      expect(SKULLMODE_ODDS_MIN).toBe(1);
      expect(SKULLMODE_ODDS_MAX).toBe(1000);
      expect(SKULLMODE_ODDS_MIN).toBeLessThan(SKULLMODE_ODDS_MAX);
    });
  });

  describe("timeout constants", () => {
    it("HEALTH_CHECK_TIMEOUT_MS is reasonable", () => {
      expect(HEALTH_CHECK_TIMEOUT_MS).toBe(5000);
      expect(HEALTH_CHECK_TIMEOUT_MS).toBeGreaterThan(1000);
    });

    it("DISCORD_RETRY_DELAY_MS is reasonable", () => {
      expect(DISCORD_RETRY_DELAY_MS).toBe(2000);
    });

    it("MESSAGE_DELETE_BATCH_DELAY_MS is reasonable", () => {
      expect(MESSAGE_DELETE_BATCH_DELAY_MS).toBeGreaterThan(1000);
    });

    it("BULK_DELETE_ITERATION_DELAY_MS is reasonable", () => {
      expect(BULK_DELETE_ITERATION_DELAY_MS).toBeGreaterThanOrEqual(1000);
    });

    it("UNCAUGHT_EXCEPTION_EXIT_DELAY_MS allows Sentry flush", () => {
      expect(UNCAUGHT_EXCEPTION_EXIT_DELAY_MS).toBe(1000);
    });
  });

  describe("rate limit constants", () => {
    it("OAUTH_RATE_LIMIT_MAX_REQUESTS is reasonable", () => {
      expect(OAUTH_RATE_LIMIT_MAX_REQUESTS).toBe(10);
      expect(OAUTH_RATE_LIMIT_MAX_REQUESTS).toBeGreaterThan(0);
    });
  });
});
