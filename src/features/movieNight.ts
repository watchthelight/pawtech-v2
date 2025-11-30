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
import { isPanicMode } from "./panicStore.js";
import { logActionPretty } from "../logging/pretty.js";

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

// In-memory session tracking. Intentionally NOT persisted to DB because:
// 1. Sessions are ephemeral (only matter during active event)
// 2. High-frequency updates (voice join/leave) would hammer the DB
// 3. If bot crashes mid-movie, attendance is lost - acceptable tradeoff
const movieSessions = new Map<string, MovieSession>();

// One active event per guild at a time. Enforced by overwriting on startMovieEvent.
const activeEvents = new Map<string, ActiveMovieEvent>();

/**
 * Get the key for a session (guild:user)
 */
function getSessionKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

/**
 * Get or create a session for a user. Creates with zero values if new.
 * Note: this is a hot path (called on every voice state change), keep it fast.
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
 * Start tracking a movie night event. If one is already active, it gets
 * overwritten - this is intentional to allow "restarts" without explicit end.
 * Callers should check isMovieEventActive() first if they want to warn.
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
 * Handle user leaving movie night VC. Calculates session duration and updates
 * totals. Note: we floor to minutes, so leaving after 59 seconds = 0 minutes.
 * This is intentional to prevent gaming via rapid join/leave.
 */
export function handleMovieVoiceLeave(guildId: string, userId: string): void {
  const session = getOrCreateSession(guildId, userId);

  if (session.currentSessionStart) {
    const sessionDurationMs = Date.now() - session.currentSessionStart;
    // Floor division intentionally discards partial minutes
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
 * Get guild's movie attendance mode. Two modes exist:
 * - "cumulative": total time across all joins/leaves must hit threshold
 * - "continuous": longest single session must hit threshold (stricter)
 * Default is cumulative because it's more forgiving for bathroom breaks.
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
 * Get guild's movie night qualification threshold in minutes.
 * Defaults to 30 minutes if not configured.
 */
function getMovieQualificationThreshold(guildId: string): number {
  const stmt = db.prepare(`
    SELECT qualification_threshold_minutes FROM guild_movie_config
    WHERE guild_id = ?
  `);
  const result = stmt.get(guildId) as { qualification_threshold_minutes: number } | undefined;
  return result?.qualification_threshold_minutes ?? 30;
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
  const threshold = getMovieQualificationThreshold(guild.id);

  logger.info({
    evt: "finalizing_movie_attendance",
    guildId: guild.id,
    eventDate: event.eventDate,
    mode,
    threshold,
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

    // Qualification based on configured threshold (default 30 minutes)
    const qualified =
      mode === "continuous"
        ? session.longestSessionMinutes >= threshold
        : session.totalMinutes >= threshold;

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
      threshold,
    }, `Attendance recorded: ${qualified ? "Qualified" : "Not qualified"}`);
  }

  // Clear ALL sessions, not just this guild's. This is a simplification since
  // we typically only have one guild active. If multi-guild support is needed,
  // iterate and delete only matching guild keys.
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

  // Panic mode check - halt all automated role changes
  // This is the emergency brake for role automation
  if (isPanicMode(guild.id)) {
    logger.warn({
      evt: "movie_tier_blocked_panic",
      guildId: guild.id,
      userId,
    }, "Movie tier update blocked - panic mode active");
    return results;
  }

  const qualifiedCount = getUserQualifiedMovieCount(guild.id, userId);

  logger.info({
    evt: "updating_movie_tier",
    guildId: guild.id,
    userId,
    qualifiedCount,
  }, `Updating movie tier for user with ${qualifiedCount} qualified movies`);

  // Tiers are configured via admin commands and stored in DB. If none exist,
  // this feature is effectively disabled for this guild.
  const tiers = getRoleTiers(guild.id, "movie_night");
  if (tiers.length === 0) {
    logger.warn({ evt: "no_movie_tiers", guildId: guild.id }, "No movie tier roles configured");
    return results;
  }

  // Sort descending so we find the HIGHEST tier user qualifies for.
  // User with 15 movies should get tier-3 (10 movies), not tier-1 (3 movies).
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

  // Remove ALL other tier roles before adding the new one. This ensures users
  // only have one tier role at a time. We remove even higher tiers in case of
  // data corrections (e.g., admin removes a fraudulent attendance record).
  for (const tier of tiers) {
    if (tier.id === targetTier.id) continue;

    const removeResult = await removeRole(
      guild,
      userId,
      tier.role_id,
      "movie_tier_update",
      "system"
    );
    results.push(removeResult);
  }

  // Add the target tier role. Discord's role add is idempotent - if they
  // already have it, this is a no-op on Discord's side.
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

  // DM the user about their movie progress and track status for logging
  let dmStatus = "⏭️ No DM";
  let dmMessage = "";
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      // Find the next tier they're working towards
      const nextTier = sortedTiers
        .filter(t => t.threshold > qualifiedCount)
        .sort((a, b) => a.threshold - b.threshold)[0];

      dmMessage = `Thanks for joining us in the movie! This is your **${getOrdinal(qualifiedCount)}** movie`;

      if (addResult.action === "add") {
        // They just earned a new tier role
        dmMessage += `, so you got the <@&${targetTier.role_id}> role! 🎬`;
      } else if (nextTier) {
        // They didn't get a new role, show progress to next tier
        const needed = nextTier.threshold - qualifiedCount;
        dmMessage += `, you need **${needed}** more movie${needed > 1 ? "s" : ""} to get <@&${nextTier.role_id}>!`;
      } else {
        // They have the highest tier already
        dmMessage += `! You've reached the highest movie tier! 🏆`;
      }

      dmStatus = "✅ DM Sent";
      await member.send({ content: dmMessage }).catch((err) => {
        dmStatus = "❌ DM Failed (closed)";
        logger.debug({ err, guildId: guild.id, userId },
          "[movieNight] Could not DM user about movie progress");
      });
    }
  } catch (err) {
    dmStatus = "❌ DM Failed (error)";
    logger.debug({ err, guildId: guild.id, userId },
      "[movieNight] Error sending movie progress DM");
  }

  // Log to audit channel with DM status
  const botId = guild.client.user?.id ?? "system";
  await logActionPretty(guild, {
    actorId: botId,
    subjectId: userId,
    action: addResult.action === "add" ? "movie_tier_granted" : "movie_tier_progress",
    reason: addResult.action === "add"
      ? `Earned ${targetTier.tier_name} (${qualifiedCount} movies)`
      : `Progress update (${qualifiedCount} movies)`,
    meta: {
      qualifiedMovies: qualifiedCount,
      currentTier: targetTier.tier_name,
      tierRole: `<@&${targetTier.role_id}>`,
      roleAction: addResult.action === "add" ? "✅ Role Granted" : "⏭️ Already Has Role",
      dmStatus,
    },
  }).catch((err) => {
    logger.warn({ err, guildId: guild.id, userId },
      "[movieNight] Failed to log action - audit trail incomplete");
  });

  return results;
}
