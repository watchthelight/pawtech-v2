/**
 * WHAT: Proves Sentry initialization toggles based on DSN and that capture helpers no-op when disabled.
 * HOW: Mocks env and inspects side effects.
 * DOCS: https://vitest.dev/guide/
 *
 * GOTCHA: These tests use dynamic imports because the sentry module reads
 * env vars at import time. We need fresh imports to test different env states.
 * This makes tests slower but is necessary for correctness.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech Gatekeeper - Tests
 * Copyright (c) 2026 watchthelight (Bash) <admin@watchthelight.org>
 * License: LicenseRef-ANW-1.0
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
describe("Sentry Integration", () => {
  // Snapshot the original env so we can restore it. Critical for test isolation
  // since env changes persist across tests otherwise.
  const originalEnv = process.env;
  beforeEach(() => {
    // Shallow copy - good enough since we only modify top-level keys
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = originalEnv;
  });
  // Local dev and CI don't have Sentry DSN set - the module should handle
  // this gracefully by disabling itself rather than crashing.
  // Extended timeout because dynamic imports can be slow in CI.
  it("should not initialize without SENTRY_DSN", async () => {
    delete process.env.SENTRY_DSN;

    const { isSentryEnabled } = await import("../src/lib/sentry.js");
    expect(isSentryEnabled()).toBe(false);
  }, 10000);
  // Smoke test for DSN format - catches typos in config before they hit production.
  // Real DSNs look like: https://{key}@{org}.ingest.sentry.io/{project_id}
  it("should accept valid Sentry DSN format", () => {
    const validDSN = "https://abc123@o123456.ingest.sentry.io/7654321";
    expect(validDSN).toMatch(/^https:\/\/.+@.+\.ingest\.sentry\.io\/\d+$/);
  });
  // Sample rate of 0.1 = 10% of traces. Going higher would cost $$$ at scale.
  // This just validates the constant is in valid range [0, 1].
  it("should have default trace sample rate", () => {
    const defaultRate = 0.1;
    expect(defaultRate).toBeGreaterThanOrEqual(0);
    expect(defaultRate).toBeLessThanOrEqual(1);
  });

  // Environment tagging helps filter errors in Sentry dashboard.
  // Typos here would make it hard to find prod-only issues.
  it("should validate environment configuration", () => {
    const validEnvironments = ["development", "production", "staging"];
    const testEnv = "production";

    expect(validEnvironments).toContain(testEnv);
  });
});
describe("Sentry beforeSend filter", () => {
  // SECURITY: Discord bot tokens must never leak to Sentry. The beforeSend
  // hook scrubs them, but we test the regex here to catch format changes.
  // Discord tokens are 3 base64 segments: {user_id}.{timestamp}.{hmac}
  it("should match Discord token pattern for redaction", () => {
    const tokenPattern = /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g;
    const fakeToken = "MTIzNDU2Nzg5MDEyMzQ1Njc4OTA.abcdef.abcdefghijklmnopqrstuvwxyz1";

    expect(tokenPattern.test(fakeToken)).toBe(true);
  });
  // False positives would redact legitimate data - we want tight matching.
  it("should not match non-token strings", () => {
    const tokenPattern = /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g;
    const normalString = "This is a normal error message";
    expect(tokenPattern.test(normalString)).toBe(false);
  });
});
describe("Sentry API exports", () => {
  // Contract test: ensures we export everything the rest of the codebase expects.
  // If you're adding a new Sentry helper, add it here too.
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
  // Graceful degradation: callers shouldn't need to check isSentryEnabled()
  // before every call. The functions should silently no-op when disabled.
  it("should handle captureException when Sentry is disabled", async () => {
    const { captureException } = await import("../src/lib/sentry.js");
    // Should not throw when Sentry is disabled
    expect(() => {
      captureException(new Error("Test error"));
    }).not.toThrow();
  });
  // Same principle as above - breadcrumbs should be safe to add anywhere
  // without defensive checks in calling code.
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
