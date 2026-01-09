/**
 * Pawtropolis Tech — tests/commands/help/metadata.test.ts
 * WHAT: Unit tests for help metadata types and utilities.
 * WHY: Verify custom ID parsing/building and category constants.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  CATEGORY_INFO,
  parseHelpCustomId,
  buildHelpCustomId,
  COMMANDS_PER_PAGE,
  MAX_SELECT_OPTIONS,
  MAX_BUTTONS_PER_ROW,
  MAX_ROWS,
  type CommandCategory,
  type PermissionLevel,
  type HelpNavigation,
} from "../../../src/commands/help/metadata.js";

describe("help/metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("CATEGORY_INFO", () => {
    const allCategories: CommandCategory[] = [
      "gate",
      "config",
      "moderation",
      "queue",
      "analytics",
      "messaging",
      "roles",
      "artist",
      "system",
    ];

    it("has entries for all 9 categories", () => {
      expect(Object.keys(CATEGORY_INFO)).toHaveLength(9);
    });

    it.each(allCategories)("has entry for %s category", (category) => {
      expect(CATEGORY_INFO[category]).toBeDefined();
    });

    it.each(allCategories)("%s has emoji field defined", (category) => {
      expect(CATEGORY_INFO[category].emoji).toBeDefined();
      // Emoji field exists (may be empty string in some configs)
      expect(typeof CATEGORY_INFO[category].emoji).toBe("string");
    });

    it.each(allCategories)("%s has label", (category) => {
      expect(CATEGORY_INFO[category].label).toBeDefined();
      expect(CATEGORY_INFO[category].label.length).toBeGreaterThan(0);
    });

    it.each(allCategories)("%s has description", (category) => {
      expect(CATEGORY_INFO[category].description).toBeDefined();
      expect(CATEGORY_INFO[category].description.length).toBeGreaterThan(0);
    });

    it("gate category has tip", () => {
      expect(CATEGORY_INFO.gate.tip).toBeDefined();
      expect(CATEGORY_INFO.gate.tip).toContain("listopen");
    });

    it("config category has tip", () => {
      expect(CATEGORY_INFO.config.tip).toBeDefined();
      expect(CATEGORY_INFO.config.tip).toContain("config view");
    });

    it("moderation category has tip", () => {
      expect(CATEGORY_INFO.moderation.tip).toBeDefined();
      expect(CATEGORY_INFO.moderation.tip).toContain("flag");
    });

    it("queue category has tip", () => {
      expect(CATEGORY_INFO.queue.tip).toBeDefined();
      expect(CATEGORY_INFO.queue.tip).toContain("search");
    });

    it("analytics category has tip", () => {
      expect(CATEGORY_INFO.analytics.tip).toBeDefined();
      expect(CATEGORY_INFO.analytics.tip).toContain("stats");
    });

    it("messaging category has tip", () => {
      expect(CATEGORY_INFO.messaging.tip).toBeDefined();
      expect(CATEGORY_INFO.messaging.tip).toContain("send");
    });

    it("roles category has tip", () => {
      expect(CATEGORY_INFO.roles.tip).toBeDefined();
      expect(CATEGORY_INFO.roles.tip).toContain("panic");
    });

    it("artist category has tip", () => {
      expect(CATEGORY_INFO.artist.tip).toBeDefined();
      expect(CATEGORY_INFO.artist.tip).toContain("artistqueue");
    });

    it("system category has tip", () => {
      expect(CATEGORY_INFO.system.tip).toBeDefined();
      expect(CATEGORY_INFO.system.tip).toContain("health");
    });
  });

  describe("parseHelpCustomId", () => {
    describe("overview", () => {
      it("parses 'help:overview' correctly", () => {
        const result = parseHelpCustomId("help:overview");
        expect(result).toEqual({ type: "overview" });
      });
    });

    describe("category", () => {
      it("parses 'help:cat:<category>' without page", () => {
        const result = parseHelpCustomId("help:cat:gate");
        expect(result).toEqual({ type: "category", category: "gate", page: 0 });
      });

      it("parses 'help:cat:<category>:p<page>' with page", () => {
        const result = parseHelpCustomId("help:cat:moderation:p2");
        expect(result).toEqual({
          type: "category",
          category: "moderation",
          page: 2,
        });
      });

      it("parses page 0 explicitly", () => {
        const result = parseHelpCustomId("help:cat:config:p0");
        expect(result).toEqual({ type: "category", category: "config", page: 0 });
      });

      it("parses double-digit page numbers", () => {
        const result = parseHelpCustomId("help:cat:roles:p15");
        expect(result).toEqual({ type: "category", category: "roles", page: 15 });
      });

      it("returns null for invalid category", () => {
        const result = parseHelpCustomId("help:cat:notacategory");
        expect(result).toBeNull();
      });

      it.each(["gate", "config", "moderation", "queue", "analytics", "messaging", "roles", "artist", "system"])(
        "parses %s category correctly",
        (category) => {
          const result = parseHelpCustomId(`help:cat:${category}`);
          expect(result).toEqual({ type: "category", category, page: 0 });
        }
      );
    });

    describe("command", () => {
      it("parses 'help:cmd:<name>' without full flag", () => {
        const result = parseHelpCustomId("help:cmd:accept");
        expect(result).toEqual({ type: "command", name: "accept", full: false });
      });

      it("parses 'help:cmd:<name>:full' with full flag", () => {
        const result = parseHelpCustomId("help:cmd:accept:full");
        expect(result).toEqual({ type: "command", name: "accept", full: true });
      });

      it("handles command names with hyphens", () => {
        const result = parseHelpCustomId("help:cmd:approval-rate");
        expect(result).toEqual({
          type: "command",
          name: "approval-rate",
          full: false,
        });
      });

      it("handles command names with underscores", () => {
        const result = parseHelpCustomId("help:cmd:some_command");
        expect(result).toEqual({
          type: "command",
          name: "some_command",
          full: false,
        });
      });
    });

    describe("search", () => {
      it("parses 'help:search:<nonce>' correctly", () => {
        const result = parseHelpCustomId("help:search:abc12345");
        expect(result).toEqual({
          type: "search",
          query: "",
          nonce: "abc12345",
        });
      });

      it("parses 8-character hex nonce", () => {
        const result = parseHelpCustomId("help:search:deadbeef");
        expect(result).toEqual({
          type: "search",
          query: "",
          nonce: "deadbeef",
        });
      });

      it("returns null for non-hex nonce", () => {
        const result = parseHelpCustomId("help:search:notahex!");
        expect(result).toBeNull();
      });
    });

    describe("search_modal", () => {
      it("parses 'help:search:modal' correctly", () => {
        const result = parseHelpCustomId("help:search:modal");
        expect(result).toEqual({ type: "search_modal" });
      });
    });

    describe("invalid inputs", () => {
      it("returns null for empty string", () => {
        expect(parseHelpCustomId("")).toBeNull();
      });

      it("returns null for unrelated custom ID", () => {
        expect(parseHelpCustomId("review:accept:123")).toBeNull();
      });

      it("returns null for malformed help ID", () => {
        expect(parseHelpCustomId("help:unknown")).toBeNull();
      });

      it("returns null for help: prefix only", () => {
        expect(parseHelpCustomId("help:")).toBeNull();
      });

      it("returns null for partial category ID", () => {
        expect(parseHelpCustomId("help:cat:")).toBeNull();
      });

      it("returns null for partial command ID", () => {
        expect(parseHelpCustomId("help:cmd:")).toBeNull();
      });
    });
  });

  describe("buildHelpCustomId", () => {
    describe("overview", () => {
      it("builds overview custom ID", () => {
        const result = buildHelpCustomId({ type: "overview" });
        expect(result).toBe("help:overview");
      });
    });

    describe("category", () => {
      it("builds category custom ID without page", () => {
        const result = buildHelpCustomId({
          type: "category",
          category: "gate",
          page: 0,
        });
        expect(result).toBe("help:cat:gate");
      });

      it("builds category custom ID with page", () => {
        const result = buildHelpCustomId({
          type: "category",
          category: "moderation",
          page: 3,
        });
        expect(result).toBe("help:cat:moderation:p3");
      });

      it("omits page suffix for page 0", () => {
        const result = buildHelpCustomId({
          type: "category",
          category: "config",
          page: 0,
        });
        expect(result).not.toContain(":p");
      });

      it.each(["gate", "config", "moderation", "queue", "analytics", "messaging", "roles", "artist", "system"] as CommandCategory[])(
        "builds %s category ID",
        (category) => {
          const result = buildHelpCustomId({ type: "category", category, page: 0 });
          expect(result).toBe(`help:cat:${category}`);
        }
      );
    });

    describe("command", () => {
      it("builds command custom ID without full flag", () => {
        const result = buildHelpCustomId({
          type: "command",
          name: "accept",
          full: false,
        });
        expect(result).toBe("help:cmd:accept");
      });

      it("builds command custom ID with full flag", () => {
        const result = buildHelpCustomId({
          type: "command",
          name: "accept",
          full: true,
        });
        expect(result).toBe("help:cmd:accept:full");
      });
    });

    describe("search", () => {
      it("builds search custom ID with nonce", () => {
        const result = buildHelpCustomId({
          type: "search",
          query: "test query",
          nonce: "abc12345",
        });
        expect(result).toBe("help:search:abc12345");
      });
    });

    describe("search_modal", () => {
      it("builds search modal custom ID", () => {
        const result = buildHelpCustomId({ type: "search_modal" });
        expect(result).toBe("help:search:modal");
      });
    });

    describe("roundtrip", () => {
      it("overview roundtrips correctly", () => {
        const nav: HelpNavigation = { type: "overview" };
        const id = buildHelpCustomId(nav);
        const parsed = parseHelpCustomId(id);
        expect(parsed).toEqual(nav);
      });

      it("category without page roundtrips correctly", () => {
        const nav: HelpNavigation = { type: "category", category: "gate", page: 0 };
        const id = buildHelpCustomId(nav);
        const parsed = parseHelpCustomId(id);
        expect(parsed).toEqual(nav);
      });

      it("category with page roundtrips correctly", () => {
        const nav: HelpNavigation = {
          type: "category",
          category: "moderation",
          page: 5,
        };
        const id = buildHelpCustomId(nav);
        const parsed = parseHelpCustomId(id);
        expect(parsed).toEqual(nav);
      });

      it("command without full roundtrips correctly", () => {
        const nav: HelpNavigation = { type: "command", name: "accept", full: false };
        const id = buildHelpCustomId(nav);
        const parsed = parseHelpCustomId(id);
        expect(parsed).toEqual(nav);
      });

      it("command with full roundtrips correctly", () => {
        const nav: HelpNavigation = { type: "command", name: "reject", full: true };
        const id = buildHelpCustomId(nav);
        const parsed = parseHelpCustomId(id);
        expect(parsed).toEqual(nav);
      });

      it("search_modal roundtrips correctly", () => {
        const nav: HelpNavigation = { type: "search_modal" };
        const id = buildHelpCustomId(nav);
        const parsed = parseHelpCustomId(id);
        expect(parsed).toEqual(nav);
      });
    });
  });

  describe("constants", () => {
    it("COMMANDS_PER_PAGE is 10", () => {
      expect(COMMANDS_PER_PAGE).toBe(10);
    });

    it("MAX_SELECT_OPTIONS is 25 (Discord limit)", () => {
      expect(MAX_SELECT_OPTIONS).toBe(25);
    });

    it("MAX_BUTTONS_PER_ROW is 5 (Discord limit)", () => {
      expect(MAX_BUTTONS_PER_ROW).toBe(5);
    });

    it("MAX_ROWS is 5 (Discord limit)", () => {
      expect(MAX_ROWS).toBe(5);
    });
  });

  describe("type definitions", () => {
    it("PermissionLevel includes all expected levels", () => {
      const levels: PermissionLevel[] = [
        "public",
        "reviewer",
        "staff",
        "admin",
        "owner",
      ];
      // Type check passes if this compiles
      expect(levels).toHaveLength(5);
    });

    it("CommandCategory includes all expected categories", () => {
      const categories: CommandCategory[] = [
        "gate",
        "config",
        "moderation",
        "queue",
        "analytics",
        "messaging",
        "roles",
        "artist",
        "system",
      ];
      // Type check passes if this compiles
      expect(categories).toHaveLength(9);
    });
  });
});
