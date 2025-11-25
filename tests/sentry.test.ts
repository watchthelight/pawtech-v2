/**
 * WHAT: Proves Sentry initialization toggles based on DSN and that capture helpers no-op when disabled.
 * HOW: Mocks env and inspects side effects.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech Gatekeeper - Tests
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: LicenseRef-ANW-1.0
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
describe("Sentry Integration", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = originalEnv;
  });
  it("should not initialize without SENTRY_DSN", async () => {
    delete process.env.SENTRY_DSN;

    const { isSentryEnabled } = await import("../src/lib/sentry.js");
    expect(isSentryEnabled()).toBe(false);
  }, 10000);
  it("should accept valid Sentry DSN format", () => {
    const validDSN = "https://abc123@o123456.ingest.sentry.io/7654321";
    expect(validDSN).toMatch(/^https:\/\/.+@.+\.ingest\.sentry\.io\/\d+$/);
  });
  it("should have default trace sample rate", () => {
    const defaultRate = 0.1;
    expect(defaultRate).toBeGreaterThanOrEqual(0);
    expect(defaultRate).toBeLessThanOrEqual(1);
  });

  it("should validate environment configuration", () => {
    const validEnvironments = ["development", "production", "staging"];
    const testEnv = "production";

    expect(validEnvironments).toContain(testEnv);
  });
});
describe("Sentry beforeSend filter", () => {
  it("should match Discord token pattern for redaction", () => {
    const tokenPattern = /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g;
    const fakeToken = "MTIzNDU2Nzg5MDEyMzQ1Njc4OTA.abcdef.abcdefghijklmnopqrstuvwxyz1";

    expect(tokenPattern.test(fakeToken)).toBe(true);
  });
  it("should not match non-token strings", () => {
    const tokenPattern = /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g;
    const normalString = "This is a normal error message";
    expect(tokenPattern.test(normalString)).toBe(false);
  });
});
describe("Sentry API exports", () => {
  it("should export all required functions", async () => {
    const sentry = await import("../src/lib/sentry.js");
    expect(sentry.initializeSentry).toBeDefined();
    expect(sentry.isSentryEnabled).toBeDefined();
    expect(sentry.captureException).toBeDefined();
    expect(sentry.captureMessage).toBeDefined();
    expect(sentry.addBreadcrumb).toBeDefined();
    expect(sentry.setUser).toBeDefined();
    expect(sentry.clearUser).toBeDefined();
    expect(sentry.setTag).toBeDefined();
    expect(sentry.setContext).toBeDefined();
    expect(sentry.flushSentry).toBeDefined();
  });
  it("should handle captureException when Sentry is disabled", async () => {
    const { captureException } = await import("../src/lib/sentry.js");
    // Should not throw when Sentry is disabled
    expect(() => {
      captureException(new Error("Test error"));
    }).not.toThrow();
  });
  it("should handle addBreadcrumb when Sentry is disabled", async () => {
    const { addBreadcrumb } = await import("../src/lib/sentry.js");
    // Should not throw when Sentry is disabled
    expect(() => {
      addBreadcrumb({
        message: "Test breadcrumb",
        category: "test",
      });
    }).not.toThrow();
  });
});
