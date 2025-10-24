// Configuration constants
export const TRACE_INTERACTIONS = process.env.TRACE_INTERACTIONS === "1";
export const OWNER_IDS = process.env.OWNER_IDS
  ? process.env.OWNER_IDS.split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  : [];

/**
 * WHAT: Admin password required for /modstats reset command.
 * WHY: Protects destructive cache-clearing operation from unauthorized use.
 * SECURITY: Never log or echo this value; use secureCompare for validation.
 */
export const RESET_PASSWORD = process.env.RESET_PASSWORD;
