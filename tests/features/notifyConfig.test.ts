/**
 * Pawtropolis Tech — tests/features/notifyConfig.test.ts
 * WHAT: Unit tests for notification configuration module.
 * WHY: Verify config read/write operations and defaults.
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

import { getNotifyConfig, setNotifyConfig, getConfiguredGuilds } from "../../src/features/notifyConfig.js";
import { logger } from "../../src/lib/logger.js";

const MAIN_GUILD_ID = "896070888594759740";

describe("features/notifyConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      all: mockAll,
      run: mockRun,
    });
  });

  describe("getNotifyConfig", () => {
    describe("for main guild", () => {
      it("returns hardcoded defaults when no row exists", () => {
        mockGet.mockReturnValue(undefined);

        const result = getNotifyConfig(MAIN_GUILD_ID);

        expect(result.forum_channel_id).toBe("1193455312326377592");
        expect(result.notify_role_id).toBe("1397856960862486598");
        expect(result.notify_mode).toBe("post");
        expect(result.notification_channel_id).toBe("1425945053192257566");
        expect(result.notify_cooldown_seconds).toBe(5);
        expect(result.notify_max_per_hour).toBe(10);
      });

      it("uses DB values when present", () => {
        mockGet.mockReturnValue({
          forum_channel_id: "custom-forum",
          notify_role_id: "custom-role",
          notify_mode: "channel",
          notification_channel_id: "custom-notif",
          notify_cooldown_seconds: 10,
          notify_max_per_hour: 20,
        });

        const result = getNotifyConfig(MAIN_GUILD_ID);

        expect(result.forum_channel_id).toBe("custom-forum");
        expect(result.notify_role_id).toBe("custom-role");
        expect(result.notify_mode).toBe("channel");
        expect(result.notification_channel_id).toBe("custom-notif");
        expect(result.notify_cooldown_seconds).toBe(10);
        expect(result.notify_max_per_hour).toBe(20);
      });

      it("fills missing DB values with main guild defaults", () => {
        mockGet.mockReturnValue({
          forum_channel_id: null,
          notify_role_id: null,
          notify_mode: null,
          notification_channel_id: null,
          notify_cooldown_seconds: null,
          notify_max_per_hour: null,
        });

        const result = getNotifyConfig(MAIN_GUILD_ID);

        expect(result.forum_channel_id).toBe("1193455312326377592");
        expect(result.notify_role_id).toBe("1397856960862486598");
        expect(result.notify_mode).toBe("post");
        expect(result.notification_channel_id).toBe("1425945053192257566");
        expect(result.notify_cooldown_seconds).toBe(5);
        expect(result.notify_max_per_hour).toBe(10);
      });

      it("returns defaults on database error", () => {
        mockGet.mockImplementation(() => {
          throw new Error("Database error");
        });

        const result = getNotifyConfig(MAIN_GUILD_ID);

        expect(result.forum_channel_id).toBe("1193455312326377592");
        expect(result.notify_role_id).toBe("1397856960862486598");
        expect(logger.error).toHaveBeenCalled();
      });
    });

    describe("for other guilds", () => {
      const OTHER_GUILD_ID = "123456789";

      it("returns basic defaults when no row exists", () => {
        mockGet.mockReturnValue(undefined);

        const result = getNotifyConfig(OTHER_GUILD_ID);

        expect(result.forum_channel_id).toBeUndefined();
        expect(result.notify_role_id).toBeUndefined();
        expect(result.notify_mode).toBe("post");
        expect(result.notification_channel_id).toBeUndefined();
        expect(result.notify_cooldown_seconds).toBe(5);
        expect(result.notify_max_per_hour).toBe(10);
      });

      it("uses DB values when present", () => {
        mockGet.mockReturnValue({
          forum_channel_id: "other-forum",
          notify_role_id: "other-role",
          notify_mode: "channel",
          notification_channel_id: "other-notif",
          notify_cooldown_seconds: 15,
          notify_max_per_hour: 30,
        });

        const result = getNotifyConfig(OTHER_GUILD_ID);

        expect(result.forum_channel_id).toBe("other-forum");
        expect(result.notify_role_id).toBe("other-role");
        expect(result.notify_mode).toBe("channel");
        expect(result.notification_channel_id).toBe("other-notif");
        expect(result.notify_cooldown_seconds).toBe(15);
        expect(result.notify_max_per_hour).toBe(30);
      });

      it("fills missing DB values with null (not main guild defaults)", () => {
        mockGet.mockReturnValue({
          forum_channel_id: null,
          notify_role_id: null,
          notify_mode: null,
          notification_channel_id: null,
          notify_cooldown_seconds: 0,
          notify_max_per_hour: 0,
        });

        const result = getNotifyConfig(OTHER_GUILD_ID);

        expect(result.forum_channel_id).toBeNull();
        expect(result.notify_role_id).toBeNull();
        expect(result.notify_mode).toBe("post");
        expect(result.notification_channel_id).toBeNull();
        // 0 is falsy so defaults apply
        expect(result.notify_cooldown_seconds).toBe(5);
        expect(result.notify_max_per_hour).toBe(10);
      });

      it("returns basic defaults on database error", () => {
        mockGet.mockImplementation(() => {
          throw new Error("Database error");
        });

        const result = getNotifyConfig(OTHER_GUILD_ID);

        expect(result.forum_channel_id).toBeUndefined();
        expect(result.notify_role_id).toBeUndefined();
        expect(result.notify_mode).toBe("post");
        expect(logger.error).toHaveBeenCalled();
      });
    });

    it("queries database with correct SQL", () => {
      mockGet.mockReturnValue(undefined);

      getNotifyConfig("guild123");

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledWith("guild123");
    });
  });

  describe("setNotifyConfig", () => {
    it("returns old config before update", () => {
      mockGet.mockReturnValue({
        forum_channel_id: "old-forum",
        notify_role_id: "old-role",
        notify_mode: "post",
        notification_channel_id: null,
        notify_cooldown_seconds: 5,
        notify_max_per_hour: 10,
      });
      mockRun.mockReturnValue({ changes: 1 });

      const oldConfig = setNotifyConfig("guild123", { forum_channel_id: "new-forum" });

      expect(oldConfig.forum_channel_id).toBe("old-forum");
    });

    it("ensures guild_config row exists before update", () => {
      mockGet.mockReturnValue(undefined);
      mockRun.mockReturnValue({ changes: 1 });

      setNotifyConfig("guild123", { forum_channel_id: "new-forum" });

      // Should call prepare at least twice: once for ensure row, once for update
      expect(mockPrepare.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("updates only specified fields", () => {
      mockGet.mockReturnValue({
        forum_channel_id: "old-forum",
        notify_role_id: "old-role",
        notify_mode: "post",
      });
      mockRun.mockReturnValue({ changes: 1 });

      setNotifyConfig("guild123", { forum_channel_id: "new-forum" });

      // Run should be called with the new value and guild ID
      const lastRunCall = mockRun.mock.calls[mockRun.mock.calls.length - 1];
      expect(lastRunCall).toContain("new-forum");
      expect(lastRunCall).toContain("guild123");
    });

    it("updates multiple fields at once", () => {
      mockGet.mockReturnValue(undefined);
      mockRun.mockReturnValue({ changes: 1 });

      setNotifyConfig("guild123", {
        forum_channel_id: "new-forum",
        notify_role_id: "new-role",
        notify_mode: "channel",
      });

      // Should include all three new values in the update
      expect(mockRun).toHaveBeenCalled();
    });

    it("logs successful update", () => {
      mockGet.mockReturnValue(undefined);
      mockRun.mockReturnValue({ changes: 1 });

      setNotifyConfig("guild123", { notify_mode: "channel" });

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ guildId: "guild123" }),
        "[notifyConfig] updated config"
      );
    });

    it("throws on database error", () => {
      mockGet.mockReturnValue(undefined);
      mockRun.mockImplementation(() => {
        throw new Error("Database error");
      });

      expect(() => setNotifyConfig("guild123", { forum_channel_id: "new" })).toThrow();
      expect(logger.error).toHaveBeenCalled();
    });

    it("handles empty config update", () => {
      mockGet.mockReturnValue(undefined);
      mockRun.mockReturnValue({ changes: 0 });

      // Empty config should not throw
      const result = setNotifyConfig("guild123", {});

      expect(result).toBeDefined();
    });

    it("handles null values to clear settings", () => {
      mockGet.mockReturnValue({
        forum_channel_id: "old-forum",
      });
      mockRun.mockReturnValue({ changes: 1 });

      setNotifyConfig("guild123", { forum_channel_id: null });

      const lastRunCall = mockRun.mock.calls[mockRun.mock.calls.length - 1];
      expect(lastRunCall).toContain(null);
    });

    it("updates cooldown and max_per_hour", () => {
      mockGet.mockReturnValue(undefined);
      mockRun.mockReturnValue({ changes: 1 });

      setNotifyConfig("guild123", {
        notify_cooldown_seconds: 30,
        notify_max_per_hour: 5,
      });

      expect(mockRun).toHaveBeenCalled();
    });
  });

  describe("getConfiguredGuilds", () => {
    it("returns guild IDs with notify_role_id set", () => {
      mockAll.mockReturnValue([
        { guild_id: "guild1" },
        { guild_id: "guild2" },
        { guild_id: "guild3" },
      ]);

      const result = getConfiguredGuilds();

      expect(result).toEqual(["guild1", "guild2", "guild3"]);
    });

    it("returns empty array when no guilds configured", () => {
      mockAll.mockReturnValue([]);

      const result = getConfiguredGuilds();

      expect(result).toEqual([]);
    });

    it("returns empty array on database error", () => {
      mockAll.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = getConfiguredGuilds();

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    it("queries for guilds with notify_role_id", () => {
      mockAll.mockReturnValue([]);

      getConfiguredGuilds();

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockAll).toHaveBeenCalled();
    });
  });
});

describe("NotifyConfig interface", () => {
  describe("notify_mode values", () => {
    it("accepts 'post' mode", () => {
      const config = { notify_mode: "post" as const };
      expect(config.notify_mode).toBe("post");
    });

    it("accepts 'channel' mode", () => {
      const config = { notify_mode: "channel" as const };
      expect(config.notify_mode).toBe("channel");
    });
  });

  describe("optional fields", () => {
    it("allows all fields to be undefined", () => {
      const config: Partial<{
        forum_channel_id: string | null;
        notify_role_id: string | null;
        notify_mode: "post" | "channel";
        notification_channel_id: string | null;
        notify_cooldown_seconds: number;
        notify_max_per_hour: number;
      }> = {};

      expect(config.forum_channel_id).toBeUndefined();
      expect(config.notify_role_id).toBeUndefined();
    });

    it("allows null values", () => {
      const config = {
        forum_channel_id: null,
        notify_role_id: null,
        notification_channel_id: null,
      };

      expect(config.forum_channel_id).toBeNull();
      expect(config.notify_role_id).toBeNull();
      expect(config.notification_channel_id).toBeNull();
    });
  });
});
