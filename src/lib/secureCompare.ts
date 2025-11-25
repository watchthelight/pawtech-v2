/**
 * Pawtropolis Tech — src/lib/secureCompare.ts
 * WHAT: Constant-time string comparison to prevent timing attacks.
 * WHY: Protects sensitive operations (like password checks) from timing side-channel attacks.
 * HOW: Hashes both strings with SHA-256 then uses crypto.timingSafeEqual for constant-time comparison.
 * DOCS:
 *  - Node.js crypto.timingSafeEqual: https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b
 *  - Timing attacks explained: https://owasp.org/www-community/attacks/Timing_attack
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { timingSafeEqual, createHash } from "node:crypto";

/**
 * WHAT: Securely compare two strings in constant time.
 * WHY: Prevents timing attacks where attackers measure response times to guess secrets.
 * HOW: Hashes both inputs with SHA-256, then uses timingSafeEqual for fixed-time comparison.
 *
 * @param a - First string (e.g., user-provided password)
 * @param b - Second string (e.g., expected password from env)
 * @returns true if strings match, false otherwise
 *
 * @example
 * const userPassword = interaction.options.getString('password', true);
 * const expectedPassword = process.env.RESET_PASSWORD;
 * if (secureCompare(userPassword, expectedPassword)) {
 *   // Password matches - proceed with operation
 * } else {
 *   // Password mismatch - reject
 * }
 *
 * @security
 * - Never log input strings
 * - Always use for password/secret comparisons
 * - Hash-first ensures equal-length buffers for timingSafeEqual
 */
export function secureCompare(a: string, b: string): boolean {
  // Hash both strings to ensure equal-length buffers
  // timingSafeEqual requires equal-length inputs
  const ah = Buffer.from(createHash("sha256").update(a, "utf8").digest("hex"), "utf8");
  const bh = Buffer.from(createHash("sha256").update(b, "utf8").digest("hex"), "utf8");

  // Length check first (constant time if equal)
  if (ah.length !== bh.length) {
    return false;
  }

  // Constant-time comparison
  return timingSafeEqual(ah, bh);
}
