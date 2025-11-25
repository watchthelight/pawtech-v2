/**
 * Pawtropolis Tech — src/lib/time.ts
 * WHAT: Unix epoch timestamp utilities for deterministic test-friendly timestamps.
 * WHY: SQLite defaults can't be mocked in tests; explicit timestamps keep tests predictable.
 * time is a flat circle (also it's in seconds not milliseconds)
 * FLOWS:
 *  - nowUtc() → current Unix seconds (INTEGER for SQLite)
 *  - tsToIso() → convert Unix seconds back to ISO8601 string
 * DOCS:
 *  - Unix epoch: https://en.wikipedia.org/wiki/Unix_time
 *  - Date.now(): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/now
 *
 * NOTE: All timestamps in review_action.created_at are Unix seconds (INTEGER), not milliseconds.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/**
 * Returns the current Unix timestamp in seconds (not milliseconds).
 * Used for deterministic created_at values in review_action inserts.
 *
 * @returns Unix timestamp in seconds
 * @example
 * const now = nowUtc(); // e.g., 1729468800
 * db.prepare(`INSERT INTO review_action (created_at, ...) VALUES (?, ...)`).run(now, ...);
 */
export const nowUtc = (): number => Math.floor(Date.now() / 1000);

/**
 * Converts Unix timestamp (seconds) to ISO8601 string.
 * Used for displaying timestamps in UI and logs.
 *
 * @param seconds - Unix timestamp in seconds
 * @returns ISO8601 formatted string
 * @example
 * tsToIso(1729468800) // "2024-10-20T20:00:00.000Z"
 */
export const tsToIso = (seconds: number): string => new Date(seconds * 1000).toISOString();

/**
 * WHAT: Format Unix timestamp as human-readable UTC time for embed footers.
 * WHY: Discord doesn't render <t:...> tags in embed footers; need plain text.
 * FORMAT: "2025-10-20 18:42 UTC" (concise ISO-ish, always UTC)
 *
 * @param tsSec - Unix timestamp in seconds
 * @returns Formatted UTC string
 * @example
 * formatUtc(1729468800) // "2024-10-20 20:00 UTC"
 */
export function formatUtc(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  // ISO-ish but concise: YYYY-MM-DD HH:MM UTC (no seconds, no milliseconds)
  return d
    .toISOString()
    .replace("T", " ")
    .replace(/:\d{2}\.\d{3}Z$/, " UTC");
}

/**
 * WHAT: Format time difference as relative string (e.g., "14m ago").
 * WHY: Human-friendly relative times for embed footers where <t:...R> doesn't render.
 * FORMAT: "Xs ago", "Xm ago", "Xh ago", "Xd ago", "Xwk ago", "Xmo ago", "Xy ago", or "just now"
 *
 * @param tsSec - Unix timestamp in seconds
 * @param nowSec - Current Unix timestamp in seconds (defaults to now)
 * @returns Relative time string
 * @example
 * formatRelative(nowUtc() - 840) // "14m ago"
 * formatRelative(nowUtc() - 30)  // "30s ago"
 * formatRelative(nowUtc())       // "just now"
 */
export function formatRelative(tsSec: number, nowSec = Math.floor(Date.now() / 1000)): string {
  let diff = Math.max(0, nowSec - tsSec);

  // Unit conversion factors and labels
  const units: [number, string][] = [
    [60, "s"], // seconds
    [60, "m"], // minutes
    [24, "h"], // hours
    [7, "d"], // days
    [4.348, "wk"], // weeks (avg 4.348 weeks/month)
    [12, "mo"], // months
    [Number.POSITIVE_INFINITY, "y"], // years
  ];

  const labels = ["s", "m", "h", "d", "wk", "mo", "y"];
  let i = 0;

  // Find the appropriate unit
  for (; i < units.length - 1 && diff >= units[i][0]; i++) {
    diff = diff / units[i][0];
  }

  const val = Math.floor(diff);
  return val === 0 ? "just now" : `${val}${labels[i]} ago`;
}
