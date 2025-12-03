/**
 * Pawtropolis Tech — src/lib/dt.ts
 * WHAT: Tiny Discord timestamp helpers.
 * WHY: Convert Date/number to Discord timestamp format strings.
 * DOCS:
 *  - Discord timestamps: https://discord.com/developers/docs/reference#message-formatting-timestamp-styles
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/**
 * Convert Date or milliseconds to Unix timestamp (seconds).
 *
 * GOTCHA: Passing seconds instead of milliseconds here is a common mistake.
 * If your dates are showing as 1970, you probably passed Unix seconds.
 * Date.now() gives milliseconds. SQLite timestamps are usually seconds.
 */
export const toUnix = (date: Date | number): number =>
  Math.floor((date instanceof Date ? date.getTime() : date) / 1000);

/**
 * Format timestamp for Discord display.
 * @param d - Date object or Unix timestamp in milliseconds
 * @param style - 'f' = Short date/time, 'R' = Relative
 *
 * WHY only 'f' and 'R'? Those are the two we actually use. Discord supports
 * more (t, T, d, D, f, F, R) but adding them all invites bikeshedding about
 * which to use. YAGNI.
 */
export const ts = (d: Date | number, style: 'f' | 'R' = 'f'): string => `<t:${toUnix(d)}:${style}>`;
