/**
 * Pawtropolis Tech — src/features/events/gameNight.ts
 * WHAT: Game night attendance tracking with percentage-based qualification
 * WHY: Track VC participation for game nights with dynamic qualification thresholds
 * FLOWS:
 *  - /event game start → track VC join/leave → /event game end → calculate % → qualify
 *  - Session persistence: in-memory state is periodically persisted to DB
 *  - Crash recovery: sessions are restored from DB on startup
 *  - Manual adjustments: /event game add, credit, bump
 * DOCS:
 *  - Discord.js VoiceState: https://discord.js.org/#/docs/discord.js/main/class/VoiceState
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Guild, VoiceBasedChannel } from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { getGameConfig } from "../../store/gameConfigStore.js";
import { calculateGameSessionQualification, type GameQualificationResult } from "./gameQualification.js";
import type { ActiveEvent, EventSession, EventType } from "./types.js";
import { assignRole, getRoleTiers, removeRole, type RoleAssignmentResult } from "../roleAutomation.js";
import { isPanicMode } from "../panicStore.js";
import { logActionPretty } from "../../logging/pretty.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, 4th, etc.)
 */
function getOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ============================================================================
// State Management
// ============================================================================

/** Persistence interval in milliseconds (5 minutes) */
const PERSISTENCE_INTERVAL_MS = 5 * 60 * 1000;

/** In-memory session tracking. Key: "guildId:userId" */
const gameSessions = new Map<string, EventSession>();

/** One active event per guild at a time */
const activeGameEvents = new Map<string, ActiveEvent>();

/** Persistence interval handle */
let persistenceInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Get the key for a session (guild:user)
 */
function getSessionKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

/**
 * Get or create a session for a user
 */
function getOrCreateSession(guildId: string, userId: string): EventSession {
  const key = getSessionKey(guildId, userId);
  let session = gameSessions.get(key);
  if (!session) {
    session = {
      currentSessionStart: null,
      longestSessionMinutes: 0,
      totalMinutes: 0,
    };
    gameSessions.set(key, session);
  }
  return session;
}

// ============================================================================
// Game Event Management
// ============================================================================

/**
 * Start tracking a game night event.
 * @returns Number of users already in the VC who were credited
 */
export async function startGameEvent(
  guild: Guild,
  channelId: string,
  eventDate: string
): Promise<{ retroactiveCount: number }> {
  const event: ActiveEvent = {
    guildId: guild.id,
    channelId,
    eventDate,
    startedAt: Date.now(),
    eventType: "game",
  };
  activeGameEvents.set(guild.id, event);

  // Credit users already in the voice channel
  const retroactiveCount = await initializeExistingVoiceMembers(guild, channelId);

  // Persist immediately after start
  persistAllGameSessions();

  logger.info({
    evt: "game_event_started",
    guildId: guild.id,
    channelId,
    eventDate,
    retroactiveCount,
  }, "Game night event started");

  return { retroactiveCount };
}

/**
 * Initialize sessions for users already in the voice channel when tracking starts.
 */
async function initializeExistingVoiceMembers(
  guild: Guild,
  channelId: string
): Promise<number> {
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isVoiceBased()) return 0;

    const voiceChannel = channel as VoiceBasedChannel;
    let count = 0;

    for (const [memberId, member] of voiceChannel.members) {
      if (member.user.bot) continue;
      handleGameVoiceJoin(guild.id, memberId);
      count++;
    }

    logger.info({
      evt: "game_retroactive_credit",
      guildId: guild.id,
      channelId,
      userCount: count,
    }, `Credited ${count} users already in VC`);

    return count;
  } catch (err) {
    logger.error({ err, guildId: guild.id, channelId },
      "Failed to initialize existing voice members for game night");
    return 0;
  }
}

/**
 * Get active game event for a guild
 */
export function getActiveGameEvent(guildId: string): ActiveEvent | null {
  return activeGameEvents.get(guildId) || null;
}

/**
 * Check if a game event is active for a guild
 */
export function isGameEventActive(guildId: string): boolean {
  return activeGameEvents.has(guildId);
}

// ============================================================================
// Voice State Tracking
// ============================================================================

/**
 * Handle user joining game night VC
 */
export function handleGameVoiceJoin(guildId: string, userId: string): void {
  const session = getOrCreateSession(guildId, userId);
  session.currentSessionStart = Date.now();

  logger.debug({
    evt: "game_voice_join",
    guildId,
    userId,
  }, "User joined game night VC");
}

/**
 * Handle user leaving game night VC
 */
export function handleGameVoiceLeave(guildId: string, userId: string): void {
  const session = getOrCreateSession(guildId, userId);

  if (session.currentSessionStart) {
    const sessionDurationMs = Date.now() - session.currentSessionStart;
    const sessionMinutes = Math.floor(sessionDurationMs / 60000);

    session.totalMinutes += sessionMinutes;
    session.longestSessionMinutes = Math.max(session.longestSessionMinutes, sessionMinutes);
    session.currentSessionStart = null;

    logger.debug({
      evt: "game_voice_leave",
      guildId,
      userId,
      sessionMinutes,
      totalMinutes: session.totalMinutes,
      longestSession: session.longestSessionMinutes,
    }, "User left game night VC");
  }
}

// ============================================================================
// Attendance Finalization
// ============================================================================

export interface GameAttendanceResult {
  userId: string;
  session: EventSession;
  qualification: GameQualificationResult;
}

/**
 * Finalize attendance and save to database.
 * Returns results for all participants.
 */
export async function finalizeGameAttendance(guild: Guild): Promise<GameAttendanceResult[]> {
  const event = activeGameEvents.get(guild.id);
  if (!event) {
    logger.warn({ evt: "finalize_no_game_event", guildId: guild.id },
      "No active game event to finalize");
    return [];
  }

  const eventEndTime = Date.now();
  const config = getGameConfig(guild.id);
  const results: GameAttendanceResult[] = [];

  logger.info({
    evt: "finalizing_game_attendance",
    guildId: guild.id,
    eventDate: event.eventDate,
    eventDurationMs: eventEndTime - event.startedAt,
    thresholdPercent: config.qualificationPercentage,
    participantCount: gameSessions.size,
  }, "Finalizing game night attendance");

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO movie_attendance (
      guild_id, user_id, event_date, voice_channel_id,
      duration_minutes, longest_session_minutes, qualified,
      event_type, event_start_time, event_end_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'game', ?, ?)
  `);

  // Process each session
  for (const [key, session] of gameSessions) {
    const [guildId, userId] = key.split(":");
    if (guildId !== guild.id) continue;

    // Close any open session
    if (session.currentSessionStart) {
      const sessionDurationMs = Date.now() - session.currentSessionStart;
      const sessionMinutes = Math.floor(sessionDurationMs / 60000);
      session.totalMinutes += sessionMinutes;
      session.longestSessionMinutes = Math.max(session.longestSessionMinutes, sessionMinutes);
      session.currentSessionStart = null;
    }

    // Calculate percentage-based qualification
    const qualification = calculateGameSessionQualification(
      session,
      event.startedAt,
      eventEndTime,
      config
    );

    stmt.run(
      guildId,
      userId,
      event.eventDate,
      event.channelId,
      session.totalMinutes,
      session.longestSessionMinutes,
      qualification.qualified ? 1 : 0,
      event.startedAt,
      eventEndTime
    );

    results.push({ userId, session, qualification });

    logger.info({
      evt: "game_attendance_recorded",
      guildId,
      userId,
      eventDate: event.eventDate,
      totalMinutes: session.totalMinutes,
      eventDuration: qualification.eventDurationMinutes,
      attendancePercent: qualification.attendancePercentage,
      requiredPercent: config.qualificationPercentage,
      qualified: qualification.qualified,
    }, `Game attendance: ${qualification.qualified ? "Qualified" : "Not qualified"}`);
  }

  // Clear state
  for (const key of gameSessions.keys()) {
    if (key.startsWith(guild.id + ":")) {
      gameSessions.delete(key);
    }
  }
  activeGameEvents.delete(guild.id);
  clearPersistedGameSessions(guild.id);

  logger.info({
    evt: "game_event_finalized",
    guildId: guild.id,
    eventDate: event.eventDate,
    qualifiedCount: results.filter(r => r.qualification.qualified).length,
    totalCount: results.length,
  }, "Game night event finalized");

  return results;
}

// ============================================================================
// Stats Queries
// ============================================================================

/**
 * Get user's total qualified game count
 */
export function getUserQualifiedGameCount(guildId: string, userId: string): number {
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM movie_attendance
    WHERE guild_id = ? AND user_id = ? AND event_type = 'game' AND qualified = 1
  `);
  const result = stmt.get(guildId, userId) as { count: number };
  return result.count;
}

/**
 * Get user's total event count (both movie and game)
 */
export function getUserTotalEventCount(guildId: string, userId: string): number {
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM movie_attendance
    WHERE guild_id = ? AND user_id = ? AND qualified = 1
  `);
  const result = stmt.get(guildId, userId) as { count: number };
  return result.count;
}

/**
 * Get attendance stats for a specific event date
 */
export function getGameEventStats(guildId: string, eventDate: string): {
  totalParticipants: number;
  qualifiedCount: number;
  avgAttendanceMinutes: number;
  eventDurationMinutes: number | null;
} {
  const stmt = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN qualified = 1 THEN 1 ELSE 0 END) as qualified,
      AVG(duration_minutes) as avg_minutes,
      MAX(event_end_time) - MIN(event_start_time) as duration_ms
    FROM movie_attendance
    WHERE guild_id = ? AND event_date = ? AND event_type = 'game'
  `);
  const result = stmt.get(guildId, eventDate) as {
    total: number;
    qualified: number;
    avg_minutes: number | null;
    duration_ms: number | null;
  };

  return {
    totalParticipants: result.total,
    qualifiedCount: result.qualified,
    avgAttendanceMinutes: Math.round(result.avg_minutes ?? 0),
    eventDurationMinutes: result.duration_ms ? Math.floor(result.duration_ms / 60000) : null,
  };
}

// ============================================================================
// Session Persistence (Crash Recovery)
// ============================================================================

/**
 * Persist all active sessions to database for crash recovery.
 */
export function persistAllGameSessions(): void {
  const now = Date.now();

  // Persist active events
  const eventStmt = db.prepare(`
    INSERT OR REPLACE INTO active_movie_events
    (guild_id, channel_id, event_date, started_at, event_type)
    VALUES (?, ?, ?, ?, 'game')
  `);

  for (const [guildId, event] of activeGameEvents) {
    eventStmt.run(guildId, event.channelId, event.eventDate, event.startedAt);
  }

  // Persist sessions
  const sessionStmt = db.prepare(`
    INSERT OR REPLACE INTO active_movie_sessions
    (guild_id, user_id, event_date, current_session_start,
     accumulated_minutes, longest_session_minutes, last_persisted_at, event_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'game')
  `);

  for (const [key, session] of gameSessions) {
    const [guildId, userId] = key.split(":");
    const event = activeGameEvents.get(guildId);
    if (!event) continue;

    sessionStmt.run(
      guildId,
      userId,
      event.eventDate,
      session.currentSessionStart,
      session.totalMinutes,
      session.longestSessionMinutes,
      now
    );
  }

  logger.debug({
    evt: "game_sessions_persisted",
    eventCount: activeGameEvents.size,
    sessionCount: gameSessions.size,
  }, "Game sessions persisted to database");
}

/**
 * Recover persisted game sessions from database after restart.
 */
export function recoverPersistedGameSessions(): { events: number; sessions: number } {
  // Recover active events
  const eventRows = db.prepare(`
    SELECT guild_id, channel_id, event_date, started_at
    FROM active_movie_events
    WHERE event_type = 'game'
  `).all() as Array<{
    guild_id: string;
    channel_id: string;
    event_date: string;
    started_at: number;
  }>;

  for (const row of eventRows) {
    activeGameEvents.set(row.guild_id, {
      guildId: row.guild_id,
      channelId: row.channel_id,
      eventDate: row.event_date,
      startedAt: row.started_at,
      eventType: "game",
    });
  }

  // Recover sessions
  const now = Date.now();
  const sessionRows = db.prepare(`
    SELECT guild_id, user_id, event_date, current_session_start,
           accumulated_minutes, longest_session_minutes, last_persisted_at
    FROM active_movie_sessions
    WHERE event_type = 'game'
  `).all() as Array<{
    guild_id: string;
    user_id: string;
    event_date: string;
    current_session_start: number | null;
    accumulated_minutes: number;
    longest_session_minutes: number;
    last_persisted_at: number;
  }>;

  for (const row of sessionRows) {
    const key = getSessionKey(row.guild_id, row.user_id);

    let totalMinutes = row.accumulated_minutes;
    let longestSession = row.longest_session_minutes;

    if (row.current_session_start) {
      const lostSessionMs = now - row.last_persisted_at;
      const lostMinutes = Math.floor(lostSessionMs / 60000);
      totalMinutes += lostMinutes;
      longestSession = Math.max(longestSession, lostMinutes);

      logger.info({
        evt: "game_session_recovered",
        guildId: row.guild_id,
        userId: row.user_id,
        lostMinutes,
        totalMinutes,
      }, `Recovered ${lostMinutes} lost minutes for user`);
    }

    gameSessions.set(key, {
      currentSessionStart: row.current_session_start ? now : null,
      totalMinutes,
      longestSessionMinutes: longestSession,
    });
  }

  logger.info({
    evt: "game_sessions_recovered",
    eventCount: eventRows.length,
    sessionCount: sessionRows.length,
  }, "Game sessions recovered from database");

  return { events: eventRows.length, sessions: sessionRows.length };
}

/**
 * Clear persisted session data for a guild.
 */
export function clearPersistedGameSessions(guildId: string): void {
  db.prepare(`DELETE FROM active_movie_events WHERE guild_id = ? AND event_type = 'game'`).run(guildId);
  db.prepare(`DELETE FROM active_movie_sessions WHERE guild_id = ? AND event_type = 'game'`).run(guildId);

  logger.debug({
    evt: "game_persisted_sessions_cleared",
    guildId,
  }, "Persisted game sessions cleared");
}

/**
 * Start the periodic persistence interval.
 */
export function startGameSessionPersistence(): void {
  if (persistenceInterval) {
    logger.warn({ evt: "game_persistence_already_running" },
      "Game session persistence already running");
    return;
  }

  persistenceInterval = setInterval(() => {
    if (activeGameEvents.size > 0) {
      persistAllGameSessions();
    }
  }, PERSISTENCE_INTERVAL_MS);

  persistenceInterval.unref();

  logger.info({
    evt: "game_persistence_started",
    intervalMs: PERSISTENCE_INTERVAL_MS,
  }, "Game session persistence started");
}

/**
 * Stop the periodic persistence interval.
 */
export function stopGameSessionPersistence(): void {
  if (persistenceInterval) {
    clearInterval(persistenceInterval);
    persistenceInterval = null;
    logger.info({ evt: "game_persistence_stopped" },
      "Game session persistence stopped");
  }
}

/**
 * Get recovery status for the /event game resume command.
 */
export function getGameRecoveryStatus(): {
  hasActiveEvent: boolean;
  guildId: string | null;
  channelId: string | null;
  eventDate: string | null;
  sessionCount: number;
  totalRecoveredMinutes: number;
} {
  if (activeGameEvents.size === 0) {
    return {
      hasActiveEvent: false,
      guildId: null,
      channelId: null,
      eventDate: null,
      sessionCount: 0,
      totalRecoveredMinutes: 0,
    };
  }

  const [guildId, event] = [...activeGameEvents.entries()][0];

  let sessionCount = 0;
  let totalRecoveredMinutes = 0;

  for (const [key, session] of gameSessions) {
    if (key.startsWith(guildId + ":")) {
      sessionCount++;
      totalRecoveredMinutes += session.totalMinutes;
    }
  }

  return {
    hasActiveEvent: true,
    guildId,
    channelId: event.channelId,
    eventDate: event.eventDate,
    sessionCount,
    totalRecoveredMinutes,
  };
}

// ============================================================================
// Manual Attendance Adjustments
// ============================================================================

/**
 * Add minutes to a user's current active session.
 */
export function addManualGameAttendance(
  guildId: string,
  userId: string,
  minutes: number,
  adjustedBy: string,
  reason?: string
): boolean {
  const event = activeGameEvents.get(guildId);
  if (!event) {
    return false;
  }

  const session = getOrCreateSession(guildId, userId);
  session.totalMinutes += minutes;
  session.longestSessionMinutes = Math.max(session.longestSessionMinutes, minutes);

  logger.info({
    evt: "game_manual_add",
    guildId,
    userId,
    minutes,
    adjustedBy,
    reason,
    newTotal: session.totalMinutes,
  }, `Manually added ${minutes} minutes to user's game attendance`);

  return true;
}

/**
 * Credit attendance to a historical game event.
 */
export function creditHistoricalGameAttendance(
  guildId: string,
  userId: string,
  eventDate: string,
  minutes: number,
  adjustedBy: string,
  reason?: string
): void {
  // Check if record exists
  const existing = db.prepare(`
    SELECT duration_minutes, longest_session_minutes, event_start_time, event_end_time
    FROM movie_attendance
    WHERE guild_id = ? AND user_id = ? AND event_date = ? AND event_type = 'game'
  `).get(guildId, userId, eventDate) as {
    duration_minutes: number;
    longest_session_minutes: number;
    event_start_time: number | null;
    event_end_time: number | null;
  } | undefined;

  const totalMinutes = (existing?.duration_minutes ?? 0) + minutes;
  const longestSession = Math.max(existing?.longest_session_minutes ?? 0, minutes);

  // If we have event times, recalculate qualification
  let qualified = false;
  if (existing?.event_start_time && existing?.event_end_time) {
    const config = getGameConfig(guildId);
    const eventDuration = Math.floor((existing.event_end_time - existing.event_start_time) / 60000);
    const requiredMinutes = Math.ceil(eventDuration * (config.qualificationPercentage / 100));
    qualified = totalMinutes >= requiredMinutes;
  }

  db.prepare(`
    INSERT INTO movie_attendance (
      guild_id, user_id, event_date, voice_channel_id,
      duration_minutes, longest_session_minutes, qualified,
      event_type, adjustment_type, adjusted_by, adjustment_reason
    ) VALUES (?, ?, ?, 'manual', ?, ?, ?, 'game', 'manual_add', ?, ?)
    ON CONFLICT(guild_id, user_id, event_date) DO UPDATE SET
      duration_minutes = excluded.duration_minutes,
      longest_session_minutes = excluded.longest_session_minutes,
      qualified = excluded.qualified,
      adjustment_type = excluded.adjustment_type,
      adjusted_by = excluded.adjusted_by,
      adjustment_reason = excluded.adjustment_reason
  `).run(
    guildId,
    userId,
    eventDate,
    totalMinutes,
    longestSession,
    qualified ? 1 : 0,
    adjustedBy,
    reason ?? null
  );

  logger.info({
    evt: "game_credit_historical",
    guildId,
    userId,
    eventDate,
    minutes,
    totalMinutes,
    qualified,
    adjustedBy,
    reason,
  }, `Credited ${minutes} minutes to historical game attendance`);
}

/**
 * Create a qualified "bump" entry for a user.
 */
export function bumpGameAttendance(
  guildId: string,
  userId: string,
  eventDate: string,
  adjustedBy: string,
  reason?: string
): { created: boolean; previouslyQualified: boolean } {
  // Check if already qualified for this date
  const existing = db.prepare(`
    SELECT qualified FROM movie_attendance
    WHERE guild_id = ? AND user_id = ? AND event_date = ? AND event_type = 'game'
  `).get(guildId, userId, eventDate) as { qualified: number } | undefined;

  if (existing?.qualified) {
    return { created: false, previouslyQualified: true };
  }

  // For a bump, we mark as qualified. Get event duration if available to set realistic minutes.
  const eventInfo = db.prepare(`
    SELECT event_start_time, event_end_time
    FROM movie_attendance
    WHERE guild_id = ? AND event_date = ? AND event_type = 'game'
    LIMIT 1
  `).get(guildId, eventDate) as { event_start_time: number | null; event_end_time: number | null } | undefined;

  // Default to 60 minutes if we don't have event info
  let bumpMinutes = 60;
  if (eventInfo?.event_start_time && eventInfo?.event_end_time) {
    const eventDuration = Math.floor((eventInfo.event_end_time - eventInfo.event_start_time) / 60000);
    bumpMinutes = eventDuration; // Give them full event credit
  }

  db.prepare(`
    INSERT INTO movie_attendance (
      guild_id, user_id, event_date, voice_channel_id,
      duration_minutes, longest_session_minutes, qualified,
      event_type, adjustment_type, adjusted_by, adjustment_reason
    ) VALUES (?, ?, ?, 'bump', ?, ?, 1, 'game', 'bump', ?, ?)
    ON CONFLICT(guild_id, user_id, event_date) DO UPDATE SET
      duration_minutes = excluded.duration_minutes,
      longest_session_minutes = excluded.longest_session_minutes,
      qualified = 1,
      adjustment_type = 'bump',
      adjusted_by = excluded.adjusted_by,
      adjustment_reason = excluded.adjustment_reason
  `).run(
    guildId,
    userId,
    eventDate,
    bumpMinutes,
    bumpMinutes,
    adjustedBy,
    reason ?? "Manual bump compensation"
  );

  logger.info({
    evt: "game_bump",
    guildId,
    userId,
    eventDate,
    bumpMinutes,
    adjustedBy,
    reason,
  }, `Created bump game attendance entry for user`);

  return { created: true, previouslyQualified: false };
}

/**
 * Get current session data for a user (for /event game attendance)
 */
export function getCurrentGameSession(guildId: string, userId: string): EventSession | null {
  const key = getSessionKey(guildId, userId);
  return gameSessions.get(key) ?? null;
}

/**
 * Get all current sessions for a guild (for /event game attendance all)
 */
export function getAllGameSessions(guildId: string): Map<string, EventSession> {
  const result = new Map<string, EventSession>();
  for (const [key, session] of gameSessions) {
    if (key.startsWith(guildId + ":")) {
      const userId = key.split(":")[1];
      result.set(userId, session);
    }
  }
  return result;
}

// ============================================================================
// Tier Role Assignment
// ============================================================================

/**
 * Update user's game tier role based on attendance count
 */
export async function updateGameTierRole(guild: Guild, userId: string): Promise<RoleAssignmentResult[]> {
  const results: RoleAssignmentResult[] = [];

  // Panic mode check - halt all automated role changes
  if (isPanicMode(guild.id)) {
    logger.warn({
      evt: "game_tier_blocked_panic",
      guildId: guild.id,
      userId,
    }, "Game tier update blocked - panic mode active");
    return results;
  }

  const qualifiedCount = getUserQualifiedGameCount(guild.id, userId);

  logger.info({
    evt: "updating_game_tier",
    guildId: guild.id,
    userId,
    qualifiedCount,
  }, `Updating game tier for user with ${qualifiedCount} qualified games`);

  // Get game night tiers from config
  const tiers = getRoleTiers(guild.id, "game_night");
  if (tiers.length === 0) {
    logger.debug({ evt: "no_game_tiers", guildId: guild.id }, "No game tier roles configured");
    return results;
  }

  // Sort descending to find highest qualifying tier
  const sortedTiers = [...tiers].sort((a, b) => b.threshold - a.threshold);

  // Find the tier user should have
  const targetTier = sortedTiers.find(t => qualifiedCount >= t.threshold);

  if (!targetTier) {
    logger.debug({
      evt: "no_qualifying_game_tier",
      guildId: guild.id,
      userId,
      qualifiedCount,
    }, "User hasn't qualified for any game tier yet");
    return results;
  }

  // Remove ALL other tier roles before adding the new one
  for (const tier of tiers) {
    if (tier.id === targetTier.id) continue;

    const removeResult = await removeRole(
      guild,
      userId,
      tier.role_id,
      "game_tier_update",
      "system"
    );
    results.push(removeResult);
  }

  // Add the target tier role
  const addResult = await assignRole(
    guild,
    userId,
    targetTier.role_id,
    "game_tier_qualified",
    "system"
  );
  results.push(addResult);

  logger.info({
    evt: "game_tier_updated",
    guildId: guild.id,
    userId,
    qualifiedCount,
    tierName: targetTier.tier_name,
    tierThreshold: targetTier.threshold,
  }, `Game tier updated: ${targetTier.tier_name}`);

  // DM the user about their game progress
  let dmStatus = "⏭️ No DM";
  let dmMessage = "";
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      // Find the next tier they're working towards
      const nextTier = sortedTiers
        .filter(t => t.threshold > qualifiedCount)
        .sort((a, b) => a.threshold - b.threshold)[0];

      dmMessage = `Thanks for joining us at the game night! This is your **${getOrdinal(qualifiedCount)}** game night`;

      if (addResult.action === "add") {
        // They just earned a new tier role
        const roleName = guild.roles.cache.get(targetTier.role_id)?.name ?? targetTier.tier_name;
        dmMessage += `, so you got the **${roleName}** role! 🎮`;
      } else if (nextTier) {
        // Show progress to next tier
        const needed = nextTier.threshold - qualifiedCount;
        const nextRoleName = guild.roles.cache.get(nextTier.role_id)?.name ?? nextTier.tier_name;
        dmMessage += `, you need **${needed}** more game night${needed > 1 ? "s" : ""} to get **${nextRoleName}**!`;
      } else {
        // They have the highest tier already
        dmMessage += `! You've reached the highest game tier! 🏆`;
      }

      dmStatus = "✅ DM Sent";
      await member.send({ content: dmMessage }).catch((err) => {
        dmStatus = "❌ DM Failed (closed)";
        logger.debug({ err, guildId: guild.id, userId },
          "[gameNight] Could not DM user about game progress");
      });
    }
  } catch (err) {
    dmStatus = "❌ DM Failed (error)";
    logger.debug({ err, guildId: guild.id, userId },
      "[gameNight] Error sending game progress DM");
  }

  // Log to audit channel
  const botId = guild.client.user?.id ?? "system";
  await logActionPretty(guild, {
    actorId: botId,
    subjectId: userId,
    action: addResult.action === "add" ? "game_tier_granted" : "game_tier_progress",
    reason: addResult.action === "add"
      ? `Earned ${targetTier.tier_name} (${qualifiedCount} game nights)`
      : `Progress update (${qualifiedCount} game nights)`,
    meta: {
      qualifiedGames: qualifiedCount,
      currentTier: targetTier.tier_name,
      tierRole: `<@&${targetTier.role_id}>`,
      roleAction: addResult.action === "add" ? "✅ Role Granted" : "⏭️ Already Has Role",
      dmStatus,
    },
  }).catch((err) => {
    logger.warn({ err, guildId: guild.id, userId },
      "[gameNight] Failed to log action - audit trail incomplete");
  });

  return results;
}

// Testing helpers - only use in tests to reset module state between test cases
export const _testing = {
  clearAllState(): void {
    gameSessions.clear();
    activeGameEvents.clear();
    stopGameSessionPersistence();
  },
  getActiveEventsCount(): number {
    return activeGameEvents.size;
  },
  getSessionsCount(): number {
    return gameSessions.size;
  },
};
