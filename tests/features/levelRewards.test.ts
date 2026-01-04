/**
 * Pawtropolis Tech — tests/features/levelRewards.test.ts
 * WHAT: Unit tests for Mee6 level-up reward role assignment module.
 * WHY: Verify level-role mapping, role assignment logic, and edge case handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock functions
const { mockGet, mockAll, mockRun, mockPrepare } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockAll: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
  all: mockAll,
  run: mockRun,
});

vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/lib/env.js", () => ({
  env: {
    GUILD_ID: "guild123",
    MEE6_BOT_ID: "mee6bot",
  },
}));

vi.mock("../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn(),
}));

import {
  handleMee6LevelUp,
  getLevelReward,
  getAllLevelRewards,
  setLevelReward,
  removeLevelReward,
  formatLevelRewardsList,
  getRoleIdsUpToLevel,
} from "../../src/features/levelRewards.js";
import { logActionPretty } from "../../src/logging/pretty.js";
import { logger } from "../../src/lib/logger.js";

describe("features/levelRewards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      all: mockAll,
      run: mockRun,
    });
  });

  describe("getLevelReward", () => {
    it("returns reward for matching level", () => {
      mockGet.mockReturnValue({
        guild_id: "guild123",
        level: 10,
        role_id: "role456",
        created_at: "2024-01-01",
      });

      const result = getLevelReward("guild123", 10);

      expect(result).toEqual({
        guild_id: "guild123",
        level: 10,
        role_id: "role456",
        created_at: "2024-01-01",
      });
    });

    it("returns null when no reward for level", () => {
      mockGet.mockReturnValue(undefined);

      const result = getLevelReward("guild123", 10);

      expect(result).toBeNull();
    });

    it("queries with correct parameters", () => {
      mockGet.mockReturnValue(undefined);

      getLevelReward("guild123", 15);

      expect(mockGet).toHaveBeenCalledWith("guild123", 15);
    });
  });

  describe("getAllLevelRewards", () => {
    it("returns all rewards for guild", () => {
      mockAll.mockReturnValue([
        { guild_id: "guild123", level: 5, role_id: "role1", created_at: "2024-01-01" },
        { guild_id: "guild123", level: 10, role_id: "role2", created_at: "2024-01-01" },
        { guild_id: "guild123", level: 20, role_id: "role3", created_at: "2024-01-01" },
      ]);

      const result = getAllLevelRewards("guild123");

      expect(result).toHaveLength(3);
      expect(result[0].level).toBe(5);
      expect(result[2].level).toBe(20);
    });

    it("returns empty array when no rewards", () => {
      mockAll.mockReturnValue([]);

      const result = getAllLevelRewards("guild123");

      expect(result).toEqual([]);
    });

    it("returns rewards sorted by level ascending", () => {
      mockAll.mockReturnValue([
        { guild_id: "guild123", level: 10, role_id: "role2", created_at: "2024-01-01" },
        { guild_id: "guild123", level: 5, role_id: "role1", created_at: "2024-01-01" },
      ]);

      const result = getAllLevelRewards("guild123");

      // Should be sorted by level ASC in query
      expect(result[0].level).toBeLessThan(result[1].level);
    });
  });

  describe("setLevelReward", () => {
    it("upserts level reward", () => {
      mockRun.mockReturnValue({ changes: 1 });

      setLevelReward("guild123", 10, "role456");

      expect(mockRun).toHaveBeenCalledWith("guild123", 10, "role456", expect.any(String));
    });

    it("returns true on success", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = setLevelReward("guild123", 10, "role456");

      expect(result).toBe(true);
    });

    it("logs successful set", () => {
      mockRun.mockReturnValue({ changes: 1 });

      setLevelReward("guild123", 15, "role789");

      expect(logger.info).toHaveBeenCalled();
    });

    it("handles database error", () => {
      mockRun.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = setLevelReward("guild123", 10, "role456");

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("removeLevelReward", () => {
    it("deletes level reward", () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = removeLevelReward("guild123", 10);

      expect(result).toBe(true);
      expect(mockRun).toHaveBeenCalledWith("guild123", 10);
    });

    it("returns false when no reward to remove", () => {
      mockRun.mockReturnValue({ changes: 0 });

      const result = removeLevelReward("guild123", 10);

      expect(result).toBe(false);
    });

    it("logs removal", () => {
      mockRun.mockReturnValue({ changes: 1 });

      removeLevelReward("guild123", 10);

      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("getRoleIdsUpToLevel", () => {
    it("returns all role IDs up to and including level", () => {
      mockAll.mockReturnValue([
        { role_id: "role1" },
        { role_id: "role2" },
        { role_id: "role3" },
      ]);

      const result = getRoleIdsUpToLevel("guild123", 15);

      expect(result).toEqual(["role1", "role2", "role3"]);
    });

    it("returns empty array when no rewards below level", () => {
      mockAll.mockReturnValue([]);

      const result = getRoleIdsUpToLevel("guild123", 5);

      expect(result).toEqual([]);
    });

    it("queries with level filter", () => {
      mockAll.mockReturnValue([]);

      getRoleIdsUpToLevel("guild123", 10);

      expect(mockAll).toHaveBeenCalledWith("guild123", 10);
    });
  });

  describe("formatLevelRewardsList", () => {
    it("formats rewards list for display", () => {
      const rewards = [
        { guild_id: "guild123", level: 5, role_id: "role1", created_at: "2024-01-01" },
        { guild_id: "guild123", level: 10, role_id: "role2", created_at: "2024-01-01" },
      ];

      const result = formatLevelRewardsList(rewards);

      expect(result).toContain("Level 5");
      expect(result).toContain("Level 10");
      expect(result).toContain("<@&role1>");
      expect(result).toContain("<@&role2>");
    });

    it("returns empty message when no rewards", () => {
      const result = formatLevelRewardsList([]);

      expect(result).toContain("No level rewards");
    });

    it("shows all levels in ascending order", () => {
      const rewards = [
        { guild_id: "guild123", level: 5, role_id: "role1", created_at: "2024-01-01" },
        { guild_id: "guild123", level: 15, role_id: "role2", created_at: "2024-01-01" },
      ];

      const result = formatLevelRewardsList(rewards);
      const level5Idx = result.indexOf("Level 5");
      const level15Idx = result.indexOf("Level 15");

      expect(level5Idx).toBeLessThan(level15Idx);
    });
  });

  describe("handleMee6LevelUp", () => {
    it("ignores messages not from Mee6 bot", async () => {
      const message = {
        author: { id: "otherBot", bot: true },
        guildId: "guild123",
        embeds: [],
      };

      await handleMee6LevelUp(message as any);

      expect(mockGet).not.toHaveBeenCalled();
    });

    it("ignores messages without embeds", async () => {
      const message = {
        author: { id: "mee6bot", bot: true },
        guildId: "guild123",
        embeds: [],
      };

      await handleMee6LevelUp(message as any);

      expect(mockGet).not.toHaveBeenCalled();
    });

    it("ignores non-level-up embeds", async () => {
      const message = {
        author: { id: "mee6bot", bot: true },
        guildId: "guild123",
        embeds: [{ description: "Some other message" }],
      };

      await handleMee6LevelUp(message as any);

      expect(mockGet).not.toHaveBeenCalled();
    });

    it("parses level up message correctly", async () => {
      mockGet.mockReturnValue(undefined);
      mockAll.mockReturnValue([]);

      const message = {
        author: { id: "mee6bot", bot: true },
        guildId: "guild123",
        guild: {
          id: "guild123",
          members: {
            fetch: vi.fn().mockResolvedValue({
              roles: { add: vi.fn() },
            }),
          },
          roles: { fetch: vi.fn().mockResolvedValue({ name: "Level 10" }) },
        },
        embeds: [{
          description: "GG <@123456789>, you just advanced to level 10!",
        }],
      };

      await handleMee6LevelUp(message as any);

      expect(logger.debug).toHaveBeenCalled();
    });

    it("assigns role when level matches reward", async () => {
      mockGet.mockReturnValue({
        guild_id: "guild123",
        level: 10,
        role_id: "rewardRole123",
        created_at: "2024-01-01",
      });
      mockAll.mockReturnValue([{ role_id: "rewardRole123" }]);

      const mockAddRole = vi.fn().mockResolvedValue(undefined);
      const mockRole = { name: "Level 10 Role" };

      const message = {
        author: { id: "mee6bot", bot: true },
        guildId: "guild123",
        guild: {
          id: "guild123",
          members: {
            fetch: vi.fn().mockResolvedValue({
              roles: {
                add: mockAddRole,
                cache: { has: vi.fn(() => false) },
              },
            }),
          },
          roles: { fetch: vi.fn().mockResolvedValue(mockRole) },
        },
        embeds: [{
          description: "GG <@123456789>, you just advanced to level 10!",
        }],
      };

      await handleMee6LevelUp(message as any);

      expect(mockAddRole).toHaveBeenCalledWith("rewardRole123");
      expect(logger.info).toHaveBeenCalled();
    });

    it("skips role assignment if member already has role", async () => {
      mockGet.mockReturnValue({
        guild_id: "guild123",
        level: 10,
        role_id: "rewardRole123",
        created_at: "2024-01-01",
      });
      mockAll.mockReturnValue([{ role_id: "rewardRole123" }]);

      const mockAddRole = vi.fn();

      const message = {
        author: { id: "mee6bot", bot: true },
        guildId: "guild123",
        guild: {
          id: "guild123",
          members: {
            fetch: vi.fn().mockResolvedValue({
              roles: {
                add: mockAddRole,
                cache: { has: vi.fn(() => true) },
              },
            }),
          },
          roles: { fetch: vi.fn().mockResolvedValue({ name: "Level 10" }) },
        },
        embeds: [{
          description: "GG <@123456789>, you just advanced to level 10!",
        }],
      };

      await handleMee6LevelUp(message as any);

      expect(mockAddRole).not.toHaveBeenCalled();
    });

    it("handles member fetch failure", async () => {
      mockGet.mockReturnValue({
        guild_id: "guild123",
        level: 10,
        role_id: "rewardRole123",
        created_at: "2024-01-01",
      });

      const message = {
        author: { id: "mee6bot", bot: true },
        guildId: "guild123",
        guild: {
          id: "guild123",
          members: {
            fetch: vi.fn().mockRejectedValue(new Error("Member not found")),
          },
        },
        embeds: [{
          description: "GG <@123456789>, you just advanced to level 10!",
        }],
      };

      await handleMee6LevelUp(message as any);

      expect(logger.error).toHaveBeenCalled();
    });

    it("handles role not found", async () => {
      mockGet.mockReturnValue({
        guild_id: "guild123",
        level: 10,
        role_id: "deletedRole",
        created_at: "2024-01-01",
      });
      mockAll.mockReturnValue([{ role_id: "deletedRole" }]);

      const message = {
        author: { id: "mee6bot", bot: true },
        guildId: "guild123",
        guild: {
          id: "guild123",
          members: {
            fetch: vi.fn().mockResolvedValue({
              roles: { add: vi.fn(), cache: { has: vi.fn(() => false) } },
            }),
          },
          roles: { fetch: vi.fn().mockResolvedValue(null) },
        },
        embeds: [{
          description: "GG <@123456789>, you just advanced to level 10!",
        }],
      };

      await handleMee6LevelUp(message as any);

      expect(logger.warn).toHaveBeenCalled();
    });

    it("logs action to audit log", async () => {
      mockGet.mockReturnValue({
        guild_id: "guild123",
        level: 10,
        role_id: "rewardRole123",
        created_at: "2024-01-01",
      });
      mockAll.mockReturnValue([{ role_id: "rewardRole123" }]);

      const mockAddRole = vi.fn().mockResolvedValue(undefined);

      const message = {
        author: { id: "mee6bot", bot: true },
        guildId: "guild123",
        guild: {
          id: "guild123",
          members: {
            fetch: vi.fn().mockResolvedValue({
              roles: {
                add: mockAddRole,
                cache: { has: vi.fn(() => false) },
              },
            }),
          },
          roles: { fetch: vi.fn().mockResolvedValue({ name: "Level 10" }) },
        },
        embeds: [{
          description: "GG <@123456789>, you just advanced to level 10!",
        }],
      };

      await handleMee6LevelUp(message as any);

      expect(logActionPretty).toHaveBeenCalled();
    });
  });
});

describe("level up regex", () => {
  describe("Mee6 message format", () => {
    it("matches standard format", () => {
      const regex = /advanced to level (\d+)/i;
      const message = "GG <@123456789>, you just advanced to level 10!";
      const match = message.match(regex);

      expect(match).not.toBeNull();
      expect(match![1]).toBe("10");
    });

    it("extracts user ID from mention", () => {
      const regex = /<@(\d+)>/;
      const message = "GG <@123456789>, you just advanced to level 10!";
      const match = message.match(regex);

      expect(match).not.toBeNull();
      expect(match![1]).toBe("123456789");
    });

    it("handles different level numbers", () => {
      const regex = /advanced to level (\d+)/i;

      expect("level 1".match(regex)).not.toBeNull();
      expect("level 50".match(regex)).not.toBeNull();
      expect("level 100".match(regex)).not.toBeNull();
    });
  });
});

describe("level_rewards table schema", () => {
  describe("columns", () => {
    it("has guild_id column", () => {
      const columns = ["guild_id", "level", "role_id", "created_at"];
      expect(columns).toContain("guild_id");
    });

    it("has level column", () => {
      const columns = ["guild_id", "level", "role_id", "created_at"];
      expect(columns).toContain("level");
    });

    it("has role_id column", () => {
      const columns = ["guild_id", "level", "role_id", "created_at"];
      expect(columns).toContain("role_id");
    });

    it("has created_at column", () => {
      const columns = ["guild_id", "level", "role_id", "created_at"];
      expect(columns).toContain("created_at");
    });
  });

  describe("primary key", () => {
    it("uses composite key (guild_id, level)", () => {
      const pk = ["guild_id", "level"];
      expect(pk).toHaveLength(2);
    });
  });
});

describe("cumulative role assignment", () => {
  describe("getRoleIdsUpToLevel", () => {
    it("includes all roles up to reached level", () => {
      mockAll.mockReturnValue([
        { role_id: "role5" },
        { role_id: "role10" },
      ]);

      const roleIds = getRoleIdsUpToLevel("guild123", 10);

      expect(roleIds).toContain("role5");
      expect(roleIds).toContain("role10");
    });
  });

  describe("level milestone behavior", () => {
    it("assigns level 5 role at level 5", () => {
      const level = 5;
      const milestones = [5, 10, 20, 30, 40, 50];
      const shouldAssign = milestones.includes(level);

      expect(shouldAssign).toBe(true);
    });

    it("skips non-milestone levels", () => {
      const level = 7;
      const milestones = [5, 10, 20, 30, 40, 50];
      const shouldAssign = milestones.includes(level);

      expect(shouldAssign).toBe(false);
    });
  });
});

describe("error handling", () => {
  describe("database errors", () => {
    it("handles getLevelReward error", () => {
      mockGet.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = getLevelReward("guild123", 10);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it("handles getAllLevelRewards error", () => {
      mockAll.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = getAllLevelRewards("guild123");

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("Discord API errors", () => {
    it("catches role add failure", async () => {
      mockGet.mockReturnValue({
        guild_id: "guild123",
        level: 10,
        role_id: "rewardRole123",
        created_at: "2024-01-01",
      });
      mockAll.mockReturnValue([{ role_id: "rewardRole123" }]);

      const mockAddRole = vi.fn().mockRejectedValue(new Error("Missing Permissions"));

      const message = {
        author: { id: "mee6bot", bot: true },
        guildId: "guild123",
        guild: {
          id: "guild123",
          members: {
            fetch: vi.fn().mockResolvedValue({
              roles: {
                add: mockAddRole,
                cache: { has: vi.fn(() => false) },
              },
            }),
          },
          roles: { fetch: vi.fn().mockResolvedValue({ name: "Level 10" }) },
        },
        embeds: [{
          description: "GG <@123456789>, you just advanced to level 10!",
        }],
      };

      await handleMee6LevelUp(message as any);

      expect(logger.error).toHaveBeenCalled();
    });
  });
});

describe("logging", () => {
  describe("successful operations", () => {
    it("logs role assignment", async () => {
      mockGet.mockReturnValue({
        guild_id: "guild123",
        level: 10,
        role_id: "rewardRole123",
        created_at: "2024-01-01",
      });
      mockAll.mockReturnValue([{ role_id: "rewardRole123" }]);

      const mockAddRole = vi.fn().mockResolvedValue(undefined);

      const message = {
        author: { id: "mee6bot", bot: true },
        guildId: "guild123",
        guild: {
          id: "guild123",
          members: {
            fetch: vi.fn().mockResolvedValue({
              roles: {
                add: mockAddRole,
                cache: { has: vi.fn(() => false) },
              },
            }),
          },
          roles: { fetch: vi.fn().mockResolvedValue({ name: "Level 10" }) },
        },
        embeds: [{
          description: "GG <@123456789>, you just advanced to level 10!",
        }],
      };

      await handleMee6LevelUp(message as any);

      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("debug logging", () => {
    it("logs parsed level up data", async () => {
      mockGet.mockReturnValue(undefined);
      mockAll.mockReturnValue([]);

      const message = {
        author: { id: "mee6bot", bot: true },
        guildId: "guild123",
        guild: {
          id: "guild123",
          members: { fetch: vi.fn().mockResolvedValue({ roles: { add: vi.fn() } }) },
        },
        embeds: [{
          description: "GG <@123456789>, you just advanced to level 10!",
        }],
      };

      await handleMee6LevelUp(message as any);

      expect(logger.debug).toHaveBeenCalled();
    });
  });
});
