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
 */
export const toUnix = (date: Date | number): number =>
  Math.floor((date instanceof Date ? date.getTime() : date) / 1000);

/**
 * Format timestamp for Discord display.
 * @param d - Date object or Unix timestamp in milliseconds
 * @param style - 'f' = Short date/time, 'R' = Relative
 */
export const ts = (d: Date | number, style: 'f' | 'R' = 'f'): string => `<t:${toUnix(d)}:${style}>`;
