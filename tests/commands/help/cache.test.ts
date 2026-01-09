/**
 * Pawtropolis Tech — tests/commands/help/cache.test.ts
 * WHAT: Unit tests for search indexing and permission filtering.
 * WHY: Verify search functionality, permission checks, and caching.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock functions that need to be available during vi.mock
const {
  mockPermissionCacheGet,
  mockPermissionCacheSet,
  mockPermissionCacheDelete,
  mockSearchSessionsGet,
  mockSearchSessionsSet,
  mockIsOwner,
  mockHasStaffPermissions,
  mockIsReviewer,
  mockCanRunAllCommands,
  cacheInstanceCounter,
} = vi.hoisted(() => ({
  mockPermissionCacheGet: vi.fn(),
  mockPermissionCacheSet: vi.fn(),
  mockPermissionCacheDelete: vi.fn().mockReturnValue(true),
  mockSearchSessionsGet: vi.fn(),
  mockSearchSessionsSet: vi.fn(),
  mockIsOwner: vi.fn(),
  mockHasStaffPermissions: vi.fn(),
  mockIsReviewer: vi.fn(),
  mockCanRunAllCommands: vi.fn(),
  cacheInstanceCounter: { count: 0 },
}));

vi.mock("../../../src/lib/lruCache.js", () => ({
  LRUCache: class MockLRUCache {
    get: typeof mockPermissionCacheGet;
    set: typeof mockPermissionCacheSet;
    delete: typeof mockPermissionCacheDelete;

    constructor() {
      // First instance is PERMISSION_CACHE, second is SEARCH_SESSIONS
      if (cacheInstanceCounter.count === 0) {
        this.get = mockPermissionCacheGet;
        this.set = mockPermissionCacheSet;
        this.delete = mockPermissionCacheDelete;
      } else {
        this.get = mockSearchSessionsGet;
        this.set = mockSearchSessionsSet;
        this.delete = vi.fn();
      }
      cacheInstanceCounter.count++;
    }
  },
}));

vi.mock("../../../src/lib/owner.js", () => ({
  isOwner: mockIsOwner,
}));

vi.mock("../../../src/lib/config.js", () => ({
  hasStaffPermissions: mockHasStaffPermissions,
  isReviewer: mockIsReviewer,
  canRunAllCommands: mockCanRunAllCommands,
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/commands/help/registry.js", () => ({
  COMMAND_REGISTRY: [
    {
      name: "accept",
      description: "Approve an application",
      category: "gate",
      permissionLevel: "reviewer",
      aliases: ["approve"],
    },
    {
      name: "reject",
      description: "Reject an application",
      category: "gate",
      permissionLevel: "reviewer",
    },
    {
      name: "config",
      description: "Guild configuration management",
      category: "config",
      permissionLevel: "staff",
      subcommands: [{ name: "view", description: "View config" }],
    },
    {
      name: "health",
      description: "Check bot health",
      category: "system",
      permissionLevel: "public",
    },
    {
      name: "database",
      description: "Database management",
      category: "system",
      permissionLevel: "admin",
    },
    {
      name: "panic",
      description: "Emergency halt",
      category: "roles",
      permissionLevel: "owner",
    },
    {
      name: "audit",
      description: "Server audit commands",
      category: "moderation",
      permissionLevel: "staff",
      subcommandGroups: [
        {
          name: "nsfw",
          description: "NSFW scanning",
          subcommands: [{ name: "scan", description: "Scan members" }],
        },
      ],
    },
  ],
  getCommand: vi.fn((name: string) => {
    const registry = [
      {
        name: "accept",
        description: "Approve an application",
        category: "gate",
        permissionLevel: "reviewer",
        aliases: ["approve"],
      },
      {
        name: "reject",
        description: "Reject an application",
        category: "gate",
        permissionLevel: "reviewer",
      },
      {
        name: "config",
        description: "Guild configuration management",
        category: "config",
        permissionLevel: "staff",
        subcommands: [{ name: "view", description: "View config" }],
      },
      {
        name: "health",
        description: "Check bot health",
        category: "system",
        permissionLevel: "public",
      },
      {
        name: "database",
        description: "Database management",
        category: "system",
        permissionLevel: "admin",
      },
      {
        name: "panic",
        description: "Emergency halt",
        category: "roles",
        permissionLevel: "owner",
      },
      {
        name: "audit",
        description: "Server audit commands",
        category: "moderation",
        permissionLevel: "staff",
      },
    ];
    return registry.find((c) => c.name === name);
  }),
}));

vi.mock("node:crypto", () => ({
  randomBytes: vi.fn(() => Buffer.from("deadbeef", "hex")),
}));

import {
  searchCommands,
  filterCommandsByPermission,
  getVisibleCommandsInCategory,
  countCommandsByCategory,
  invalidatePermissionCache,
  generateNonce,
  storeSearchSession,
  getSearchSession,
} from "../../../src/commands/help/cache.js";
import type { GuildMember } from "discord.js";

describe("help/cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheInstanceCounter.count = 0;
    mockIsOwner.mockReturnValue(false);
    mockHasStaffPermissions.mockReturnValue(false);
    mockIsReviewer.mockReturnValue(false);
    mockCanRunAllCommands.mockReturnValue(false);
    mockPermissionCacheGet.mockReturnValue(undefined);
    mockSearchSessionsGet.mockReturnValue(undefined);
  });

  describe("searchCommands", () => {
    it("returns empty array for empty query", () => {
      const results = searchCommands("");
      expect(results).toEqual([]);
    });

    it("returns empty array for whitespace-only query", () => {
      const results = searchCommands("   ");
      expect(results).toEqual([]);
    });

    it("returns empty array for single-character query", () => {
      const results = searchCommands("a");
      expect(results).toEqual([]);
    });

    it("finds command by exact name match", () => {
      const results = searchCommands("accept");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].command.name).toBe("accept");
      expect(results[0].matchedOn).toBe("name");
    });

    it("finds command by partial name match", () => {
      const results = searchCommands("acc");
      const acceptResult = results.find((r) => r.command.name === "accept");
      expect(acceptResult).toBeDefined();
    });

    it("finds command by alias", () => {
      const results = searchCommands("approve");
      const acceptResult = results.find((r) => r.command.name === "accept");
      expect(acceptResult).toBeDefined();
    });

    it("finds command by category", () => {
      const results = searchCommands("gate");
      expect(results.length).toBeGreaterThan(0);
      const gateCommands = results.filter((r) => r.command.category === "gate");
      expect(gateCommands.length).toBeGreaterThan(0);
    });

    it("finds command by description word", () => {
      const results = searchCommands("application");
      expect(results.length).toBeGreaterThan(0);
    });

    it("finds command by subcommand name", () => {
      const results = searchCommands("view");
      const configResult = results.find((r) => r.command.name === "config");
      expect(configResult).toBeDefined();
    });

    it("scores exact name match highest", () => {
      const results = searchCommands("accept");
      const acceptResult = results.find((r) => r.command.name === "accept");
      expect(acceptResult!.score).toBe(100);
    });

    it("scores prefix match lower than exact", () => {
      const results = searchCommands("acc");
      const acceptResult = results.find((r) => r.command.name === "accept");
      expect(acceptResult!.score).toBeLessThan(100);
      expect(acceptResult!.score).toBeGreaterThanOrEqual(80);
    });

    it("handles multi-word queries with AND logic", () => {
      const results = searchCommands("accept application");
      const acceptResult = results.find((r) => r.command.name === "accept");
      expect(acceptResult).toBeDefined();
    });

    it("returns empty for non-matching query", () => {
      const results = searchCommands("xyznonexistent");
      expect(results).toEqual([]);
    });

    it("strips punctuation from query", () => {
      const results = searchCommands("accept!");
      expect(results.length).toBeGreaterThan(0);
    });

    it("is case-insensitive", () => {
      const results = searchCommands("ACCEPT");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].command.name).toBe("accept");
    });

    it("sorts results by score descending", () => {
      const results = searchCommands("accept");
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe("filterCommandsByPermission", () => {
    it("returns cached result if available", () => {
      mockPermissionCacheGet.mockReturnValue(["health"]);

      const result = filterCommandsByPermission(null, "guild-123", "user-456");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("health");
    });

    it("queries and caches on cache miss", () => {
      mockPermissionCacheGet.mockReturnValue(undefined);

      filterCommandsByPermission(null, "guild-123", "user-456");

      expect(mockPermissionCacheSet).toHaveBeenCalled();
    });

    it("returns only public commands for null member", () => {
      mockPermissionCacheGet.mockReturnValue(undefined);

      const result = filterCommandsByPermission(null, "guild-123", "user-456");

      expect(result.every((c) => c.permissionLevel === "public")).toBe(true);
    });

    it("returns all commands for owner", () => {
      mockIsOwner.mockReturnValue(true);
      mockPermissionCacheGet.mockReturnValue(undefined);

      const result = filterCommandsByPermission(null, "guild-123", "owner-123");

      expect(result.length).toBe(7);
    });

    it("includes reviewer commands for reviewers", () => {
      mockPermissionCacheGet.mockReturnValue(undefined);
      mockIsReviewer.mockReturnValue(true);

      const mockMember = { id: "user-123" } as GuildMember;
      const result = filterCommandsByPermission(mockMember, "guild-123", "user-123");

      const reviewerCmds = result.filter((c) => c.permissionLevel === "reviewer");
      expect(reviewerCmds.length).toBeGreaterThan(0);
    });

    it("includes staff commands for staff", () => {
      mockPermissionCacheGet.mockReturnValue(undefined);
      mockHasStaffPermissions.mockReturnValue(true);

      const mockMember = { id: "user-123" } as GuildMember;
      const result = filterCommandsByPermission(mockMember, "guild-123", "user-123");

      const staffCmds = result.filter((c) => c.permissionLevel === "staff");
      expect(staffCmds.length).toBeGreaterThan(0);
    });

    it("includes admin commands for admin", () => {
      mockPermissionCacheGet.mockReturnValue(undefined);
      mockCanRunAllCommands.mockReturnValue(true);

      const mockMember = { id: "user-123" } as GuildMember;
      const result = filterCommandsByPermission(mockMember, "guild-123", "user-123");

      const adminCmds = result.filter((c) => c.permissionLevel === "admin");
      expect(adminCmds.length).toBeGreaterThan(0);
    });

    it("excludes owner commands for non-owners", () => {
      mockPermissionCacheGet.mockReturnValue(undefined);
      mockCanRunAllCommands.mockReturnValue(true);

      const mockMember = { id: "user-123" } as GuildMember;
      const result = filterCommandsByPermission(mockMember, "guild-123", "user-123");

      const ownerCmds = result.filter((c) => c.permissionLevel === "owner");
      expect(ownerCmds.length).toBe(0);
    });

    it("caches command names, not full objects", () => {
      mockPermissionCacheGet.mockReturnValue(undefined);

      filterCommandsByPermission(null, "guild-123", "user-456");

      const setCall = mockPermissionCacheSet.mock.calls[0];
      expect(setCall[0]).toBe("guild-123:user-456");
      expect(Array.isArray(setCall[1])).toBe(true);
      expect(typeof setCall[1][0]).toBe("string");
    });
  });

  describe("getVisibleCommandsInCategory", () => {
    it("returns commands in specified category", () => {
      mockPermissionCacheGet.mockReturnValue(undefined);
      mockIsOwner.mockReturnValue(true);

      const result = getVisibleCommandsInCategory("gate", null, "guild-123", "owner-123");

      expect(result.length).toBeGreaterThan(0);
      expect(result.every((c) => c.category === "gate")).toBe(true);
    });

    it("respects permission filtering", () => {
      mockPermissionCacheGet.mockReturnValue(undefined);

      const result = getVisibleCommandsInCategory("system", null, "guild-123", "user-456");

      expect(result.every((c) => c.permissionLevel === "public")).toBe(true);
    });

    it("returns empty array for category with no visible commands", () => {
      mockPermissionCacheGet.mockReturnValue(undefined);

      const result = getVisibleCommandsInCategory("roles", null, "guild-123", "user-456");

      expect(result).toEqual([]);
    });
  });

  describe("countCommandsByCategory", () => {
    it("returns map with category counts", () => {
      mockPermissionCacheGet.mockReturnValue(undefined);
      mockIsOwner.mockReturnValue(true);

      const result = countCommandsByCategory(null, "guild-123", "owner-123");

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBeGreaterThan(0);
    });

    it("counts commands per category correctly", () => {
      mockPermissionCacheGet.mockReturnValue(undefined);
      mockIsOwner.mockReturnValue(true);

      const result = countCommandsByCategory(null, "guild-123", "owner-123");

      expect(result.get("gate")).toBe(2);
      expect(result.get("config")).toBe(1);
      expect(result.get("system")).toBe(2);
    });

    it("respects permission filtering", () => {
      mockPermissionCacheGet.mockReturnValue(undefined);

      const result = countCommandsByCategory(null, "guild-123", "user-456");

      expect(result.get("system")).toBe(1);
      expect(result.get("gate")).toBeUndefined();
    });
  });

  describe("invalidatePermissionCache", () => {
    it("deletes cache entry for user", () => {
      invalidatePermissionCache("guild-123", "user-456");

      expect(mockPermissionCacheDelete).toHaveBeenCalledWith("guild-123:user-456");
    });
  });

  describe("generateNonce", () => {
    it("returns hex string", () => {
      const nonce = generateNonce();
      expect(typeof nonce).toBe("string");
      expect(/^[a-f0-9]+$/.test(nonce)).toBe(true);
    });

    it("returns 8-character nonce", () => {
      const nonce = generateNonce();
      expect(nonce.length).toBe(8);
    });
  });

  describe("storeSearchSession", () => {
    it("stores search query and result names", () => {
      const results = [
        { command: { name: "accept" }, score: 100, matchedOn: "name" as const },
        { command: { name: "reject" }, score: 80, matchedOn: "name" as const },
      ];

      storeSearchSession("abc12345", "test query", results);

      expect(mockSearchSessionsSet).toHaveBeenCalledWith("abc12345", {
        query: "test query",
        results: ["accept", "reject"],
      });
    });

    it("stores empty results", () => {
      storeSearchSession("abc12345", "no matches", []);

      expect(mockSearchSessionsSet).toHaveBeenCalledWith("abc12345", {
        query: "no matches",
        results: [],
      });
    });
  });

  describe("getSearchSession", () => {
    it("returns null for non-existent session", () => {
      mockSearchSessionsGet.mockReturnValue(undefined);

      const result = getSearchSession("nonexistent");

      expect(result).toBeNull();
    });

    it("returns session with resolved commands", () => {
      mockSearchSessionsGet.mockReturnValue({
        query: "test",
        results: ["accept", "reject"],
      });

      const result = getSearchSession("abc12345");

      expect(result).not.toBeNull();
      expect(result!.query).toBe("test");
      expect(result!.results).toHaveLength(2);
      expect(result!.results[0].name).toBe("accept");
    });

    it("filters out non-existent commands", () => {
      mockSearchSessionsGet.mockReturnValue({
        query: "test",
        results: ["accept", "nonexistent"],
      });

      const result = getSearchSession("abc12345");

      expect(result!.results).toHaveLength(1);
      expect(result!.results[0].name).toBe("accept");
    });
  });
});
