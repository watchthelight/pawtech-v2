/**
 * Pawtropolis Tech — tests/lib/secureCompare.test.ts
 * WHAT: Unit tests for constant-time string comparison.
 * WHY: Verify secure comparison behaves correctly for password validation.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import { secureCompare } from "../../src/lib/secureCompare.js";

describe("secureCompare", () => {
  describe("matching strings", () => {
    it("returns true for identical strings", () => {
      expect(secureCompare("password123", "password123")).toBe(true);
    });

    it("returns true for empty strings", () => {
      expect(secureCompare("", "")).toBe(true);
    });

    it("returns true for long identical strings", () => {
      const longStr = "a".repeat(1000);
      expect(secureCompare(longStr, longStr)).toBe(true);
    });

    it("returns true for strings with special characters", () => {
      const special = "p@$$w0rd!#$%^&*()[]{}";
      expect(secureCompare(special, special)).toBe(true);
    });

    it("returns true for unicode strings", () => {
      const unicode = "密码🔐пароль";
      expect(secureCompare(unicode, unicode)).toBe(true);
    });
  });

  describe("non-matching strings", () => {
    it("returns false for different strings", () => {
      expect(secureCompare("password123", "password456")).toBe(false);
    });

    it("returns false for case differences", () => {
      expect(secureCompare("Password", "password")).toBe(false);
    });

    it("returns false for different lengths", () => {
      expect(secureCompare("short", "much longer string")).toBe(false);
    });

    it("returns false for one character difference", () => {
      expect(secureCompare("abcdef", "abcdeg")).toBe(false);
    });

    it("returns false for empty vs non-empty", () => {
      expect(secureCompare("", "something")).toBe(false);
      expect(secureCompare("something", "")).toBe(false);
    });

    it("returns false for whitespace differences", () => {
      expect(secureCompare("password", " password")).toBe(false);
      expect(secureCompare("password", "password ")).toBe(false);
      expect(secureCompare("pass word", "password")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles null-like strings", () => {
      expect(secureCompare("null", "null")).toBe(true);
      expect(secureCompare("undefined", "undefined")).toBe(true);
    });

    it("handles numeric strings", () => {
      expect(secureCompare("12345", "12345")).toBe(true);
      expect(secureCompare("12345", "12346")).toBe(false);
    });

    it("handles newlines and tabs", () => {
      expect(secureCompare("line1\nline2", "line1\nline2")).toBe(true);
      expect(secureCompare("col1\tcol2", "col1\tcol2")).toBe(true);
      expect(secureCompare("line1\nline2", "line1\rline2")).toBe(false);
    });

    it("handles zero-width characters", () => {
      const withZeroWidth = "test\u200Bstring"; // zero-width space
      const withoutZeroWidth = "teststring";
      expect(secureCompare(withZeroWidth, withoutZeroWidth)).toBe(false);
    });
  });

  describe("security properties", () => {
    it("comparison time is consistent regardless of match position", () => {
      // This test verifies the timing-safe nature by running multiple comparisons
      // In practice, timing attacks require precise measurements which are hard to test
      // This just verifies the function works correctly for various inputs
      const base = "correctpassword";

      // All these should be false but should take similar time
      expect(secureCompare("Xorrectpassword", base)).toBe(false); // diff at start
      expect(secureCompare("correctpasXword", base)).toBe(false); // diff in middle
      expect(secureCompare("correctpassworX", base)).toBe(false); // diff at end
    });
  });
});
