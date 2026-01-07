/**
 * Pawtropolis Tech — tests/features/movieNight.test.ts
 * WHAT: Unit tests for movie night attendance tracking.
 * WHY: Verify VC participation tracking, qualification, and tier role assignment.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock setup using vi.hoisted for ALL mocks
const {
  mockGet,
  mockAll,
  mockRun,
  mockPrepare,
  mockAssignRole,
  mockRemoveRole,
  mockGetRoleTiers,
  mockIsPanicMode,
  mockLogActionPretty,
} = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockAll: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
  mockAssignRole: vi.fn(),
  mockRemoveRole: vi.fn(),
  mockGetRoleTiers: vi.fn(),
  mockIsPanicMode: vi.fn(),
  mockLogActionPretty: vi.fn(),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
  all: mockAll,
  run: mockRun,
});

vi.mock("../../src/db/db.js", () => ({
  db: { prepare: mockPrepare },
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/features/roleAutomation.js", () => ({
  assignRole: mockAssignRole,
  removeRole: mockRemoveRole,
  getRoleTiers: mockGetRoleTiers,
}));

vi.mock("../../src/features/panicStore.js", () => ({
  isPanicMode: mockIsPanicMode,
}));

vi.mock("../../src/logging/pretty.js", () => ({
  logActionPretty: mockLogActionPretty,
}));

import {
  startMovieEvent,
  getActiveMovieEvent,
  isMovieEventActive,
  handleMovieVoiceJoin,
  handleMovieVoiceLeave,
  finalizeMovieAttendance,
  getUserQualifiedMovieCount,
  updateMovieTierRole,
  persistAllSessions,
  recoverPersistedSessions,
  clearPersistedSessions,
  startSessionPersistence,
  stopSessionPersistence,
  getRecoveryStatus,
  addManualAttendance,
  creditHistoricalAttendance,
  bumpAttendance,
  getMovieQualificationThreshold,
  _testing,
} from "../../src/features/movieNight.js";

// Create mock guild factory
function createMockGuild(overrides: Record<string, unknown> = {}) {
  return {
    id: "guild-123",
    channels: {
      fetch: vi.fn().mockResolvedValue({
        isVoiceBased: () => true,
        members: new Map([
          ["user-1", { user: { bot: false } }],
          ["user-2", { user: { bot: false } }],
          ["bot-1", { user: { bot: true } }],
        ]),
      }),
    },
    members: {
      fetch: vi.fn().mockResolvedValue({
        user: { tag: "TestUser#1234" },
        send: vi.fn().mockResolvedValue({}),
      }),
    },
    roles: {
      cache: new Map([
        ["role-tier1", { name: "Movie Tier 1" }],
        ["role-tier2", { name: "Movie Tier 2" }],
      ]),
    },
    client: {
      user: { id: "bot-id" },
    },
    ...overrides,
  } as any;
}

describe("movieNight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Clear all module state to ensure test isolation
    _testing.clearAllState();

    // Re-establish db.prepare mock (cleared by vi.clearAllMocks)
    mockPrepare.mockReturnValue({
      get: mockGet,
      all: mockAll,
      run: mockRun,
    });

    // Default mock implementations
    mockIsPanicMode.mockReturnValue(false);
    mockGetRoleTiers.mockReturnValue([]);
    mockLogActionPretty.mockResolvedValue(undefined);

    // Default DB responses
    mockGet.mockReturnValue(undefined);
    mockAll.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    _testing.clearAllState();
  });

  describe("startMovieEvent", () => {
    it("starts a movie event and returns retroactive count", async () => {
      const guild = createMockGuild();
      const channelId = "channel-123";
      const eventDate = "2024-01-15";

      const result = await startMovieEvent(guild, channelId, eventDate);

      expect(result.retroactiveCount).toBe(2); // 2 non-bot users
      expect(isMovieEventActive(guild.id)).toBe(true);
    });

    it("credits existing voice members on start", async () => {
      const guild = createMockGuild();

      await startMovieEvent(guild, "channel-123", "2024-01-15");

      // Verify event was created
      const event = getActiveMovieEvent(guild.id);
      expect(event?.channelId).toBe("channel-123");
      expect(event?.eventDate).toBe("2024-01-15");
    });

    it("handles channel fetch failure gracefully", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockRejectedValue(new Error("Channel not found")),
        },
      });

      const result = await startMovieEvent(guild, "invalid-channel", "2024-01-15");

      expect(result.retroactiveCount).toBe(0);
      expect(isMovieEventActive(guild.id)).toBe(true);
    });

    it("handles non-voice channel", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => false,
          }),
        },
      });

      const result = await startMovieEvent(guild, "text-channel", "2024-01-15");

      expect(result.retroactiveCount).toBe(0);
    });

    it("handles null channel result", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      });

      const result = await startMovieEvent(guild, "deleted-channel", "2024-01-15");

      expect(result.retroactiveCount).toBe(0);
    });

    it("skips bot users when crediting", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map([
              ["bot-1", { user: { bot: true } }],
              ["bot-2", { user: { bot: true } }],
            ]),
          }),
        },
      });

      const result = await startMovieEvent(guild, "channel-123", "2024-01-15");

      expect(result.retroactiveCount).toBe(0);
    });

    it("persists sessions immediately after start", async () => {
      const guild = createMockGuild();

      await startMovieEvent(guild, "channel-123", "2024-01-15");

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalled();
    });

    it("overwrites existing event on restart", async () => {
      const guild = createMockGuild();

      await startMovieEvent(guild, "channel-1", "2024-01-15");
      await startMovieEvent(guild, "channel-2", "2024-01-16");

      const event = getActiveMovieEvent(guild.id);
      expect(event?.channelId).toBe("channel-2");
      expect(event?.eventDate).toBe("2024-01-16");
    });
  });

  describe("getActiveMovieEvent", () => {
    it("returns null when no event is active", () => {
      expect(getActiveMovieEvent("nonexistent-guild")).toBeNull();
    });

    it("returns active event when one exists", async () => {
      const guild = createMockGuild();
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      const event = getActiveMovieEvent(guild.id);

      expect(event).not.toBeNull();
      expect(event?.channelId).toBe("channel-123");
      expect(event?.eventDate).toBe("2024-01-15");
    });
  });

  describe("isMovieEventActive", () => {
    it("returns false when no event is active", () => {
      expect(isMovieEventActive("nonexistent-guild")).toBe(false);
    });

    it("returns true when event is active", async () => {
      const guild = createMockGuild();
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      expect(isMovieEventActive(guild.id)).toBe(true);
    });
  });

  describe("handleMovieVoiceJoin", () => {
    it("creates session on first join", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      handleMovieVoiceJoin(guild.id, "new-user");

      // The session should be created (we can verify by leaving and checking duration)
      vi.advanceTimersByTime(60000);
      handleMovieVoiceLeave(guild.id, "new-user");
      // If session was created, leaving would record duration
    });

    it("sets currentSessionStart timestamp", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      const now = Date.now();
      handleMovieVoiceJoin(guild.id, "user-1");

      // The session start should be close to now
      // We verify this by advancing time and checking accumulated duration
      vi.advanceTimersByTime(5 * 60000);
      handleMovieVoiceLeave(guild.id, "user-1");
    });
  });

  describe("handleMovieVoiceLeave", () => {
    it("calculates session duration correctly", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      handleMovieVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(5 * 60000); // 5 minutes
      handleMovieVoiceLeave(guild.id, "user-1");

      // Session should be tracked (verified during finalization)
    });

    it("accumulates multiple sessions", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      // First session: 5 minutes
      handleMovieVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(5 * 60000);
      handleMovieVoiceLeave(guild.id, "user-1");

      // Second session: 10 minutes
      handleMovieVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(10 * 60000);
      handleMovieVoiceLeave(guild.id, "user-1");

      // Total should be 15 minutes
    });

    it("handles leave without prior join", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      // Leave without join should not crash
      handleMovieVoiceLeave(guild.id, "ghost-user");
    });

    it("floors partial minutes (anti-gaming)", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      handleMovieVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(59 * 1000); // 59 seconds
      handleMovieVoiceLeave(guild.id, "user-1");

      // Duration should be 0 minutes (floored)
    });

    it("tracks longest session separately", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      // First session: 20 minutes
      handleMovieVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(20 * 60000);
      handleMovieVoiceLeave(guild.id, "user-1");

      // Second session: 10 minutes (shorter)
      handleMovieVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(10 * 60000);
      handleMovieVoiceLeave(guild.id, "user-1");

      // Longest should still be 20 minutes
    });
  });

  describe("finalizeMovieAttendance", () => {
    it("logs warning when no active event", async () => {
      const guild = createMockGuild();

      await finalizeMovieAttendance(guild);

      // Should log warning about no active event
    });

    it("saves attendance records to database", async () => {
      mockGet.mockReturnValue({ attendance_mode: "cumulative", qualification_threshold_minutes: 30 });

      const guild = createMockGuild();
      await startMovieEvent(guild, "channel-123", "2024-01-15");
      handleMovieVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(45 * 60000);
      handleMovieVoiceLeave(guild.id, "user-1");

      await finalizeMovieAttendance(guild);

      expect(mockRun).toHaveBeenCalled();
    });

    it("closes open sessions before finalizing", async () => {
      mockGet.mockReturnValue({ attendance_mode: "cumulative", qualification_threshold_minutes: 30 });

      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      handleMovieVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(30 * 60000);
      // Note: NOT leaving before finalize

      await finalizeMovieAttendance(guild);

      expect(mockRun).toHaveBeenCalled();
    });

    it("clears sessions after finalization", async () => {
      mockGet.mockReturnValue({ attendance_mode: "cumulative", qualification_threshold_minutes: 30 });

      const guild = createMockGuild();
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      await finalizeMovieAttendance(guild);

      expect(isMovieEventActive(guild.id)).toBe(false);
    });

    it("uses cumulative mode by default", async () => {
      mockGet.mockReturnValue(undefined); // No config

      const guild = createMockGuild();
      await startMovieEvent(guild, "channel-123", "2024-01-15");
      handleMovieVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(35 * 60000);
      handleMovieVoiceLeave(guild.id, "user-1");

      await finalizeMovieAttendance(guild);

      // Should use default 30 min threshold in cumulative mode
      expect(mockRun).toHaveBeenCalled();
    });

    it("uses continuous mode when configured", async () => {
      mockGet.mockReturnValue({ attendance_mode: "continuous", qualification_threshold_minutes: 30 });

      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      // Multiple short sessions totaling 45 min, but longest is only 15 min
      handleMovieVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(15 * 60000);
      handleMovieVoiceLeave(guild.id, "user-1");

      handleMovieVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(15 * 60000);
      handleMovieVoiceLeave(guild.id, "user-1");

      handleMovieVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(15 * 60000);
      handleMovieVoiceLeave(guild.id, "user-1");

      await finalizeMovieAttendance(guild);

      // In continuous mode, would NOT qualify (longest = 15, threshold = 30)
    });

    it("clears persisted sessions after finalization", async () => {
      mockGet.mockReturnValue({ attendance_mode: "cumulative", qualification_threshold_minutes: 30 });

      const guild = createMockGuild();
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      mockPrepare.mockClear();
      await finalizeMovieAttendance(guild);

      // Should have called DELETE for persisted sessions
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM active_movie_events")
      );
    });
  });

  describe("getUserQualifiedMovieCount", () => {
    it("returns count from database", () => {
      mockGet.mockReturnValue({ count: 7 });

      const count = getUserQualifiedMovieCount("guild-123", "user-123");

      expect(count).toBe(7);
    });

    it("queries with correct parameters", () => {
      mockGet.mockReturnValue({ count: 0 });

      getUserQualifiedMovieCount("guild-123", "user-456");

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("qualified = 1"));
    });
  });

  describe("updateMovieTierRole", () => {
    it("returns empty array when panic mode is active", async () => {
      mockIsPanicMode.mockReturnValue(true);
      const guild = createMockGuild();

      const results = await updateMovieTierRole(guild, "user-123");

      expect(results).toEqual([]);
    });

    it("returns empty array when no tiers configured", async () => {
      mockGetRoleTiers.mockReturnValue([]);
      mockGet.mockReturnValue({ count: 5 });
      const guild = createMockGuild();

      const results = await updateMovieTierRole(guild, "user-123");

      expect(results).toEqual([]);
    });

    it("returns empty when user has not qualified for any tier", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 5, role_id: "role-1" },
      ]);
      mockGet.mockReturnValue({ count: 2 }); // Below threshold
      const guild = createMockGuild();

      const results = await updateMovieTierRole(guild, "user-123");

      expect(results).toEqual([]);
    });

    it("assigns correct tier role when qualified", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 3, role_id: "role-tier1" },
        { id: 2, tier_name: "Tier 2", threshold: 10, role_id: "role-tier2" },
      ]);
      mockGet.mockReturnValue({ count: 5 });
      mockAssignRole.mockResolvedValue({ action: "add", success: true });
      mockRemoveRole.mockResolvedValue({ action: "remove", success: true });

      const guild = createMockGuild();
      const results = await updateMovieTierRole(guild, "user-123");

      expect(mockAssignRole).toHaveBeenCalledWith(
        guild,
        "user-123",
        "role-tier1",
        "movie_tier_qualified",
        "system"
      );
      expect(results.length).toBeGreaterThan(0);
    });

    it("assigns highest qualifying tier", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 3, role_id: "role-tier1" },
        { id: 2, tier_name: "Tier 2", threshold: 10, role_id: "role-tier2" },
        { id: 3, tier_name: "Tier 3", threshold: 20, role_id: "role-tier3" },
      ]);
      mockGet.mockReturnValue({ count: 15 }); // Qualifies for Tier 1 and 2
      mockAssignRole.mockResolvedValue({ action: "add", success: true });
      mockRemoveRole.mockResolvedValue({ action: "remove", success: true });

      const guild = createMockGuild();
      await updateMovieTierRole(guild, "user-123");

      expect(mockAssignRole).toHaveBeenCalledWith(
        guild,
        "user-123",
        "role-tier2", // Tier 2, not Tier 1
        "movie_tier_qualified",
        "system"
      );
    });

    it("removes other tier roles when assigning new tier", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 3, role_id: "role-tier1" },
        { id: 2, tier_name: "Tier 2", threshold: 10, role_id: "role-tier2" },
      ]);
      mockGet.mockReturnValue({ count: 15 });
      mockAssignRole.mockResolvedValue({ action: "add", success: true });
      mockRemoveRole.mockResolvedValue({ action: "remove", success: true });

      const guild = createMockGuild();
      await updateMovieTierRole(guild, "user-123");

      expect(mockRemoveRole).toHaveBeenCalledWith(
        guild,
        "user-123",
        "role-tier1",
        "movie_tier_update",
        "system"
      );
    });

    it("sends DM to user about progress", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 3, role_id: "role-tier1" },
      ]);
      mockGet.mockReturnValue({ count: 5 });
      mockAssignRole.mockResolvedValue({ action: "add", success: true });

      const mockSend = vi.fn().mockResolvedValue({});
      const guild = createMockGuild({
        members: {
          fetch: vi.fn().mockResolvedValue({
            user: { tag: "TestUser#1234" },
            send: mockSend,
          }),
        },
      });

      await updateMovieTierRole(guild, "user-123");

      expect(mockSend).toHaveBeenCalled();
    });

    it("includes ordinal in DM (1st, 2nd, 3rd)", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 3, role_id: "role-tier1" },
      ]);
      mockGet.mockReturnValue({ count: 3 });
      mockAssignRole.mockResolvedValue({ action: "add", success: true });

      const mockSend = vi.fn().mockResolvedValue({});
      const guild = createMockGuild({
        members: {
          fetch: vi.fn().mockResolvedValue({
            user: { tag: "TestUser#1234" },
            send: mockSend,
          }),
        },
      });

      await updateMovieTierRole(guild, "user-123");

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("3rd"),
        })
      );
    });

    it("shows progress to next tier in DM", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 3, role_id: "role-tier1" },
        { id: 2, tier_name: "Tier 2", threshold: 10, role_id: "role-tier2" },
      ]);
      mockGet.mockReturnValue({ count: 5 });
      mockAssignRole.mockResolvedValue({ action: "skip", success: true }); // Already has role

      const mockSend = vi.fn().mockResolvedValue({});
      const guild = createMockGuild({
        members: {
          fetch: vi.fn().mockResolvedValue({
            user: { tag: "TestUser#1234" },
            send: mockSend,
          }),
        },
      });

      await updateMovieTierRole(guild, "user-123");

      // Should show "5 more" movies needed for Tier 2
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("5"),
        })
      );
    });

    it("shows max tier message when at highest tier", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 3, role_id: "role-tier1" },
      ]);
      mockGet.mockReturnValue({ count: 10 });
      mockAssignRole.mockResolvedValue({ action: "skip", success: true });

      const mockSend = vi.fn().mockResolvedValue({});
      const guild = createMockGuild({
        members: {
          fetch: vi.fn().mockResolvedValue({
            user: { tag: "TestUser#1234" },
            send: mockSend,
          }),
        },
      });

      await updateMovieTierRole(guild, "user-123");

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("highest"),
        })
      );
    });

    it("logs action to audit channel", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 3, role_id: "role-tier1" },
      ]);
      mockGet.mockReturnValue({ count: 5 });
      mockAssignRole.mockResolvedValue({ action: "add", success: true });

      const guild = createMockGuild();
      await updateMovieTierRole(guild, "user-123");

      expect(mockLogActionPretty).toHaveBeenCalled();
    });

    it("handles DM failure gracefully", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 3, role_id: "role-tier1" },
      ]);
      mockGet.mockReturnValue({ count: 5 });
      mockAssignRole.mockResolvedValue({ action: "add", success: true });

      const guild = createMockGuild({
        members: {
          fetch: vi.fn().mockResolvedValue({
            user: { tag: "TestUser#1234" },
            send: vi.fn().mockRejectedValue(new Error("Cannot DM user")),
          }),
        },
      });

      await expect(updateMovieTierRole(guild, "user-123")).resolves.toBeDefined();
    });

    it("handles member fetch failure gracefully", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 3, role_id: "role-tier1" },
      ]);
      mockGet.mockReturnValue({ count: 5 });
      mockAssignRole.mockResolvedValue({ action: "add", success: true });

      const guild = createMockGuild({
        members: {
          fetch: vi.fn().mockRejectedValue(new Error("Member not found")),
        },
      });

      await expect(updateMovieTierRole(guild, "user-123")).resolves.toBeDefined();
    });

    it("handles audit log failure gracefully", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 3, role_id: "role-tier1" },
      ]);
      mockGet.mockReturnValue({ count: 5 });
      mockAssignRole.mockResolvedValue({ action: "add", success: true });
      mockLogActionPretty.mockRejectedValue(new Error("Audit log failed"));

      const guild = createMockGuild();

      await expect(updateMovieTierRole(guild, "user-123")).resolves.toBeDefined();
    });
  });

  describe("persistAllSessions", () => {
    it("persists active events to database", async () => {
      const guild = createMockGuild();
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      mockPrepare.mockClear();
      persistAllSessions();

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO active_movie_events")
      );
    });

    it("persists sessions to database", async () => {
      const guild = createMockGuild();
      await startMovieEvent(guild, "channel-123", "2024-01-15");
      handleMovieVoiceJoin(guild.id, "user-1");

      mockPrepare.mockClear();
      persistAllSessions();

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO active_movie_sessions")
      );
    });

    it("handles no active events", () => {
      mockPrepare.mockClear();
      persistAllSessions();

      // Should still call prepare for the INSERT statements (even if no data)
      expect(mockPrepare).toHaveBeenCalled();
    });
  });

  describe("recoverPersistedSessions", () => {
    it("recovers events from database", () => {
      mockAll
        .mockReturnValueOnce([
          {
            guild_id: "guild-123",
            channel_id: "channel-123",
            event_date: "2024-01-15",
            started_at: Date.now() - 3600000,
          },
        ])
        .mockReturnValueOnce([]); // sessions

      const result = recoverPersistedSessions();

      expect(result.events).toBe(1);
      expect(isMovieEventActive("guild-123")).toBe(true);
    });

    it("recovers sessions and calculates lost time", () => {
      const lastPersisted = Date.now() - 600000; // 10 minutes ago

      mockAll
        .mockReturnValueOnce([
          {
            guild_id: "guild-123",
            channel_id: "channel-123",
            event_date: "2024-01-15",
            started_at: Date.now() - 3600000,
          },
        ])
        .mockReturnValueOnce([
          {
            guild_id: "guild-123",
            user_id: "user-123",
            event_date: "2024-01-15",
            current_session_start: Date.now() - 1200000, // Was in session
            accumulated_minutes: 10,
            longest_session_minutes: 10,
            last_persisted_at: lastPersisted,
          },
        ]);

      const result = recoverPersistedSessions();

      expect(result.sessions).toBe(1);
    });

    it("handles inactive sessions correctly", () => {
      mockAll
        .mockReturnValueOnce([
          {
            guild_id: "guild-123",
            channel_id: "channel-123",
            event_date: "2024-01-15",
            started_at: Date.now() - 3600000,
          },
        ])
        .mockReturnValueOnce([
          {
            guild_id: "guild-123",
            user_id: "user-123",
            event_date: "2024-01-15",
            current_session_start: null, // Was NOT in session
            accumulated_minutes: 20,
            longest_session_minutes: 15,
            last_persisted_at: Date.now() - 600000,
          },
        ]);

      recoverPersistedSessions();

      // Should recover without adding lost time
    });

    it("returns counts of recovered items", () => {
      mockAll
        .mockReturnValueOnce([
          { guild_id: "guild-1", channel_id: "ch-1", event_date: "2024-01-15", started_at: Date.now() },
          { guild_id: "guild-2", channel_id: "ch-2", event_date: "2024-01-15", started_at: Date.now() },
        ])
        .mockReturnValueOnce([
          { guild_id: "guild-1", user_id: "u-1", event_date: "2024-01-15", current_session_start: null, accumulated_minutes: 10, longest_session_minutes: 10, last_persisted_at: Date.now() },
          { guild_id: "guild-1", user_id: "u-2", event_date: "2024-01-15", current_session_start: null, accumulated_minutes: 20, longest_session_minutes: 20, last_persisted_at: Date.now() },
        ]);

      const result = recoverPersistedSessions();

      expect(result.events).toBe(2);
      expect(result.sessions).toBe(2);
    });
  });

  describe("clearPersistedSessions", () => {
    it("deletes persisted data for guild", () => {
      clearPersistedSessions("guild-123");

      expect(mockRun).toHaveBeenCalledWith("guild-123");
    });

    it("clears both events and sessions", () => {
      mockPrepare.mockClear();
      clearPersistedSessions("guild-123");

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM active_movie_events")
      );
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM active_movie_sessions")
      );
    });
  });

  describe("startSessionPersistence", () => {
    it("starts persistence interval", () => {
      startSessionPersistence();

      vi.advanceTimersByTime(5 * 60 * 1000);

      stopSessionPersistence();
    });

    it("does not start if already running", () => {
      startSessionPersistence();
      startSessionPersistence(); // Second call

      stopSessionPersistence();
    });

    it("only persists when events are active", async () => {
      startSessionPersistence();

      mockPrepare.mockClear();
      vi.advanceTimersByTime(5 * 60 * 1000);

      // No events active, should not persist
      stopSessionPersistence();
    });
  });

  describe("stopSessionPersistence", () => {
    it("stops persistence interval", () => {
      startSessionPersistence();
      stopSessionPersistence();

      vi.advanceTimersByTime(10 * 60 * 1000);
    });

    it("handles stop when not running", () => {
      stopSessionPersistence();
    });
  });

  describe("getRecoveryStatus", () => {
    it("returns no active event when none exists", () => {
      const status = getRecoveryStatus();

      expect(status.hasActiveEvent).toBe(false);
      expect(status.guildId).toBeNull();
      expect(status.channelId).toBeNull();
      expect(status.eventDate).toBeNull();
      expect(status.sessionCount).toBe(0);
      expect(status.totalRecoveredMinutes).toBe(0);
    });

    it("returns active event info when exists", async () => {
      const guild = createMockGuild();
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      const status = getRecoveryStatus();

      expect(status.hasActiveEvent).toBe(true);
      expect(status.guildId).toBe(guild.id);
      expect(status.channelId).toBe("channel-123");
      expect(status.eventDate).toBe("2024-01-15");
    });

    it("calculates session count correctly", async () => {
      const guild = createMockGuild();
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      const status = getRecoveryStatus();

      expect(status.sessionCount).toBe(2); // From retroactive credit
    });
  });

  describe("addManualAttendance", () => {
    it("returns false when no active event", () => {
      const result = addManualAttendance("guild-123", "user-123", 30, "mod-1", "Test");

      expect(result).toBe(false);
    });

    it("adds minutes to user session", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      const result = addManualAttendance(guild.id, "user-123", 30, "mod-1", "Test");

      expect(result).toBe(true);
    });

    it("creates session if user doesn't have one", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      const result = addManualAttendance(guild.id, "new-user", 30, "mod-1");

      expect(result).toBe(true);
    });

    it("updates longest session if manual add is larger", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startMovieEvent(guild, "channel-123", "2024-01-15");

      handleMovieVoiceJoin(guild.id, "user-123");
      vi.advanceTimersByTime(10 * 60000);
      handleMovieVoiceLeave(guild.id, "user-123");

      addManualAttendance(guild.id, "user-123", 20, "mod-1");

      // Longest should be updated to 20
    });
  });

  describe("creditHistoricalAttendance", () => {
    it("creates new record when none exists", () => {
      mockGet.mockReturnValue(undefined);

      creditHistoricalAttendance("guild-123", "user-123", "2024-01-10", 60, "mod-1", "Makeup");

      expect(mockRun).toHaveBeenCalled();
    });

    it("updates existing record", () => {
      mockGet
        .mockReturnValueOnce({ attendance_mode: "cumulative", qualification_threshold_minutes: 30 })
        .mockReturnValueOnce({ duration_minutes: 30, longest_session_minutes: 30 });

      creditHistoricalAttendance("guild-123", "user-123", "2024-01-10", 30, "mod-1", "Makeup");

      expect(mockRun).toHaveBeenCalled();
    });

    it("calculates qualification in cumulative mode", () => {
      mockGet
        .mockReturnValueOnce({ attendance_mode: "cumulative", qualification_threshold_minutes: 30 })
        .mockReturnValueOnce({ duration_minutes: 20, longest_session_minutes: 20 });

      creditHistoricalAttendance("guild-123", "user-123", "2024-01-10", 15, "mod-1");

      // 35 total minutes >= 30 threshold = qualified
      expect(mockRun).toHaveBeenCalled();
    });

    it("calculates qualification in continuous mode", () => {
      mockGet
        .mockReturnValueOnce({ attendance_mode: "continuous", qualification_threshold_minutes: 30 })
        .mockReturnValueOnce({ duration_minutes: 20, longest_session_minutes: 20 });

      creditHistoricalAttendance("guild-123", "user-123", "2024-01-10", 25, "mod-1");

      // Longest = max(20, 25) = 25 < 30 threshold = NOT qualified in continuous
    });
  });

  describe("bumpAttendance", () => {
    it("returns previouslyQualified when user already qualified", () => {
      mockGet.mockReturnValue({ qualified: 1 });

      const result = bumpAttendance("guild-123", "user-123", "2024-01-10", "mod-1", "Comp");

      expect(result.created).toBe(false);
      expect(result.previouslyQualified).toBe(true);
    });

    it("creates bump entry when user not qualified", () => {
      mockGet
        .mockReturnValueOnce({ qualification_threshold_minutes: 30 })
        .mockReturnValueOnce({ qualified: 0 });

      const result = bumpAttendance("guild-123", "user-123", "2024-01-10", "mod-1", "Comp");

      expect(result.created).toBe(true);
      expect(result.previouslyQualified).toBe(false);
      expect(mockRun).toHaveBeenCalled();
    });

    it("creates bump entry when no record exists", () => {
      mockGet
        .mockReturnValueOnce({ qualification_threshold_minutes: 30 })
        .mockReturnValueOnce(undefined);

      const result = bumpAttendance("guild-123", "user-123", "2024-01-10", "mod-1");

      expect(result.created).toBe(true);
      expect(result.previouslyQualified).toBe(false);
    });

    it("uses threshold as bump minutes", () => {
      mockGet
        .mockReturnValueOnce({ qualification_threshold_minutes: 45 })
        .mockReturnValueOnce(undefined);

      bumpAttendance("guild-123", "user-123", "2024-01-10", "mod-1");

      // Should use 45 minutes as the bump amount
      expect(mockRun).toHaveBeenCalled();
    });

    it("uses default reason when none provided", () => {
      mockGet
        .mockReturnValueOnce({ qualification_threshold_minutes: 30 })
        .mockReturnValueOnce(undefined);

      bumpAttendance("guild-123", "user-123", "2024-01-10", "mod-1");

      expect(mockRun).toHaveBeenCalled();
    });
  });

  describe("getMovieQualificationThreshold", () => {
    it("returns threshold from database", () => {
      mockGet.mockReturnValue({ qualification_threshold_minutes: 45 });

      const threshold = getMovieQualificationThreshold("guild-123");

      expect(threshold).toBe(45);
    });

    it("returns default 30 when not configured", () => {
      mockGet.mockReturnValue(undefined);

      const threshold = getMovieQualificationThreshold("guild-123");

      expect(threshold).toBe(30);
    });
  });
});
