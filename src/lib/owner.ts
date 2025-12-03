/**
 * Pawtropolis Tech — src/lib/owner.ts
 * WHAT: Owner override utilities for bypassing permission checks.
 * WHY: Allows specified users to bypass all permission requirements globally.
 * FLOWS: Check if user ID is in OWNER_IDS env var.
 * DOCS:
 *  - Environment: OWNER_IDS as comma-separated user IDs
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { env } from "./env.js";

// Parse owner IDs once at module load. This is intentionally eager - we'd rather
// fail fast at startup if OWNER_IDS is malformed than discover it later when
// someone tries to use a privileged command.
//
// SECURITY: These IDs bypass ALL permission checks. Keep this list minimal.
// If you're adding someone here "temporarily for debugging," set a calendar
// reminder to remove them. You will forget otherwise. Ask me how I know.
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
  // O(n) lookup is fine - ownerIds is typically 1-3 entries.
  // If you somehow have 1000 bot owners, you have bigger problems than performance.
  return ownerIds.includes(userId);
}
