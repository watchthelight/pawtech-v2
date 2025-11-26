/**
 * Pawtropolis Tech — src/config.ts
 * WHAT: Global configuration constants loaded from environment variables.
 * WHY: Centralizes bot-wide settings that don't vary per-guild.
 *
 * For per-guild configuration (logging channel, flagger thresholds), see:
 *  - src/config/loggingStore.ts
 *  - src/config/flaggerStore.ts
 *
 * ENV VARS:
 *  - TRACE_INTERACTIONS: Set to "1" to enable verbose interaction logging (debug only)
 *  - OWNER_IDS: Comma-separated list of Discord user IDs with owner privileges
 *  - RESET_PASSWORD: Secret password for destructive admin operations
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// ============================================================================
// Debugging & Diagnostics
// ============================================================================

/**
 * WHAT: Enables verbose logging of all slash command interactions.
 * WHY: Useful for debugging command registration/handling issues in development.
 * DEFAULT: false (disabled) - only enable when actively debugging interaction flow.
 *
 * Set TRACE_INTERACTIONS=1 in .env to enable. Any other value (or unset) = disabled.
 * WARNING: This generates a lot of log output - don't leave enabled in production.
 */
export const TRACE_INTERACTIONS = process.env.TRACE_INTERACTIONS === "1";

// ============================================================================
// Authorization & Access Control
// ============================================================================

/**
 * WHAT: List of Discord user IDs with bot owner privileges.
 * WHY: Certain commands (like /eval, /shutdown) should be restricted to bot owners.
 *
 * Set OWNER_IDS in .env as comma-separated Discord user IDs:
 *   OWNER_IDS=123456789012345678,234567890123456789
 *
 * DEFAULT: Empty array (no owners) - the bot will function but owner-only
 * commands will be inaccessible until configured.
 *
 * Whitespace around IDs is trimmed, empty strings are filtered out, so
 * "123, 456, " parses to ["123", "456"].
 */
export const OWNER_IDS = process.env.OWNER_IDS
  ? process.env.OWNER_IDS.split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  : [];

/**
 * WHAT: Admin password required for /modstats reset command.
 * WHY: Protects destructive cache-clearing operation from unauthorized use.
 * SECURITY: Never log or echo this value; use secureCompare for validation.
 *
 * Set RESET_PASSWORD in .env to a strong random string. If unset, the
 * reset command will fail with "not configured" error.
 */
export const RESET_PASSWORD = process.env.RESET_PASSWORD;
