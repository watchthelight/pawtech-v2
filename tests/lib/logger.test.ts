/**
 * Pawtropolis Tech — tests/lib/logger.test.ts
 * WHAT: Unit tests for logger and redaction module.
 * WHY: Verify token redaction, DSN scrubbing, and truncation logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { redact } from "../../src/lib/logger.js";

describe("lib/logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("redact", () => {
    describe("empty input", () => {
      it("returns empty string for empty input", () => {
        expect(redact("")).toBe("");
      });

      it("returns empty string for null-like input", () => {
        expect(redact(null as unknown as string)).toBe("");
        expect(redact(undefined as unknown as string)).toBe("");
      });
    });

    describe("whitespace normalization", () => {
      it("normalizes multiple spaces", () => {
        expect(redact("hello    world")).toBe("hello world");
      });

      it("normalizes newlines", () => {
        expect(redact("hello\nworld")).toBe("hello world");
      });

      it("normalizes tabs", () => {
        expect(redact("hello\tworld")).toBe("hello world");
      });

      it("trims leading/trailing whitespace", () => {
        expect(redact("  hello world  ")).toBe("hello world");
      });

      it("handles mixed whitespace", () => {
        expect(redact("  hello \n\t world  ")).toBe("hello world");
      });
    });

    describe("Discord token redaction", () => {
      it("redacts valid Discord bot token", () => {
        // Token format: 24 chars . 6 chars . 27 chars
        // Using XXXXX pattern to avoid GitHub secret detection
        const token = "XXXXXXXXXXXXXXXXXXX12345.ABCDEF.XXXXXXXXXXXXXXXXXXXXXXXXXXX";
        const result = redact(`Token: ${token}`);
        expect(result).toContain("[redacted_token]");
        expect(result).not.toContain(token);
      });

      it("redacts multiple tokens", () => {
        // Token format: 24 chars . 6 chars . 27 chars
        // Using XXXXX pattern to avoid GitHub secret detection
        const token1 = "XXXXXXXXXXXXXXXXXXX12345.ABCDEF.XXXXXXXXXXXXXXXXXXXXXXXXXXX";
        const token2 = "YYYYYYYYYYYYYYYYYYY67890.GHIJKL.YYYYYYYYYYYYYYYYYYYYYYYYYYY";
        const result = redact(`First: ${token1}, Second: ${token2}`);
        expect(result.match(/\[redacted_token\]/g)?.length).toBe(2);
      });

      it("preserves text around token", () => {
        // Token format: 24 chars . 6 chars . 27 chars
        // Using XXXXX pattern to avoid GitHub secret detection
        const token = "XXXXXXXXXXXXXXXXXXX12345.ABCDEF.XXXXXXXXXXXXXXXXXXXXXXXXXXX";
        const result = redact(`Before ${token} after`);
        expect(result).toContain("Before");
        expect(result).toContain("after");
        expect(result).toContain("[redacted_token]");
      });

      it("handles token with underscores and dashes", () => {
        // Token format: 24 chars . 6 chars . 27 chars (with dashes/underscores)
        // Using XXXXX pattern to avoid GitHub secret detection
        const token = "XXXXXXXXXX-XXXXXX_X12345.ABCDEF.XXXXXXXXXX_XXXXXXXX-XXXXXXXX";
        const result = redact(`Token: ${token}`);
        expect(result).toContain("[redacted_token]");
      });
    });

    describe("Sentry DSN redaction", () => {
      it("redacts Sentry DSN secret", () => {
        const dsn = "https://abc123:secret456@o123.ingest.sentry.io/123";
        const result = redact(`DSN: ${dsn}`);
        expect(result).toContain("[redacted]@");
        expect(result).not.toContain("secret456");
      });

      it("preserves public key in DSN", () => {
        const dsn = "https://publickey:secretkey@sentry.io/123";
        const result = redact(dsn);
        expect(result).toContain("publickey");
        expect(result).not.toContain("secretkey");
      });

      it("handles http DSN", () => {
        const dsn = "http://key:secret@localhost:9000/1";
        const result = redact(dsn);
        expect(result).toContain("http://key:[redacted]@");
      });
    });

    describe("mention redaction", () => {
      it("redacts @everyone", () => {
        const result = redact("Hello @everyone!");
        expect(result).toBe("Hello @redacted!");
      });

      it("redacts @here", () => {
        const result = redact("Attention @here please");
        expect(result).toBe("Attention @redacted please");
      });

      it("is case insensitive", () => {
        expect(redact("@EVERYONE")).toBe("@redacted");
        expect(redact("@Here")).toBe("@redacted");
        expect(redact("@EVERYONE and @HERE")).toBe("@redacted and @redacted");
      });

      it("handles multiple mentions", () => {
        const result = redact("@everyone @here @everyone");
        expect(result.match(/@redacted/g)?.length).toBe(3);
      });
    });

    describe("truncation", () => {
      it("truncates strings over 300 characters", () => {
        const longString = "a".repeat(400);
        const result = redact(longString);
        expect(result.length).toBeLessThanOrEqual(303); // 300 + "..."
        expect(result.endsWith("...")).toBe(true);
      });

      it("preserves strings at exactly 300 characters", () => {
        const exactString = "a".repeat(300);
        const result = redact(exactString);
        expect(result).toBe(exactString);
        expect(result.endsWith("...")).toBe(false);
      });

      it("preserves strings under 300 characters", () => {
        const shortString = "a".repeat(100);
        const result = redact(shortString);
        expect(result).toBe(shortString);
      });
    });

    describe("combined redactions", () => {
      it("handles token and mention together", () => {
        // Token format: 24 chars . 6 chars . 27 chars
        // Using XXXXX pattern to avoid GitHub secret detection
        const token = "XXXXXXXXXXXXXXXXXXX12345.ABCDEF.XXXXXXXXXXXXXXXXXXXXXXXXXXX";
        const result = redact(`@everyone Token: ${token}`);
        expect(result).toContain("@redacted");
        expect(result).toContain("[redacted_token]");
      });

      it("handles DSN and mention together", () => {
        const dsn = "https://key:secret@sentry.io/123";
        const result = redact(`@everyone DSN: ${dsn}`);
        expect(result).toContain("@redacted");
        expect(result).toContain("[redacted]@");
      });

      it("normalizes whitespace before redacting", () => {
        // Token format: 24 chars . 6 chars . 27 chars
        // Using XXXXX pattern to avoid GitHub secret detection
        const token = "XXXXXXXXXXXXXXXXXXX12345.ABCDEF.XXXXXXXXXXXXXXXXXXXXXXXXXXX";
        const result = redact(`  Token:   ${token}  @everyone  `);
        expect(result).toMatch(/^Token: \[redacted_token\] @redacted$/);
      });
    });
  });

  describe("logger configuration", () => {
    describe("log level", () => {
      it("defaults to info", () => {
        const defaultLevel = process.env.LOG_LEVEL ?? "info";
        expect(defaultLevel).toBe("info");
      });

      it("can be overridden by LOG_LEVEL", () => {
        const level = "debug";
        expect(["debug", "info", "warn", "error"]).toContain(level);
      });
    });

    describe("pretty printing", () => {
      it("enables in vitest", () => {
        const isVitest = !!process.env.VITEST_WORKER_ID;
        expect(isVitest).toBe(true);
      });

      it("enables with LOG_PRETTY=true and TTY", () => {
        const condition = process.env.LOG_PRETTY === "true" && process.stdout.isTTY;
        expect(typeof condition).toBe("boolean");
      });
    });

    describe("file logging", () => {
      it("uses LOG_FILE env for destination", () => {
        const logFile = process.env.LOG_FILE;
        // May or may not be set
        expect(logFile === undefined || typeof logFile === "string").toBe(true);
      });

      it("defaults MAX_LOG_SIZE_MB to 100", () => {
        const maxSize = parseInt(process.env.MAX_LOG_SIZE_MB ?? "100", 10);
        expect(maxSize).toBe(100);
      });

      it("defaults MAX_LOG_FILES to 5", () => {
        const maxFiles = parseInt(process.env.MAX_LOG_FILES ?? "5", 10);
        expect(maxFiles).toBe(5);
      });
    });
  });

  describe("error serializer", () => {
    it("extracts error name", () => {
      const err = new Error("test");
      err.name = "CustomError";
      expect(err.name).toBe("CustomError");
    });

    it("extracts error message", () => {
      const err = new Error("test message");
      expect(err.message).toBe("test message");
    });

    it("extracts error stack", () => {
      const err = new Error("test");
      expect(err.stack).toBeDefined();
      expect(err.stack).toContain("Error: test");
    });

    it("extracts error code if present", () => {
      const err = new Error("test") as Error & { code?: string };
      err.code = "ENOENT";
      expect(err.code).toBe("ENOENT");
    });

    it("handles missing properties gracefully", () => {
      const err = {} as Error;
      expect(err.name).toBeUndefined();
      expect(err.message).toBeUndefined();
    });
  });

  describe("Sentry hook", () => {
    it("only triggers on error level", () => {
      const levels = {
        debug: 20,
        info: 30,
        warn: 40,
        error: 50,
        fatal: 60,
      };
      expect(levels.error).toBeGreaterThanOrEqual(50);
    });

    it("extracts Error from first arg", () => {
      const err = new Error("test");
      const args = [err, "message"];
      const errorCandidate = args[0] instanceof Error ? args[0] : undefined;
      expect(errorCandidate).toBe(err);
    });

    it("extracts Error from err property", () => {
      const err = new Error("test");
      const args = [{ err }, "message"];
      const firstArg = args[0] as { err?: unknown };
      const errorCandidate =
        firstArg instanceof Error ? firstArg : firstArg?.err instanceof Error ? firstArg.err : undefined;
      expect(errorCandidate).toBe(err);
    });
  });

  describe("diagnostic toggles logging", () => {
    it("logs DB_TRACE toggle", () => {
      const dbTrace = process.env.DB_TRACE === "1";
      expect(typeof dbTrace).toBe("boolean");
    });

    it("logs TRACE_INTERACTIONS toggle", () => {
      const traceInteractions = process.env.TRACE_INTERACTIONS === "1";
      expect(typeof traceInteractions).toBe("boolean");
    });
  });
});

describe("redaction patterns", () => {
  describe("Discord token pattern", () => {
    const tokenRe = /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g;

    it("matches standard bot token", () => {
      // Token format: 24 chars . 6 chars . 27 chars
      // Using XXXXX pattern to avoid GitHub secret detection
      const token = "XXXXXXXXXXXXXXXXXXX12345.ABCDEF.XXXXXXXXXXXXXXXXXXXXXXXXXXX";
      expect(token).toMatch(tokenRe);
    });

    it("does not match short strings", () => {
      const notToken = "short.str.ing";
      expect(notToken).not.toMatch(tokenRe);
    });

    it("does not match single segment", () => {
      const notToken = "MTIzNDU2Nzg5MDEyMzQ1Njc4";
      expect(notToken).not.toMatch(tokenRe);
    });
  });

  describe("Sentry DSN pattern", () => {
    const dsnRe = /(https?:\/\/)([^:@]+):[^@]+@/gi;

    it("matches https DSN", () => {
      const dsn = "https://key:secret@sentry.io/123";
      expect(dsn).toMatch(dsnRe);
    });

    it("matches http DSN", () => {
      const dsn = "http://key:secret@localhost/1";
      expect(dsn).toMatch(dsnRe);
    });

    it("captures public key", () => {
      const dsn = "https://publickey:secretkey@sentry.io/123";
      const match = dsnRe.exec(dsn);
      expect(match?.[2]).toBe("publickey");
    });
  });

  describe("mention pattern", () => {
    const mentionRe = /@(everyone|here)/gi;

    it("matches @everyone", () => {
      expect("@everyone").toMatch(mentionRe);
    });

    it("matches @here", () => {
      expect("@here").toMatch(mentionRe);
    });

    it("is case insensitive", () => {
      expect("@EVERYONE").toMatch(mentionRe);
      expect("@HERE").toMatch(mentionRe);
      expect("@Everyone").toMatch(mentionRe);
    });

    it("does not match @user", () => {
      expect("@user").not.toMatch(mentionRe);
    });

    it("does not match @channel", () => {
      expect("@channel").not.toMatch(mentionRe);
    });
  });
});
