/**
 * Pawtropolis Tech — tests/features/events/gameNight.test.ts
 * WHAT: Unit tests for game night attendance tracking.
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
  mockGetGameConfig,
  mockCalculateGameSessionQualification,
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
  mockGetGameConfig: vi.fn(),
  mockCalculateGameSessionQualification: vi.fn(),
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

vi.mock("../../../src/db/db.js", () => ({
  db: { prepare: mockPrepare },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/store/gameConfigStore.js", () => ({
  getGameConfig: mockGetGameConfig,
}));

vi.mock("../../../src/features/events/gameQualification.js", () => ({
  calculateGameSessionQualification: mockCalculateGameSessionQualification,
}));

vi.mock("../../../src/features/roleAutomation.js", () => ({
  assignRole: mockAssignRole,
  removeRole: mockRemoveRole,
  getRoleTiers: mockGetRoleTiers,
}));

vi.mock("../../../src/features/panicStore.js", () => ({
  isPanicMode: mockIsPanicMode,
}));

vi.mock("../../../src/logging/pretty.js", () => ({
  logActionPretty: mockLogActionPretty,
}));

import {
  startGameEvent,
  getActiveGameEvent,
  isGameEventActive,
  handleGameVoiceJoin,
  handleGameVoiceLeave,
  finalizeGameAttendance,
  getUserQualifiedGameCount,
  getUserTotalEventCount,
  getGameEventStats,
  persistAllGameSessions,
  recoverPersistedGameSessions,
  clearPersistedGameSessions,
  startGameSessionPersistence,
  stopGameSessionPersistence,
  getGameRecoveryStatus,
  addManualGameAttendance,
  creditHistoricalGameAttendance,
  bumpGameAttendance,
  getCurrentGameSession,
  getAllGameSessions,
  updateGameTierRole,
  _testing,
} from "../../../src/features/events/gameNight.js";

// Create mock guild and channel factories
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
        ["role-tier1", { name: "Game Tier 1" }],
        ["role-tier2", { name: "Game Tier 2" }],
      ]),
    },
    client: {
      user: { id: "bot-id" },
    },
    ...overrides,
  } as any;
}

describe("gameNight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Clear all module state first (critical for test isolation!)
    _testing.clearAllState();

    // Re-establish db mock after clearAllMocks (critical!)
    mockPrepare.mockReturnValue({
      get: mockGet,
      all: mockAll,
      run: mockRun,
    });

    // Default mock implementations
    mockGetGameConfig.mockReturnValue({
      qualificationPercentage: 50,
      attendanceMode: "cumulative",
    });

    mockIsPanicMode.mockReturnValue(false);
    mockGetRoleTiers.mockReturnValue([]);
    mockLogActionPretty.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clean up all module state
    _testing.clearAllState();
  });

  describe("startGameEvent", () => {
    it("starts a game event and returns retroactive count", async () => {
      const guild = createMockGuild();
      const channelId = "channel-123";
      const eventDate = "2024-01-15";

      const result = await startGameEvent(guild, channelId, eventDate);

      // 2 non-bot users should be credited
      expect(result.retroactiveCount).toBe(2);
      expect(isGameEventActive(guild.id)).toBe(true);
    });

    it("credits existing voice members on start", async () => {
      const guild = createMockGuild();

      await startGameEvent(guild, "channel-123", "2024-01-15");

      // Check that sessions were created for existing members
      const sessions = getAllGameSessions(guild.id);
      expect(sessions.size).toBe(2);
    });

    it("handles channel fetch failure gracefully", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockRejectedValue(new Error("Channel not found")),
        },
      });

      const result = await startGameEvent(guild, "invalid-channel", "2024-01-15");

      expect(result.retroactiveCount).toBe(0);
      expect(isGameEventActive(guild.id)).toBe(true);
    });

    it("handles non-voice channel", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => false,
          }),
        },
      });

      const result = await startGameEvent(guild, "text-channel", "2024-01-15");

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

      const result = await startGameEvent(guild, "channel-123", "2024-01-15");

      expect(result.retroactiveCount).toBe(0);
    });

    it("persists sessions immediately after start", async () => {
      const guild = createMockGuild();

      await startGameEvent(guild, "channel-123", "2024-01-15");

      // Should have called db.prepare for persisting events and sessions
      expect(mockPrepare).toHaveBeenCalled();
    });
  });

  describe("getActiveGameEvent", () => {
    it("returns null when no event is active", () => {
      expect(getActiveGameEvent("nonexistent-guild")).toBeNull();
    });

    it("returns active event when one exists", async () => {
      const guild = createMockGuild();
      await startGameEvent(guild, "channel-123", "2024-01-15");

      const event = getActiveGameEvent(guild.id);

      expect(event).not.toBeNull();
      expect(event?.channelId).toBe("channel-123");
      expect(event?.eventDate).toBe("2024-01-15");
      expect(event?.eventType).toBe("game");
    });
  });

  describe("isGameEventActive", () => {
    it("returns false when no event is active", () => {
      expect(isGameEventActive("nonexistent-guild")).toBe(false);
    });

    it("returns true when event is active", async () => {
      const guild = createMockGuild();
      await startGameEvent(guild, "channel-123", "2024-01-15");

      expect(isGameEventActive(guild.id)).toBe(true);
    });
  });

  describe("handleGameVoiceJoin", () => {
    it("creates session on first join", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startGameEvent(guild, "channel-123", "2024-01-15");

      handleGameVoiceJoin(guild.id, "new-user");

      const session = getCurrentGameSession(guild.id, "new-user");
      expect(session).not.toBeNull();
      expect(session?.currentSessionStart).not.toBeNull();
    });

    it("updates existing session on rejoin", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startGameEvent(guild, "channel-123", "2024-01-15");

      handleGameVoiceJoin(guild.id, "user-1");
      const firstJoinTime = getCurrentGameSession(guild.id, "user-1")?.currentSessionStart;

      vi.advanceTimersByTime(60000); // 1 minute
      handleGameVoiceLeave(guild.id, "user-1");
      handleGameVoiceJoin(guild.id, "user-1");

      const session = getCurrentGameSession(guild.id, "user-1");
      expect(session?.currentSessionStart).not.toBe(firstJoinTime);
    });
  });

  describe("handleGameVoiceLeave", () => {
    it("calculates session duration correctly", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startGameEvent(guild, "channel-123", "2024-01-15");

      handleGameVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(5 * 60000); // 5 minutes
      handleGameVoiceLeave(guild.id, "user-1");

      const session = getCurrentGameSession(guild.id, "user-1");
      expect(session?.totalMinutes).toBe(5);
      expect(session?.longestSessionMinutes).toBe(5);
      expect(session?.currentSessionStart).toBeNull();
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
      await startGameEvent(guild, "channel-123", "2024-01-15");

      // First session: 5 minutes
      handleGameVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(5 * 60000);
      handleGameVoiceLeave(guild.id, "user-1");

      // Second session: 10 minutes
      handleGameVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(10 * 60000);
      handleGameVoiceLeave(guild.id, "user-1");

      const session = getCurrentGameSession(guild.id, "user-1");
      expect(session?.totalMinutes).toBe(15);
      expect(session?.longestSessionMinutes).toBe(10);
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
      await startGameEvent(guild, "channel-123", "2024-01-15");

      // Leave without join should not crash
      handleGameVoiceLeave(guild.id, "ghost-user");

      const session = getCurrentGameSession(guild.id, "ghost-user");
      expect(session?.totalMinutes).toBe(0);
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
      await startGameEvent(guild, "channel-123", "2024-01-15");

      handleGameVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(59 * 1000); // 59 seconds
      handleGameVoiceLeave(guild.id, "user-1");

      const session = getCurrentGameSession(guild.id, "user-1");
      expect(session?.totalMinutes).toBe(0); // Floored
    });
  });

  describe("finalizeGameAttendance", () => {
    it("returns empty array when no active event", async () => {
      const guild = createMockGuild();

      const results = await finalizeGameAttendance(guild);

      expect(results).toEqual([]);
    });

    it("finalizes attendance and returns results", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map([["user-1", { user: { bot: false } }]]),
          }),
        },
      });
      await startGameEvent(guild, "channel-123", "2024-01-15");

      mockCalculateGameSessionQualification.mockReturnValue({
        qualified: true,
        userMinutes: 60,
        eventDurationMinutes: 120,
        attendancePercentage: 50,
        thresholdPercentage: 50,
        requiredMinutes: 60,
      });

      vi.advanceTimersByTime(60 * 60000); // 1 hour

      const results = await finalizeGameAttendance(guild);

      expect(results.length).toBeGreaterThan(0);
      expect(mockRun).toHaveBeenCalled();
    });

    it("closes open sessions before finalizing", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startGameEvent(guild, "channel-123", "2024-01-15");

      handleGameVoiceJoin(guild.id, "user-1");
      vi.advanceTimersByTime(30 * 60000);
      // Note: NOT leaving before finalize

      mockCalculateGameSessionQualification.mockReturnValue({
        qualified: true,
        userMinutes: 30,
        eventDurationMinutes: 30,
        attendancePercentage: 100,
        thresholdPercentage: 50,
        requiredMinutes: 15,
      });

      const results = await finalizeGameAttendance(guild);

      // Session should still be recorded
      expect(results.length).toBe(1);
    });

    it("clears state after finalization", async () => {
      const guild = createMockGuild();
      await startGameEvent(guild, "channel-123", "2024-01-15");

      mockCalculateGameSessionQualification.mockReturnValue({
        qualified: true,
        userMinutes: 60,
        eventDurationMinutes: 120,
        attendancePercentage: 50,
        thresholdPercentage: 50,
        requiredMinutes: 60,
      });

      await finalizeGameAttendance(guild);

      expect(isGameEventActive(guild.id)).toBe(false);
      expect(getAllGameSessions(guild.id).size).toBe(0);
    });
  });

  describe("getUserQualifiedGameCount", () => {
    it("returns count from database", () => {
      mockGet.mockReturnValue({ count: 5 });

      const count = getUserQualifiedGameCount("guild-123", "user-123");

      expect(count).toBe(5);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("event_type = 'game'"));
    });
  });

  describe("getUserTotalEventCount", () => {
    it("returns total event count from database", () => {
      mockGet.mockReturnValue({ count: 10 });

      const count = getUserTotalEventCount("guild-123", "user-123");

      expect(count).toBe(10);
    });
  });

  describe("getGameEventStats", () => {
    it("returns formatted stats from database", () => {
      mockGet.mockReturnValue({
        total: 15,
        qualified: 10,
        avg_minutes: 45.5,
        duration_ms: 7200000, // 2 hours
      });

      const stats = getGameEventStats("guild-123", "2024-01-15");

      expect(stats.totalParticipants).toBe(15);
      expect(stats.qualifiedCount).toBe(10);
      expect(stats.avgAttendanceMinutes).toBe(46); // Rounded
      expect(stats.eventDurationMinutes).toBe(120);
    });

    it("handles null values", () => {
      mockGet.mockReturnValue({
        total: 0,
        qualified: 0,
        avg_minutes: null,
        duration_ms: null,
      });

      const stats = getGameEventStats("guild-123", "2024-01-15");

      expect(stats.avgAttendanceMinutes).toBe(0);
      expect(stats.eventDurationMinutes).toBeNull();
    });
  });

  describe("persistAllGameSessions", () => {
    it("persists active events to database", async () => {
      const guild = createMockGuild();
      await startGameEvent(guild, "channel-123", "2024-01-15");

      mockPrepare.mockClear();
      persistAllGameSessions();

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO active_movie_events")
      );
    });

    it("persists sessions to database", async () => {
      const guild = createMockGuild();
      await startGameEvent(guild, "channel-123", "2024-01-15");
      handleGameVoiceJoin(guild.id, "user-1");

      mockPrepare.mockClear();
      persistAllGameSessions();

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO active_movie_sessions")
      );
    });
  });

  describe("recoverPersistedGameSessions", () => {
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

      const result = recoverPersistedGameSessions();

      expect(result.events).toBe(1);
      expect(isGameEventActive("guild-123")).toBe(true);
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

      const result = recoverPersistedGameSessions();

      expect(result.sessions).toBe(1);
      const session = getCurrentGameSession("guild-123", "user-123");
      // Should have accumulated lost time
      expect(session?.totalMinutes).toBeGreaterThan(10);
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

      recoverPersistedGameSessions();

      const session = getCurrentGameSession("guild-123", "user-123");
      expect(session?.currentSessionStart).toBeNull();
      expect(session?.totalMinutes).toBe(20); // No lost time added
    });
  });

  describe("clearPersistedGameSessions", () => {
    it("deletes persisted data for guild", () => {
      clearPersistedGameSessions("guild-123");

      expect(mockRun).toHaveBeenCalledWith("guild-123");
    });
  });

  describe("startGameSessionPersistence", () => {
    it("starts persistence interval", () => {
      startGameSessionPersistence();

      // Interval should be set
      vi.advanceTimersByTime(5 * 60 * 1000); // 5 minutes

      // Should not throw
      stopGameSessionPersistence();
    });

    it("does not start if already running", () => {
      startGameSessionPersistence();
      startGameSessionPersistence(); // Second call

      // Should log warning but not crash
      stopGameSessionPersistence();
    });
  });

  describe("stopGameSessionPersistence", () => {
    it("stops persistence interval", () => {
      startGameSessionPersistence();
      stopGameSessionPersistence();

      // Advancing time should not trigger persistence
      vi.advanceTimersByTime(10 * 60 * 1000);
    });

    it("handles stop when not running", () => {
      // Should not throw
      stopGameSessionPersistence();
    });
  });

  describe("getGameRecoveryStatus", () => {
    it("returns no active event when none exists", () => {
      const status = getGameRecoveryStatus();

      expect(status.hasActiveEvent).toBe(false);
      expect(status.guildId).toBeNull();
      expect(status.sessionCount).toBe(0);
    });

    it("returns active event info when exists", async () => {
      const guild = createMockGuild();
      await startGameEvent(guild, "channel-123", "2024-01-15");

      const status = getGameRecoveryStatus();

      expect(status.hasActiveEvent).toBe(true);
      expect(status.guildId).toBe(guild.id);
      expect(status.channelId).toBe("channel-123");
      expect(status.eventDate).toBe("2024-01-15");
      expect(status.sessionCount).toBe(2); // From retroactive credit
    });
  });

  describe("addManualGameAttendance", () => {
    it("returns false when no active event", () => {
      const result = addManualGameAttendance("guild-123", "user-123", 30, "mod-1", "Test");

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
      await startGameEvent(guild, "channel-123", "2024-01-15");

      const result = addManualGameAttendance(guild.id, "user-123", 30, "mod-1", "Test");

      expect(result).toBe(true);
      const session = getCurrentGameSession(guild.id, "user-123");
      expect(session?.totalMinutes).toBe(30);
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
      await startGameEvent(guild, "channel-123", "2024-01-15");

      handleGameVoiceJoin(guild.id, "user-123");
      vi.advanceTimersByTime(10 * 60000);
      handleGameVoiceLeave(guild.id, "user-123");

      addManualGameAttendance(guild.id, "user-123", 20, "mod-1", "Test");

      const session = getCurrentGameSession(guild.id, "user-123");
      expect(session?.longestSessionMinutes).toBe(20);
    });
  });

  describe("creditHistoricalGameAttendance", () => {
    it("creates new record when none exists", () => {
      mockGet.mockReturnValue(undefined);
      mockGetGameConfig.mockReturnValue({
        qualificationPercentage: 50,
      });

      creditHistoricalGameAttendance("guild-123", "user-123", "2024-01-10", 60, "mod-1", "Makeup");

      expect(mockRun).toHaveBeenCalled();
    });

    it("updates existing record", () => {
      mockGet.mockReturnValue({
        duration_minutes: 30,
        longest_session_minutes: 30,
        event_start_time: 0,
        event_end_time: 7200000,
      });
      mockGetGameConfig.mockReturnValue({
        qualificationPercentage: 50,
      });

      creditHistoricalGameAttendance("guild-123", "user-123", "2024-01-10", 30, "mod-1", "Makeup");

      expect(mockRun).toHaveBeenCalled();
    });

    it("recalculates qualification with event times", () => {
      mockGet.mockReturnValue({
        duration_minutes: 50,
        longest_session_minutes: 50,
        event_start_time: 0,
        event_end_time: 7200000, // 2 hours
      });
      mockGetGameConfig.mockReturnValue({
        qualificationPercentage: 50,
      });

      creditHistoricalGameAttendance("guild-123", "user-123", "2024-01-10", 10, "mod-1", "Makeup");

      // 60 minutes total, 2 hour event, 50% threshold = 60 min needed = qualified
      expect(mockRun).toHaveBeenCalled();
    });
  });

  describe("bumpGameAttendance", () => {
    it("returns previouslyQualified when user already qualified", () => {
      mockGet.mockReturnValue({ qualified: 1 });

      const result = bumpGameAttendance("guild-123", "user-123", "2024-01-10", "mod-1", "Comp");

      expect(result.created).toBe(false);
      expect(result.previouslyQualified).toBe(true);
    });

    it("creates bump entry when user not qualified", () => {
      mockGet
        .mockReturnValueOnce({ qualified: 0 })
        .mockReturnValueOnce({
          event_start_time: 0,
          event_end_time: 7200000,
        });

      const result = bumpGameAttendance("guild-123", "user-123", "2024-01-10", "mod-1", "Comp");

      expect(result.created).toBe(true);
      expect(result.previouslyQualified).toBe(false);
      expect(mockRun).toHaveBeenCalled();
    });

    it("uses default 60 minutes when no event info", () => {
      mockGet
        .mockReturnValueOnce(undefined) // No existing record
        .mockReturnValueOnce(undefined); // No event info

      bumpGameAttendance("guild-123", "user-123", "2024-01-10", "mod-1");

      // Should still create with default minutes
      expect(mockRun).toHaveBeenCalled();
    });
  });

  describe("getCurrentGameSession", () => {
    it("returns null when no session exists", () => {
      expect(getCurrentGameSession("guild-123", "nonexistent")).toBeNull();
    });

    it("returns session when exists", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startGameEvent(guild, "channel-123", "2024-01-15");
      handleGameVoiceJoin(guild.id, "user-123");

      const session = getCurrentGameSession(guild.id, "user-123");

      expect(session).not.toBeNull();
      expect(session?.currentSessionStart).not.toBeNull();
    });
  });

  describe("getAllGameSessions", () => {
    it("returns empty map when no sessions", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startGameEvent(guild, "channel-123", "2024-01-15");

      const sessions = getAllGameSessions(guild.id);

      expect(sessions.size).toBe(0);
    });

    it("returns all sessions for guild", async () => {
      const guild = createMockGuild({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isVoiceBased: () => true,
            members: new Map(),
          }),
        },
      });
      await startGameEvent(guild, "channel-123", "2024-01-15");
      handleGameVoiceJoin(guild.id, "user-1");
      handleGameVoiceJoin(guild.id, "user-2");

      const sessions = getAllGameSessions(guild.id);

      expect(sessions.size).toBe(2);
      expect(sessions.has("user-1")).toBe(true);
      expect(sessions.has("user-2")).toBe(true);
    });

    it("only returns sessions for specified guild", async () => {
      const guild1 = createMockGuild({ id: "guild-1" });
      const guild2 = createMockGuild({ id: "guild-2" });

      guild1.channels.fetch.mockResolvedValue({
        isVoiceBased: () => true,
        members: new Map(),
      });
      guild2.channels.fetch.mockResolvedValue({
        isVoiceBased: () => true,
        members: new Map(),
      });

      await startGameEvent(guild1, "channel-1", "2024-01-15");
      handleGameVoiceJoin(guild1.id, "user-1");

      const sessions = getAllGameSessions("guild-2");

      expect(sessions.size).toBe(0);
    });
  });

  describe("updateGameTierRole", () => {
    it("returns empty array when panic mode is active", async () => {
      mockIsPanicMode.mockReturnValue(true);
      const guild = createMockGuild();

      const results = await updateGameTierRole(guild, "user-123");

      expect(results).toEqual([]);
    });

    it("returns empty array when no tiers configured", async () => {
      mockGetRoleTiers.mockReturnValue([]);
      mockGet.mockReturnValue({ count: 5 });
      const guild = createMockGuild();

      const results = await updateGameTierRole(guild, "user-123");

      expect(results).toEqual([]);
    });

    it("returns empty when user has not qualified for any tier", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 5, role_id: "role-1" },
      ]);
      mockGet.mockReturnValue({ count: 2 }); // Below threshold
      const guild = createMockGuild();

      const results = await updateGameTierRole(guild, "user-123");

      expect(results).toEqual([]);
    });

    it("assigns correct tier role when qualified", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 3, role_id: "role-tier1" },
        { id: 2, tier_name: "Tier 2", threshold: 10, role_id: "role-tier2" },
      ]);
      mockGet.mockReturnValue({ count: 5 }); // Qualifies for Tier 1
      mockAssignRole.mockResolvedValue({ action: "add", success: true });
      mockRemoveRole.mockResolvedValue({ action: "remove", success: true });

      const guild = createMockGuild();
      const results = await updateGameTierRole(guild, "user-123");

      expect(mockAssignRole).toHaveBeenCalledWith(
        guild,
        "user-123",
        "role-tier1",
        "game_tier_qualified",
        "system"
      );
      expect(results.length).toBeGreaterThan(0);
    });

    it("removes other tier roles when assigning new tier", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 3, role_id: "role-tier1" },
        { id: 2, tier_name: "Tier 2", threshold: 10, role_id: "role-tier2" },
      ]);
      mockGet.mockReturnValue({ count: 15 }); // Qualifies for Tier 2
      mockAssignRole.mockResolvedValue({ action: "add", success: true });
      mockRemoveRole.mockResolvedValue({ action: "remove", success: true });

      const guild = createMockGuild();
      await updateGameTierRole(guild, "user-123");

      // Should remove Tier 1 role
      expect(mockRemoveRole).toHaveBeenCalledWith(
        guild,
        "user-123",
        "role-tier1",
        "game_tier_update",
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

      await updateGameTierRole(guild, "user-123");

      expect(mockSend).toHaveBeenCalled();
    });

    it("logs action to audit channel", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 3, role_id: "role-tier1" },
      ]);
      mockGet.mockReturnValue({ count: 5 });
      mockAssignRole.mockResolvedValue({ action: "add", success: true });

      const guild = createMockGuild();
      await updateGameTierRole(guild, "user-123");

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

      // Should not throw
      await expect(updateGameTierRole(guild, "user-123")).resolves.toBeDefined();
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

      // Should not throw
      await expect(updateGameTierRole(guild, "user-123")).resolves.toBeDefined();
    });

    it("handles audit log failure gracefully", async () => {
      mockGetRoleTiers.mockReturnValue([
        { id: 1, tier_name: "Tier 1", threshold: 3, role_id: "role-tier1" },
      ]);
      mockGet.mockReturnValue({ count: 5 });
      mockAssignRole.mockResolvedValue({ action: "add", success: true });
      mockLogActionPretty.mockRejectedValue(new Error("Audit log failed"));

      const guild = createMockGuild();

      // Should not throw
      await expect(updateGameTierRole(guild, "user-123")).resolves.toBeDefined();
    });
  });
});
