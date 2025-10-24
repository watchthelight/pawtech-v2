/**
 * Pawtropolis Tech — src/utils/owner.ts
 * WHAT: Owner override utilities for bypassing permission checks.
 * WHY: Allows specified users to bypass all permission requirements globally.
 * FLOWS: Check if user ID is in OWNER_IDS env var.
 * DOCS:
 *  - Environment: OWNER_IDS as comma-separated user IDs
 */
import { env } from "../lib/env.js";

const ownerIds = env.OWNER_IDS
  ? env.OWNER_IDS.split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  : [];

/**
 * isOwner
 * WHAT: Checks if a user ID is in the owner override list.
 * WHY: Centralizes owner check logic for permission bypass.
 * PARAMS:
 *  - userId: Discord user ID to check
 * RETURNS: true if user is an owner, false otherwise
 */
export function isOwner(userId: string): boolean {
  return ownerIds.includes(userId);
}
