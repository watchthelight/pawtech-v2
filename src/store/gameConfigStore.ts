/**
 * Pawtropolis Tech — src/store/gameConfigStore.ts
 * WHAT: CRUD operations for game night configuration per guild
 * WHY: Allow admins to configure game night qualification settings
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import type { GuildGameConfig } from "../features/events/types.js";

/** Default game night configuration values */
const DEFAULTS = {
  qualificationPercentage: 50,
  attendanceMode: "cumulative" as const,
};

/**
 * Get game night configuration for a guild.
 * Returns defaults if no config exists.
 */
export function getGameConfig(guildId: string): GuildGameConfig {
  try {
    const row = db
      .prepare<[string], { qualification_percentage: number; attendance_mode: string }>(
        "SELECT qualification_percentage, attendance_mode FROM guild_game_config WHERE guild_id = ?"
      )
      .get(guildId);

    if (row) {
      return {
        guildId,
        qualificationPercentage: row.qualification_percentage,
        attendanceMode: row.attendance_mode as "cumulative" | "continuous",
      };
    }
  } catch {
    // Table might not exist yet (pre-migration), return defaults
  }

  return {
    guildId,
    qualificationPercentage: DEFAULTS.qualificationPercentage,
    attendanceMode: DEFAULTS.attendanceMode,
  };
}

/**
 * Get the qualification percentage for a guild.
 * Returns default (50%) if not configured.
 */
export function getGameQualificationPercentage(guildId: string): number {
  try {
    const row = db
      .prepare<[string], { qualification_percentage: number }>(
        "SELECT qualification_percentage FROM guild_game_config WHERE guild_id = ?"
      )
      .get(guildId);

    return row?.qualification_percentage ?? DEFAULTS.qualificationPercentage;
  } catch {
    return DEFAULTS.qualificationPercentage;
  }
}

/**
 * Get the attendance mode for a guild.
 * Returns default ('cumulative') if not configured.
 */
export function getGameAttendanceMode(guildId: string): "cumulative" | "continuous" {
  try {
    const row = db
      .prepare<[string], { attendance_mode: string }>(
        "SELECT attendance_mode FROM guild_game_config WHERE guild_id = ?"
      )
      .get(guildId);

    return (row?.attendance_mode as "cumulative" | "continuous") ?? DEFAULTS.attendanceMode;
  } catch {
    return DEFAULTS.attendanceMode;
  }
}

/**
 * Set the qualification percentage for a guild.
 * @param percentage - Must be between 10 and 90
 */
export function setGameQualificationPercentage(guildId: string, percentage: number): void {
  if (percentage < 10 || percentage > 90) {
    throw new Error("Percentage must be between 10 and 90");
  }

  db.prepare(
    `INSERT INTO guild_game_config (guild_id, qualification_percentage, updated_at)
     VALUES (?, ?, strftime('%s', 'now'))
     ON CONFLICT(guild_id) DO UPDATE SET
       qualification_percentage = excluded.qualification_percentage,
       updated_at = strftime('%s', 'now')`
  ).run(guildId, percentage);
}

/**
 * Set the attendance mode for a guild.
 */
export function setGameAttendanceMode(guildId: string, mode: "cumulative" | "continuous"): void {
  db.prepare(
    `INSERT INTO guild_game_config (guild_id, attendance_mode, updated_at)
     VALUES (?, ?, strftime('%s', 'now'))
     ON CONFLICT(guild_id) DO UPDATE SET
       attendance_mode = excluded.attendance_mode,
       updated_at = strftime('%s', 'now')`
  ).run(guildId, mode);
}

/**
 * Update multiple config fields at once.
 */
export function updateGameConfig(
  guildId: string,
  updates: Partial<Omit<GuildGameConfig, "guildId">>
): void {
  const current = getGameConfig(guildId);

  db.prepare(
    `INSERT INTO guild_game_config (guild_id, qualification_percentage, attendance_mode, updated_at)
     VALUES (?, ?, ?, strftime('%s', 'now'))
     ON CONFLICT(guild_id) DO UPDATE SET
       qualification_percentage = excluded.qualification_percentage,
       attendance_mode = excluded.attendance_mode,
       updated_at = strftime('%s', 'now')`
  ).run(
    guildId,
    updates.qualificationPercentage ?? current.qualificationPercentage,
    updates.attendanceMode ?? current.attendanceMode
  );
}
