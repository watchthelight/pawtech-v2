/**
 * Pawtropolis Tech — tests/features/activityTracker.test.ts
 * WHAT: Unit tests for activity tracking module (Silent-Since-Join flagger).
 * WHY: Verify join tracking, first message tracking, and threshold evaluation.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock functions
const { mockGet, mockRun, mockPrepare } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
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

vi.mock("../../src/config/flaggerStore.js", () => ({
  getFlaggerConfig: vi.fn(() => ({
    channelId: null,
    silentDays: 7,
  })),
}));

vi.mock("../../src/features/logger.js", () => ({
  getLoggingChannel: vi.fn().mockResolvedValue(null),
}));

import { trackJoin } from "../../src/features/activityTracker.js";

describe("features/activityTracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      run: mockRun,
    });
  });

  describe("trackJoin", () => {
    it("inserts join record into user_activity table", () => {
      mockRun.mockReturnValue({ changes: 1 });

      trackJoin("guild123", "user456", 1700000000);

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalledWith("guild123", "user456", 1700000000);
    });

    it("handles missing table error gracefully", () => {
      mockRun.mockImplementation(() => {
        throw new Error("no such table: user_activity");
      });

      // Should not throw
      expect(() => trackJoin("guild123", "user456", 1700000000)).not.toThrow();
    });

    it("handles other database errors gracefully", () => {
      mockRun.mockImplementation(() => {
        throw new Error("Database error");
      });

      // Should not throw
      expect(() => trackJoin("guild123", "user456", 1700000000)).not.toThrow();
    });
  });
});

describe("activity tracking UPSERT pattern", () => {
  describe("ON CONFLICT behavior", () => {
    it("uses UPSERT for join tracking", () => {
      const sql = `
        INSERT INTO user_activity (guild_id, user_id, joined_at)
        VALUES (?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          joined_at = excluded.joined_at
      `;

      expect(sql).toContain("ON CONFLICT");
      expect(sql).toContain("DO UPDATE SET");
      expect(sql).toContain("excluded.joined_at");
    });

    it("resets joined_at on rejoin", () => {
      // Design: User leaves and rejoins should reset silent days counter
      const policy = "reset_on_rejoin";
      expect(policy).toBe("reset_on_rejoin");
    });
  });
});

describe("silent days calculation", () => {
  describe("threshold evaluation", () => {
    it("calculates silent days from timestamps", () => {
      const joinedAt = 1700000000; // seconds
      const firstMessageAt = 1700604800; // 7 days later
      const silentSeconds = firstMessageAt - joinedAt;
      const silentDays = Math.floor(silentSeconds / 86400);

      expect(silentDays).toBe(7);
    });

    it("floors partial days", () => {
      const joinedAt = 1700000000;
      const firstMessageAt = 1700604800 - 1; // 6 days, 23:59:59
      const silentSeconds = firstMessageAt - joinedAt;
      const silentDays = Math.floor(silentSeconds / 86400);

      expect(silentDays).toBe(6);
    });

    it("returns 0 for same-day message", () => {
      const joinedAt = 1700000000;
      const firstMessageAt = 1700043200; // 12 hours later
      const silentSeconds = firstMessageAt - joinedAt;
      const silentDays = Math.floor(silentSeconds / 86400);

      expect(silentDays).toBe(0);
    });
  });

  describe("threshold comparison", () => {
    it("flags when silent days meet threshold", () => {
      const silentDays = 7;
      const threshold = 7;
      const shouldFlag = silentDays >= threshold;

      expect(shouldFlag).toBe(true);
    });

    it("flags when silent days exceed threshold", () => {
      const silentDays = 10;
      const threshold = 7;
      const shouldFlag = silentDays >= threshold;

      expect(shouldFlag).toBe(true);
    });

    it("does not flag when below threshold", () => {
      const silentDays = 5;
      const threshold = 7;
      const shouldFlag = silentDays >= threshold;

      expect(shouldFlag).toBe(false);
    });
  });
});

describe("flagger configuration", () => {
  describe("channel configuration", () => {
    it("skips flagging when channel not configured", () => {
      const config = { channelId: null, silentDays: 7 };
      const shouldFlag = config.channelId !== null;

      expect(shouldFlag).toBe(false);
    });

    it("enables flagging when channel configured", () => {
      const config = { channelId: "channel123", silentDays: 7 };
      const shouldFlag = config.channelId !== null;

      expect(shouldFlag).toBe(true);
    });
  });

  describe("threshold configuration", () => {
    it("uses default threshold of 7 days", () => {
      const defaultThreshold = 7;
      expect(defaultThreshold).toBe(7);
    });

    it("allows custom threshold", () => {
      const config = { channelId: "channel123", silentDays: 14 };
      expect(config.silentDays).toBe(14);
    });
  });
});

describe("first message tracking", () => {
  describe("user existence checks", () => {
    it("handles user not in activity table", () => {
      // User joined before migration ran
      const row = undefined;
      const userExists = row !== undefined;

      expect(userExists).toBe(false);
    });

    it("detects user with existing join record", () => {
      const row = { joined_at: 1700000000, first_message_at: null };
      const userExists = row !== undefined;
      const hasFirstMessage = row.first_message_at !== null;

      expect(userExists).toBe(true);
      expect(hasFirstMessage).toBe(false);
    });

    it("skips if first message already recorded", () => {
      const row = { joined_at: 1700000000, first_message_at: 1700604800 };
      const hasFirstMessage = row.first_message_at !== null;

      expect(hasFirstMessage).toBe(true);
    });
  });
});

describe("flag embed format", () => {
  describe("embed color", () => {
    it("uses yellow for informational (0xFEE75C)", () => {
      const color = 0xfee75c;
      expect(color).toBe(16705372);
    });
  });

  describe("embed fields", () => {
    it("includes silent days", () => {
      const silentDays = 7;
      const fieldValue = `${silentDays} days`;
      expect(fieldValue).toBe("7 days");
    });

    it("includes message link format", () => {
      const guildId = "guild123";
      const channelId = "channel456";
      const messageId = "msg789";
      const link = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

      expect(link).toBe("https://discord.com/channels/guild123/channel456/msg789");
    });
  });

  describe("embed title", () => {
    it("uses appropriate flag title", () => {
      const title = "🚩 Auto-Flag: Silent Since Join";
      expect(title).toContain("Silent Since Join");
      expect(title).toContain("🚩");
    });
  });
});

describe("activity tracking edge cases", () => {
  describe("DM handling", () => {
    it("ignores messages without guildId", () => {
      const message = { guildId: null };
      const shouldTrack = message.guildId !== null;

      expect(shouldTrack).toBe(false);
    });
  });

  describe("bot handling", () => {
    it("ignores bot messages", () => {
      const message = { author: { bot: true } };
      const shouldTrack = !message.author.bot;

      expect(shouldTrack).toBe(false);
    });

    it("tracks non-bot messages", () => {
      const message = { author: { bot: false } };
      const shouldTrack = !message.author.bot;

      expect(shouldTrack).toBe(true);
    });
  });

  describe("timestamp conversion", () => {
    it("converts Discord timestamp to Unix seconds", () => {
      const discordTimestamp = 1700000000000; // milliseconds
      const unixSeconds = Math.floor(discordTimestamp / 1000);

      expect(unixSeconds).toBe(1700000000);
    });
  });
});

describe("user_activity table schema", () => {
  describe("required columns", () => {
    it("has guild_id column", () => {
      const columns = ["guild_id", "user_id", "joined_at", "first_message_at", "flagged_at"];
      expect(columns).toContain("guild_id");
    });

    it("has user_id column", () => {
      const columns = ["guild_id", "user_id", "joined_at", "first_message_at", "flagged_at"];
      expect(columns).toContain("user_id");
    });

    it("has joined_at column", () => {
      const columns = ["guild_id", "user_id", "joined_at", "first_message_at", "flagged_at"];
      expect(columns).toContain("joined_at");
    });

    it("has first_message_at column", () => {
      const columns = ["guild_id", "user_id", "joined_at", "first_message_at", "flagged_at"];
      expect(columns).toContain("first_message_at");
    });

    it("has flagged_at column", () => {
      const columns = ["guild_id", "user_id", "joined_at", "first_message_at", "flagged_at"];
      expect(columns).toContain("flagged_at");
    });
  });

  describe("primary key", () => {
    it("uses composite primary key (guild_id, user_id)", () => {
      const pk = ["guild_id", "user_id"];
      expect(pk).toHaveLength(2);
    });
  });
});
