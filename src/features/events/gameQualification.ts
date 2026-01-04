/**
 * Pawtropolis Tech — src/features/events/gameQualification.ts
 * WHAT: Percentage-based qualification logic for game nights
 * WHY: Game nights qualify users who attend >X% of the total event duration
 * FLOWS:
 *  - Event ends → calculate total duration → check each user's % → qualify
 *
 * Unlike movie nights which use a fixed minute threshold (e.g., 30 min),
 * game nights use a percentage of the actual event runtime. This is fairer
 * because a 2-hour game night shouldn't have the same 30-min threshold as
 * a 3-hour movie night.
 *
 * Example with 50% threshold:
 *  - 2-hour event → need 60+ minutes to qualify
 *  - 1-hour event → need 30+ minutes to qualify
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { GameQualificationResult, GuildGameConfig, EventSession } from "./types.js";

/**
 * Calculate game night qualification based on percentage of event attended.
 *
 * @param userMinutes - Total minutes the user spent in VC
 * @param eventStartTime - Event start timestamp (ms)
 * @param eventEndTime - Event end timestamp (ms)
 * @param thresholdPercentage - Required percentage (1-100)
 * @returns Qualification result with all relevant stats
 *
 * @example
 * // 2-hour game night, user attended 65 minutes, 50% threshold
 * const result = calculateGameQualification(65, startTime, endTime, 50);
 * // result.qualified = true (65 >= 60 required)
 * // result.attendancePercentage = 54
 */
export function calculateGameQualification(
  userMinutes: number,
  eventStartTime: number,
  eventEndTime: number,
  thresholdPercentage: number
): GameQualificationResult {
  // Calculate event duration in minutes
  const eventDurationMinutes = Math.floor((eventEndTime - eventStartTime) / 60000);

  // Calculate required minutes (ceiling to avoid edge case where 49.9% rounds to 50%)
  const requiredMinutes = Math.ceil(eventDurationMinutes * (thresholdPercentage / 100));

  // Calculate user's percentage (avoid division by zero)
  const attendancePercentage = eventDurationMinutes > 0
    ? Math.round((userMinutes / eventDurationMinutes) * 100)
    : 0;

  // Qualify if user met the required minutes
  const qualified = userMinutes >= requiredMinutes;

  return {
    qualified,
    userMinutes,
    eventDurationMinutes,
    attendancePercentage,
    thresholdPercentage,
    requiredMinutes,
  };
}

/**
 * Calculate qualification for a game session using attendance mode.
 * Supports both 'cumulative' and 'continuous' modes like movie nights.
 *
 * @param session - User's session data
 * @param eventStartTime - Event start timestamp (ms)
 * @param eventEndTime - Event end timestamp (ms)
 * @param config - Guild game configuration
 * @returns Qualification result
 */
export function calculateGameSessionQualification(
  session: EventSession,
  eventStartTime: number,
  eventEndTime: number,
  config: GuildGameConfig
): GameQualificationResult {
  // Use longest session for 'continuous' mode, total minutes for 'cumulative'
  const relevantMinutes = config.attendanceMode === "continuous"
    ? session.longestSessionMinutes
    : session.totalMinutes;

  return calculateGameQualification(
    relevantMinutes,
    eventStartTime,
    eventEndTime,
    config.qualificationPercentage
  );
}

/**
 * Format qualification result as a human-readable string.
 * Useful for displaying in embeds and DMs.
 *
 * @param result - Qualification result
 * @returns Formatted string
 *
 * @example
 * formatQualificationResult(result)
 * // "Qualified (65 min / 120 min, 54%)"
 * // or "Not Qualified (25 min / 120 min, 21% - needed 50%)"
 */
export function formatQualificationResult(result: GameQualificationResult): string {
  const base = `${result.userMinutes} min / ${result.eventDurationMinutes} min, ${result.attendancePercentage}%`;

  if (result.qualified) {
    return `Qualified (${base})`;
  }

  return `Not Qualified (${base} - needed ${result.thresholdPercentage}%)`;
}

/**
 * Calculate how many more minutes a user needs to qualify.
 * Returns 0 if already qualified.
 *
 * @param result - Qualification result
 * @returns Minutes needed to qualify
 */
export function minutesNeededToQualify(result: GameQualificationResult): number {
  if (result.qualified) return 0;
  return result.requiredMinutes - result.userMinutes;
}
