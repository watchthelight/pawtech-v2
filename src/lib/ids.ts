/**
 * Pawtropolis Tech — src/lib/ids.ts
 * WHAT: Tiny helpers for human-friendly short codes.
 * WHY: HEX6 codes are easier to read over voice/screenshots than full UUIDs.
 * FLOWS: shortCode() → djb2-ish hash → hex → uppercase, 6 chars
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * shortCode
 * WHAT: Deterministic HEX6 (0–FFFFFF) from a string id.
 * WHY: Humans > UUIDs; we display these in review UIs and logs.
 * PARAMS:
 *  - id: Any stable identifier (application id).
 * RETURNS: Uppercase 6-hex string.
 * THROWS: Never.
 */
/**
 * Generates a 6-character hex code from any string ID (typically Discord snowflakes).
 *
 * Design notes:
 * - Uses DJB2 hash variant (multiply by 33, accumulate char codes)
 * - `>>> 0` forces unsigned 32-bit, preventing negative numbers
 * - Final slice(-6) takes the low 24 bits, giving 16M possible codes
 *
 * Collision risk: With ~16M buckets, birthday problem says expect first collision
 * around ~5000 unique IDs. Fine for our scale; if collisions matter, store a lookup
 * table and regenerate on conflict. Current usage is display-only (review UIs, logs).
 *
 * Example: "123456789012345678" -> "A1B2C3"
 */
export function shortCode(id: string): string {
  let hash = 0 >>> 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).toUpperCase().padStart(6, "0").slice(-6);
}
