/**
 * Pawtropolis Tech — src/store/aiDetectionToggles.ts
 * WHAT: CRUD operations for AI detection API toggle state.
 * WHY: Allow admins to enable/disable individual AI detection APIs per guild.
 */

import { db } from "../db/db.js";
import type { AIDetectionService } from "../features/aiDetection/types.js";

// All available AI detection services
export const ALL_SERVICES: AIDetectionService[] = ["hive", "rapidai", "sightengine", "optic"];

/**
 * Check if a specific service is enabled for a guild.
 * Returns true by default if no toggle record exists.
 */
export function isServiceEnabled(guildId: string, service: AIDetectionService): boolean {
  try {
    const row = db
      .prepare<[string, string], { enabled: number }>(
        "SELECT enabled FROM ai_detection_toggles WHERE guild_id = ? AND service = ?"
      )
      .get(guildId, service);
    // Default to enabled if no record exists
    return row ? row.enabled === 1 : true;
  } catch {
    // Table might not exist yet (pre-migration), default to enabled
    return true;
  }
}

/**
 * Get all toggle states for a guild.
 * Returns a map of service -> enabled state.
 * Services without records default to enabled.
 */
export function getServiceToggles(guildId: string): Record<AIDetectionService, boolean> {
  const toggles: Record<AIDetectionService, boolean> = {
    hive: true,
    rapidai: true,
    sightengine: true,
    optic: true,
  };

  try {
    const rows = db
      .prepare<[string], { service: string; enabled: number }>(
        "SELECT service, enabled FROM ai_detection_toggles WHERE guild_id = ?"
      )
      .all(guildId);

    for (const row of rows) {
      if (row.service in toggles) {
        toggles[row.service as AIDetectionService] = row.enabled === 1;
      }
    }
  } catch {
    // Table might not exist yet (pre-migration), return defaults
  }

  return toggles;
}

/**
 * Get list of enabled services for a guild.
 */
export function getEnabledServices(guildId: string): AIDetectionService[] {
  const toggles = getServiceToggles(guildId);
  return ALL_SERVICES.filter((svc) => toggles[svc]);
}

/**
 * Set the enabled state for a service in a guild.
 */
export function setServiceEnabled(guildId: string, service: AIDetectionService, enabled: boolean): void {
  db.prepare(
    `INSERT INTO ai_detection_toggles (guild_id, service, enabled, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(guild_id, service) DO UPDATE SET
       enabled = excluded.enabled,
       updated_at = datetime('now')`
  ).run(guildId, service, enabled ? 1 : 0);
}

/**
 * Toggle a service's enabled state and return the new state.
 */
export function toggleService(guildId: string, service: AIDetectionService): boolean {
  const currentlyEnabled = isServiceEnabled(guildId, service);
  const newState = !currentlyEnabled;
  setServiceEnabled(guildId, service, newState);
  return newState;
}
