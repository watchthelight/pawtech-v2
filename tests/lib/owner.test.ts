/**
 * Pawtropolis Tech — tests/lib/owner.test.ts
 * WHAT: Unit tests for owner override utilities.
 * WHY: Verify owner ID checking logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("owner", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("isOwner with OWNER_IDS set", () => {
    it("returns true for owner ID", async () => {
      vi.doMock("../../src/lib/env.js", () => ({
        env: { OWNER_IDS: "123,456,789" },
      }));

      const { isOwner } = await import("../../src/lib/owner.js");

      expect(isOwner("123")).toBe(true);
      expect(isOwner("456")).toBe(true);
      expect(isOwner("789")).toBe(true);
    });

    it("returns false for non-owner ID", async () => {
      vi.doMock("../../src/lib/env.js", () => ({
        env: { OWNER_IDS: "123,456" },
      }));

      const { isOwner } = await import("../../src/lib/owner.js");

      expect(isOwner("999")).toBe(false);
      expect(isOwner("")).toBe(false);
      expect(isOwner("12")).toBe(false);
    });

    it("handles single owner ID", async () => {
      vi.doMock("../../src/lib/env.js", () => ({
        env: { OWNER_IDS: "123" },
      }));

      const { isOwner } = await import("../../src/lib/owner.js");

      expect(isOwner("123")).toBe(true);
      expect(isOwner("456")).toBe(false);
    });

    it("handles whitespace in owner IDs", async () => {
      vi.doMock("../../src/lib/env.js", () => ({
        env: { OWNER_IDS: " 123 , 456 , 789 " },
      }));

      const { isOwner } = await import("../../src/lib/owner.js");

      expect(isOwner("123")).toBe(true);
      expect(isOwner("456")).toBe(true);
      expect(isOwner("789")).toBe(true);
    });

    it("filters empty entries", async () => {
      vi.doMock("../../src/lib/env.js", () => ({
        env: { OWNER_IDS: "123,,456,,," },
      }));

      const { isOwner } = await import("../../src/lib/owner.js");

      expect(isOwner("123")).toBe(true);
      expect(isOwner("456")).toBe(true);
      expect(isOwner("")).toBe(false);
    });
  });

  describe("isOwner without OWNER_IDS", () => {
    it("returns false for any ID when OWNER_IDS is undefined", async () => {
      vi.doMock("../../src/lib/env.js", () => ({
        env: { OWNER_IDS: undefined },
      }));

      const { isOwner } = await import("../../src/lib/owner.js");

      expect(isOwner("123")).toBe(false);
      expect(isOwner("anything")).toBe(false);
    });

    it("returns false for any ID when OWNER_IDS is empty string", async () => {
      vi.doMock("../../src/lib/env.js", () => ({
        env: { OWNER_IDS: "" },
      }));

      const { isOwner } = await import("../../src/lib/owner.js");

      expect(isOwner("123")).toBe(false);
    });
  });
});
