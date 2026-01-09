/**
 * Pawtropolis Tech — tests/lib/ids.test.ts
 * WHAT: Unit tests for short code generation.
 * WHY: Verify consistent hex output and deterministic hashing.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import { shortCode } from "../../src/lib/ids.js";

describe("shortCode", () => {
  it("returns 6 character uppercase hex string", () => {
    const result = shortCode("123456789012345678");
    expect(result).toMatch(/^[0-9A-F]{6}$/);
    expect(result.length).toBe(6);
  });

  it("is deterministic (same input = same output)", () => {
    const id = "987654321098765432";
    const result1 = shortCode(id);
    const result2 = shortCode(id);
    expect(result1).toBe(result2);
  });

  it("produces different codes for different inputs", () => {
    const code1 = shortCode("111111111111111111");
    const code2 = shortCode("222222222222222222");
    expect(code1).not.toBe(code2);
  });

  it("handles empty string", () => {
    const result = shortCode("");
    expect(result).toMatch(/^[0-9A-F]{6}$/);
    expect(result).toBe("000000");
  });

  it("handles short strings", () => {
    const result = shortCode("a");
    expect(result).toMatch(/^[0-9A-F]{6}$/);
  });

  it("handles long strings", () => {
    const longId = "a".repeat(1000);
    const result = shortCode(longId);
    expect(result).toMatch(/^[0-9A-F]{6}$/);
  });

  it("produces uppercase hex", () => {
    const result = shortCode("test-id");
    expect(result).toBe(result.toUpperCase());
    expect(result).not.toMatch(/[a-f]/); // No lowercase hex
  });

  it("handles Discord snowflake-style IDs", () => {
    // Typical Discord snowflake
    const result = shortCode("1234567890123456789");
    expect(result).toMatch(/^[0-9A-F]{6}$/);
  });

  it("pads short hashes with zeros", () => {
    // Very short input that might produce short hash
    const result = shortCode("0");
    expect(result.length).toBe(6);
  });

  it("handles special characters", () => {
    const result = shortCode("test:special/chars#123");
    expect(result).toMatch(/^[0-9A-F]{6}$/);
  });

  it("handles unicode characters", () => {
    const result = shortCode("тест🎉日本語");
    expect(result).toMatch(/^[0-9A-F]{6}$/);
  });
});
