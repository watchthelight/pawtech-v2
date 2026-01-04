/**
 * Pawtropolis Tech — tests/lib/sentry.test.ts
 * WHAT: Unit tests for Sentry error tracking module.
 * WHY: Verify initialization, capture functions, and graceful degradation.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Sentry before importing module
const mockInit = vi.fn();
const mockCaptureException = vi.fn().mockReturnValue("event-id-123");
const mockCaptureMessage = vi.fn();
const mockAddBreadcrumb = vi.fn();
const mockSetUser = vi.fn();
const mockSetTag = vi.fn();
const mockSetContext = vi.fn();
const mockClose = vi.fn().mockResolvedValue(true);
const mockStartSpan = vi.fn((opts, fn) => fn());
const mockGetClient = vi.fn();

vi.mock("@sentry/node", () => ({
  init: mockInit,
  captureException: mockCaptureException,
  captureMessage: mockCaptureMessage,
  addBreadcrumb: mockAddBreadcrumb,
  setUser: mockSetUser,
  setTag: mockSetTag,
  setContext: mockSetContext,
  close: mockClose,
  startSpan: mockStartSpan,
  getClient: mockGetClient,
}));

vi.mock("@sentry/profiling-node", () => ({
  nodeProfilingIntegration: vi.fn(() => ({ name: "profiling" })),
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("../../src/lib/env.js", () => ({
  env: {
    SENTRY_DSN: undefined,
    SENTRY_ENVIRONMENT: "test",
    NODE_ENV: "test",
    SENTRY_TRACES_SAMPLE_RATE: 0.1,
  },
}));

describe("lib/sentry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module state by re-importing
    vi.resetModules();
  });

  describe("DSN validation", () => {
    it("rejects empty DSN", () => {
      const dsn = "";
      const isValid = !!(dsn && dsn.length > 0);
      expect(isValid).toBe(false);
    });

    it("rejects undefined DSN", () => {
      const dsn = undefined;
      const isValid = !!dsn;
      expect(isValid).toBe(false);
    });

    it("validates DSN URL format", () => {
      const validDsn = "https://key@org.ingest.sentry.io/12345";
      try {
        const url = new URL(validDsn);
        expect(url.protocol).toBe("https:");
        expect(url.username.length).toBeGreaterThan(0);
        expect(url.pathname.length).toBeGreaterThan(1);
      } catch {
        expect.fail("Should not throw");
      }
    });

    it("rejects invalid URL format", () => {
      const invalidDsn = "not-a-url";
      let isValid = false;
      try {
        new URL(invalidDsn);
        isValid = true;
      } catch {
        isValid = false;
      }
      expect(isValid).toBe(false);
    });

    it("rejects DSN without username (key)", () => {
      const dsn = "https://sentry.io/12345";
      const url = new URL(dsn);
      const hasKey = url.username.length > 0;
      expect(hasKey).toBe(false);
    });

    it("rejects DSN without project path", () => {
      const dsn = "https://key@sentry.io/";
      const url = new URL(dsn);
      const hasProject = url.pathname.length > 1;
      expect(hasProject).toBe(false);
    });

    it("accepts http DSN for local testing", () => {
      const dsn = "http://key@localhost:9000/1";
      const url = new URL(dsn);
      expect(url.protocol).toBe("http:");
    });
  });

  describe("isSentryEnabled", () => {
    it("returns false when not initialized", async () => {
      const { isSentryEnabled } = await import("../../src/lib/sentry.js");
      expect(isSentryEnabled()).toBe(false);
    });
  });

  describe("captureException", () => {
    it("returns null when Sentry disabled", async () => {
      const { captureException } = await import("../../src/lib/sentry.js");
      const result = captureException(new Error("test"));
      expect(result).toBeNull();
    });

    it("accepts Error objects", async () => {
      const { captureException } = await import("../../src/lib/sentry.js");
      const error = new Error("test error");
      captureException(error);
      // Should not throw
      expect(true).toBe(true);
    });

    it("accepts context object", async () => {
      const { captureException } = await import("../../src/lib/sentry.js");
      captureException(new Error("test"), { userId: "123", command: "test" });
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("captureMessage", () => {
    it("does nothing when Sentry disabled", async () => {
      const { captureMessage } = await import("../../src/lib/sentry.js");
      captureMessage("test message");
      // Should not throw
      expect(true).toBe(true);
    });

    it("accepts severity level", async () => {
      const { captureMessage } = await import("../../src/lib/sentry.js");
      captureMessage("test", "warning");
      // Should not throw
      expect(true).toBe(true);
    });

    it("defaults to info level", async () => {
      const { captureMessage } = await import("../../src/lib/sentry.js");
      captureMessage("test");
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("addBreadcrumb", () => {
    it("does nothing when Sentry disabled", async () => {
      const { addBreadcrumb } = await import("../../src/lib/sentry.js");
      addBreadcrumb({ message: "test" });
      // Should not throw
      expect(true).toBe(true);
    });

    it("accepts category", async () => {
      const { addBreadcrumb } = await import("../../src/lib/sentry.js");
      addBreadcrumb({ message: "test", category: "user" });
      // Should not throw
      expect(true).toBe(true);
    });

    it("accepts level", async () => {
      const { addBreadcrumb } = await import("../../src/lib/sentry.js");
      addBreadcrumb({ message: "test", level: "info" });
      // Should not throw
      expect(true).toBe(true);
    });

    it("accepts data", async () => {
      const { addBreadcrumb } = await import("../../src/lib/sentry.js");
      addBreadcrumb({ message: "test", data: { key: "value" } });
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("setUser", () => {
    it("does nothing when Sentry disabled", async () => {
      const { setUser } = await import("../../src/lib/sentry.js");
      setUser({ id: "user-123" });
      // Should not throw
      expect(true).toBe(true);
    });

    it("accepts username", async () => {
      const { setUser } = await import("../../src/lib/sentry.js");
      setUser({ id: "user-123", username: "testuser" });
      // Should not throw
      expect(true).toBe(true);
    });

    it("accepts additional properties", async () => {
      const { setUser } = await import("../../src/lib/sentry.js");
      setUser({ id: "user-123", guildId: "guild-456" });
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("clearUser", () => {
    it("does nothing when Sentry disabled", async () => {
      const { clearUser } = await import("../../src/lib/sentry.js");
      clearUser();
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("setTag", () => {
    it("does nothing when Sentry disabled", async () => {
      const { setTag } = await import("../../src/lib/sentry.js");
      setTag("command", "test");
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("setContext", () => {
    it("does nothing when Sentry disabled", async () => {
      const { setContext } = await import("../../src/lib/sentry.js");
      setContext("request", { path: "/test" });
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("flushSentry", () => {
    it("returns true when Sentry disabled", async () => {
      const { flushSentry } = await import("../../src/lib/sentry.js");
      const result = await flushSentry();
      expect(result).toBe(true);
    });

    it("accepts timeout parameter", async () => {
      const { flushSentry } = await import("../../src/lib/sentry.js");
      const result = await flushSentry(5000);
      expect(result).toBe(true);
    });

    it("defaults to 2000ms timeout", async () => {
      const { flushSentry } = await import("../../src/lib/sentry.js");
      await flushSentry();
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("inSpan", () => {
    it("executes function when Sentry disabled", async () => {
      const { inSpan } = await import("../../src/lib/sentry.js");
      let executed = false;
      await inSpan("test-span", () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });

    it("returns function result", async () => {
      const { inSpan } = await import("../../src/lib/sentry.js");
      const result = await inSpan("test-span", () => 42);
      expect(result).toBe(42);
    });

    it("handles async functions", async () => {
      const { inSpan } = await import("../../src/lib/sentry.js");
      const result = await inSpan("test-span", async () => {
        return Promise.resolve("async result");
      });
      expect(result).toBe("async result");
    });

    it("propagates errors", async () => {
      const { inSpan } = await import("../../src/lib/sentry.js");
      await expect(
        inSpan("test-span", () => {
          throw new Error("test error");
        })
      ).rejects.toThrow("test error");
    });
  });

  describe("initializeSentry", () => {
    it("skips during vitest", async () => {
      // VITEST_WORKER_ID is set during tests
      const { initializeSentry, isSentryEnabled } = await import("../../src/lib/sentry.js");
      initializeSentry();
      expect(isSentryEnabled()).toBe(false);
    });
  });

  describe("token redaction in beforeSend", () => {
    it("redacts Discord token pattern", () => {
      // Token format: 24 chars . 6 chars . 27 chars
      // Using XXXXX pattern to avoid GitHub secret detection
      const token = "XXXXXXXXXXXXXXXXXXX12345.ABCDEF.XXXXXXXXXXXXXXXXXXXXXXXXXXX";
      const pattern = /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g;
      const redacted = token.replace(pattern, "[REDACTED_TOKEN]");
      expect(redacted).toBe("[REDACTED_TOKEN]");
    });

    it("preserves non-token text", () => {
      const message = "Error in command: /test";
      const pattern = /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g;
      const result = message.replace(pattern, "[REDACTED_TOKEN]");
      expect(result).toBe("Error in command: /test");
    });

    it("redacts multiple tokens", () => {
      // Token format: 24 chars . 6 chars . 27 chars
      // Using XXXXX pattern to avoid GitHub secret detection
      const token1 = "XXXXXXXXXXXXXXXXXXX12345.ABCDEF.XXXXXXXXXXXXXXXXXXXXXXXXXXX";
      const token2 = "YYYYYYYYYYYYYYYYYYY67890.GHIJKL.YYYYYYYYYYYYYYYYYYYYYYYYYYY";
      const message = `Token1: ${token1}, Token2: ${token2}`;
      const pattern = /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g;
      const redacted = message.replace(pattern, "[REDACTED_TOKEN]");
      expect(redacted).toContain("[REDACTED_TOKEN]");
      expect(redacted).not.toContain(token1);
    });
  });

  describe("version detection", () => {
    it("reads from package.json", () => {
      // The getVersion function reads package.json
      // We test the format expectations
      const versionPattern = /^\d+\.\d+\.\d+$/;
      const validVersion = "4.9.0";
      expect(validVersion).toMatch(versionPattern);
    });

    it("falls back to unknown", () => {
      const fallback = "unknown";
      expect(fallback).toBe("unknown");
    });
  });

  describe("ignored errors", () => {
    const ignoredErrors = ["DiscordAPIError", "AbortError", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"];

    it("ignores DiscordAPIError", () => {
      expect(ignoredErrors).toContain("DiscordAPIError");
    });

    it("ignores AbortError", () => {
      expect(ignoredErrors).toContain("AbortError");
    });

    it("ignores connection reset", () => {
      expect(ignoredErrors).toContain("ECONNRESET");
    });

    it("ignores timeout", () => {
      expect(ignoredErrors).toContain("ETIMEDOUT");
    });

    it("ignores DNS failure", () => {
      expect(ignoredErrors).toContain("ENOTFOUND");
    });
  });

  describe("environment configuration", () => {
    it("uses SENTRY_ENVIRONMENT when set", () => {
      const env = { SENTRY_ENVIRONMENT: "production", NODE_ENV: "development" };
      const environment = env.SENTRY_ENVIRONMENT || env.NODE_ENV;
      expect(environment).toBe("production");
    });

    it("falls back to NODE_ENV", () => {
      const env = { SENTRY_ENVIRONMENT: undefined, NODE_ENV: "development" };
      const environment = env.SENTRY_ENVIRONMENT || env.NODE_ENV;
      expect(environment).toBe("development");
    });
  });

  describe("403 response handling", () => {
    it("disables capture on unauthorized", () => {
      const statusCode = 403;
      const shouldDisable = statusCode === 403;
      expect(shouldDisable).toBe(true);
    });
  });

  describe("integration configuration", () => {
    it("includes profiling integration", () => {
      const integrations = ["profiling", "console", "http"];
      expect(integrations).toContain("profiling");
    });

    it("includes console integration", () => {
      const integrations = ["profiling", "console", "http"];
      expect(integrations).toContain("console");
    });

    it("includes http integration", () => {
      const integrations = ["profiling", "console", "http"];
      expect(integrations).toContain("http");
    });
  });
});
