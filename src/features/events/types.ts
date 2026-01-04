/**
 * Pawtropolis Tech — src/features/events/types.ts
 * WHAT: Shared types for the unified event attendance tracking system
 * WHY: Centralized type definitions for movie nights, game nights, and future event types
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/**
 * Event types supported by the attendance tracking system.
 * - 'movie': Movie night - qualification based on fixed minute threshold
 * - 'game': Game night - qualification based on percentage of event duration
 */
export type EventType = "movie" | "game";

/**
 * In-memory session state for a user during an active event.
 * Tracks their VC participation across multiple join/leave cycles.
 */
export interface EventSession {
  /** Unix timestamp (ms) when user joined VC, null if not currently in VC */
  currentSessionStart: number | null;
  /** Longest continuous session duration in minutes (for "continuous" mode) */
  longestSessionMinutes: number;
  /** Total accumulated minutes across all sessions (for "cumulative" mode) */
  totalMinutes: number;
}

/**
 * Active event being tracked for a guild.
 * Only one event per guild can be active at a time.
 */
export interface ActiveEvent {
  guildId: string;
  channelId: string;
  /** Date in YYYY-MM-DD format */
  eventDate: string;
  /** Unix timestamp (ms) when event tracking started */
  startedAt: number;
  /** Type of event (affects qualification logic) */
  eventType: EventType;
}

/**
 * Guild-specific configuration for game nights.
 */
export interface GuildGameConfig {
  guildId: string;
  /** Percentage of event duration required to qualify (1-100) */
  qualificationPercentage: number;
  /** Attendance mode: 'cumulative' or 'continuous' */
  attendanceMode: "cumulative" | "continuous";
}

/**
 * Result of game night qualification calculation.
 */
export interface GameQualificationResult {
  /** Whether the user qualified */
  qualified: boolean;
  /** User's total minutes in VC */
  userMinutes: number;
  /** Total event duration in minutes */
  eventDurationMinutes: number;
  /** User's attendance as percentage of event duration */
  attendancePercentage: number;
  /** Required percentage threshold */
  thresholdPercentage: number;
  /** Minutes required to qualify (eventDuration * threshold%) */
  requiredMinutes: number;
}

/**
 * Attendance record as stored in the database.
 */
export interface AttendanceRecord {
  id?: number;
  guildId: string;
  userId: string;
  eventDate: string;
  eventType: EventType;
  voiceChannelId: string;
  durationMinutes: number;
  longestSessionMinutes: number;
  qualified: boolean;
  /** Event start time (ms) - used for game night percentage calculation */
  eventStartTime?: number;
  /** Event end time (ms) - used for game night percentage calculation */
  eventEndTime?: number;
  /** 'automatic' or 'manual' */
  adjustmentType?: string;
  /** User ID of mod who made adjustment */
  adjustedBy?: string;
  /** Reason for manual adjustment */
  adjustmentReason?: string;
  createdAt?: number;
}

/**
 * Summary statistics for a user's event attendance.
 */
export interface AttendanceStats {
  totalEvents: number;
  qualifiedEvents: number;
  totalMinutes: number;
  eventType: EventType;
}
