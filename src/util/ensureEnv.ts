/**
 * Pawtropolis Tech — src/util/ensureEnv.ts
 * WHAT: Fail-fast guard for required environment variables.
 * WHY: Prevent cryptic TokenInvalid errors by catching missing env vars early.
 * FLOWS: requireEnv(name) → throws if missing/empty → exits process
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/**
 * WHAT: Require an environment variable to be set.
 * WHY: Fail fast with clear error message instead of downstream failures.
 *
 * @param name - Environment variable name
 * @returns Value of the environment variable
 * @throws Process exits with code 1 if missing
 */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`[fatal] Missing required env: ${name}. Did .env load?`);
    process.exit(1);
  }
  return v;
}
