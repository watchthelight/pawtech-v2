// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/features/movieNight.ts
 * WHAT: Movie night attendance tracking and tier role assignment
 * WHY: Automates tracking VC participation and assigning tier roles
 * FLOWS:
 *  - /movie start → track VC join/leave → /movie end → assign tier roles
 * DOCS:
 *  - Discord.js VoiceState: https://discord.js.org/#/docs/discord.js/main/class/VoiceState
 */

import type { Guild, VoiceState } from "discord.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { assignRole, getRoleTiers, removeRole, type RoleAssignmentResult } from "./roleAutomation.js";

// ============================================================================
// Types
// ============================================================================

interface MovieSession {
  currentSessionStart: number | null; // Unix timestamp in ms
  longestSessionMinutes: number;
  totalMinutes: number;
}

interface ActiveMovieEvent {
  guildId: string;
  channelId: string;
  eventDate: string; // YYYY-MM-DD
  startedAt: number; // Unix timestamp
}

// ============================================================================
// State Management
// ============================================================================

// In-memory session tracking (cleared when event ends)
const movieSessions = new Map<string, MovieSession>();

// Active movie events
const activeEvents = new Map<string, ActiveMovieEvent>();

/**
 * Get the key for a session (guild:user)
 */
function getSessionKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

/**
 * Get or create a session for a user
 */
function getOrCreateSession(guildId: string, userId: string): MovieSession {
  const key = getSessionKey(guildId, userId);
  let session = movieSessions.get(key);
  if (!session) {
    session = {
      currentSessionStart: null,
      longestSessionMinutes: 0,
      totalMinutes: 0,
    };
    movieSessions.set(key, session);
  }
  return session;
}

// ============================================================================
// Movie Event Management
// ============================================================================

/**
 * Start tracking a movie night event
 */
export function startMovieEvent(guildId: string, channelId: string, eventDate: string): void {
  const event: ActiveMovieEvent = {
    guildId,
    channelId,
    eventDate,
    startedAt: Date.now(),
  };
  activeEvents.set(guildId, event);

  logger.info({
    evt: "movie_event_started",
    guildId,
    channelId,
    eventDate,
  }, "Movie night event started");
}

/**
 * Get active movie event for a guild
 */
export function getActiveMovieEvent(guildId: string): ActiveMovieEvent | null {
  return activeEvents.get(guildId) || null;
}

/**
 * Check if a movie event is active for a guild
 */
export function isMovieEventActive(guildId: string): boolean {
  return activeEvents.has(guildId);
}

// ============================================================================
// Voice State Tracking
// ============================================================================

/**
 * Handle user joining movie night VC
 */
export function handleMovieVoiceJoin(guildId: string, userId: string): void {
  const session = getOrCreateSession(guildId, userId);
  session.currentSessionStart = Date.now();

  logger.debug({
    evt: "movie_voice_join",
    guildId,
    userId,
  }, "User joined movie night VC");
}

/**
 * Handle user leaving movie night VC
 */
export function handleMovieVoiceLeave(guildId: string, userId: string): void {
  const session = getOrCreateSession(guildId, userId);

  if (session.currentSessionStart) {
    const sessionDurationMs = Date.now() - session.currentSessionStart;
    const sessionMinutes = Math.floor(sessionDurationMs / 60000);

    session.totalMinutes += sessionMinutes;
    session.longestSessionMinutes = Math.max(session.longestSessionMinutes, sessionMinutes);
    session.currentSessionStart = null;

    logger.debug({
      evt: "movie_voice_leave",
      guildId,
      userId,
      sessionMinutes,
      totalMinutes: session.totalMinutes,
      longestSession: session.longestSessionMinutes,
    }, "User left movie night VC");
  }
}

// ============================================================================
// Attendance Finalization
// ============================================================================

/**
 * Get guild's movie attendance mode
 */
function getMovieAttendanceMode(guildId: string): "cumulative" | "continuous" {
  const stmt = db.prepare(`
    SELECT attendance_mode FROM guild_movie_config
    WHERE guild_id = ?
  `);
  const result = stmt.get(guildId) as { attendance_mode: string } | undefined;
  return (result?.attendance_mode as "cumulative" | "continuous") || "cumulative";
}

/**
 * Finalize attendance and save to database
 */
export async function finalizeMovieAttendance(guild: Guild): Promise<void> {
  const event = activeEvents.get(guild.id);
  if (!event) {
    logger.warn({ evt: "finalize_no_event", guildId: guild.id }, "No active movie event to finalize");
    return;
  }

  const mode = getMovieAttendanceMode(guild.id);
  logger.info({
    evt: "finalizing_movie_attendance",
    guildId: guild.id,
    eventDate: event.eventDate,
    mode,
    participantCount: movieSessions.size,
  }, "Finalizing movie night attendance");

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO movie_attendance (
      guild_id, user_id, event_date, voice_channel_id,
      duration_minutes, longest_session_minutes, qualified
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Process each session
  for (const [key, session] of movieSessions) {
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

    // Determine if qualified based on mode
    const qualified =
      mode === "continuous"
        ? session.longestSessionMinutes >= 30
        : session.totalMinutes >= 30;

    stmt.run(
      guildId,
      userId,
      event.eventDate,
      event.channelId,
      session.totalMinutes,
      session.longestSessionMinutes,
      qualified ? 1 : 0
    );

    logger.info({
      evt: "attendance_recorded",
      guildId,
      userId,
      eventDate: event.eventDate,
      totalMinutes: session.totalMinutes,
      longestSession: session.longestSessionMinutes,
      qualified,
      mode,
    }, `Attendance recorded: ${qualified ? "✅ Qualified" : "❌ Not qualified"}`);
  }

  // Clear session data
  movieSessions.clear();
  activeEvents.delete(guild.id);

  logger.info({
    evt: "movie_event_finalized",
    guildId: guild.id,
    eventDate: event.eventDate,
  }, "Movie night event finalized");
}

// ============================================================================
// Tier Role Assignment
// ============================================================================

/**
 * Get user's total qualified movie count
 */
export function getUserQualifiedMovieCount(guildId: string, userId: string): number {
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM movie_attendance
    WHERE guild_id = ? AND user_id = ? AND qualified = 1
  `);
  const result = stmt.get(guildId, userId) as { count: number };
  return result.count;
}

/**
 * Update user's movie tier role based on attendance count
 */
export async function updateMovieTierRole(guild: Guild, userId: string): Promise<RoleAssignmentResult[]> {
  const results: RoleAssignmentResult[] = [];
  const qualifiedCount = getUserQualifiedMovieCount(guild.id, userId);

  logger.info({
    evt: "updating_movie_tier",
    guildId: guild.id,
    userId,
    qualifiedCount,
  }, `Updating movie tier for user with ${qualifiedCount} qualified movies`);

  // Get all movie tier roles
  const tiers = getRoleTiers(guild.id, "movie_night");
  if (tiers.length === 0) {
    logger.warn({ evt: "no_movie_tiers", guildId: guild.id }, "No movie tier roles configured");
    return results;
  }

  // Sort by threshold descending to find highest qualifying tier
  const sortedTiers = [...tiers].sort((a, b) => b.threshold - a.threshold);

  // Find the tier user should have
  const targetTier = sortedTiers.find(t => qualifiedCount >= t.threshold);

  if (!targetTier) {
    logger.debug({
      evt: "no_qualifying_tier",
      guildId: guild.id,
      userId,
      qualifiedCount,
    }, "User hasn't qualified for any tier yet");
    return results;
  }

  // Remove all lower tier roles
  for (const tier of tiers) {
    if (tier.id === targetTier.id) continue; // Skip the target tier

    const removeResult = await removeRole(
      guild,
      userId,
      tier.role_id,
      "movie_tier_update",
      "system"
    );
    results.push(removeResult);
  }

  // Add the target tier role
  const addResult = await assignRole(
    guild,
    userId,
    targetTier.role_id,
    "movie_tier_qualified",
    "system"
  );
  results.push(addResult);

  logger.info({
    evt: "movie_tier_updated",
    guildId: guild.id,
    userId,
    qualifiedCount,
    tierName: targetTier.tier_name,
    tierThreshold: targetTier.threshold,
  }, `Movie tier updated: ${targetTier.tier_name}`);

  return results;
}
