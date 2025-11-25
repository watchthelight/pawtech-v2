/**
 * Pawtropolis Tech — src/lib/timefmt.ts
 * WHAT: Unified timestamp formatting utilities for Discord timestamps and human-readable ages.
 * WHY: Standardize time presentation across review cards, confirmations, and logs.
 * FLOWS: Convert epoch seconds to Discord formats, ISO strings, and short human-readable ages.
 * DOCS:
 *  - Discord timestamps: https://discord.com/developers/docs/reference#message-formatting
 *  - ISO 8601: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { nowUtc } from "./time.js";

/**
 * WHAT: Format an absolute timestamp as a copy-pasteable string.
 * WHY: Embeds on mobile should show stable, readable times without <t:...>.
 * FORMAT: "Thursday, October 30, 2025 at 06:41"
 * NOTE: Uses en-US locale by default with 24-hour clock for predictability.
 */
export function formatAbsolute(
  epochSec: number,
  options?: { locale?: string; timeZone?: string; hour12?: boolean }
): string {
  const { locale = "en-US", timeZone, hour12 = false } = options || {};
  const d = new Date(epochSec * 1000);
  const date = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(d);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12,
    timeZone,
  }).format(d);
  return `${date} at ${time}`;
}

/**
 * WHAT: Format an absolute UTC timestamp for concise footer use.
 * FORMAT: "2025-10-30 06:41 UTC"
 */
export function formatAbsoluteUtc(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return d
    .toISOString()
    .replace("T", " ")
    .replace(/:\d{2}\.\d{3}Z$/, " UTC");
}

/**
 * WHAT: Format epoch seconds as Discord absolute timestamp.
 * WHY: Shows full date and time in user's local timezone.
 * FORMAT: <t:epochSec:F> → "Monday, October 20, 2025 5:04 PM"
 * DOCS: https://discord.com/developers/docs/reference#message-formatting-timestamp-styles
 */
export function toDiscordAbs(epochSec: number): string {
  return `<t:${epochSec}:F>`;
}

/**
 * WHAT: Format epoch seconds as Discord relative timestamp.
 * WHY: Shows human-friendly relative time (e.g., "2 minutes ago").
 * FORMAT: <t:epochSec:R> → "2 minutes ago" / "in 5 hours"
 * DOCS: https://discord.com/developers/docs/reference#message-formatting-timestamp-styles
 */
export function toDiscordRel(epochSec: number): string {
  return `<t:${epochSec}:R>`;
}

/**
 * WHAT: Format epoch seconds as ISO 8601 string.
 * WHY: Standard format for logs, CSV exports, and DB debugging.
 * FORMAT: "2024-10-21T00:00:00.000Z"
 */
export function toIso(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString();
}

/**
 * WHAT: Format age in tiny human-readable units (e.g., "3m", "2h", "5d", "8w").
 * WHY: Compact display for review card summaries and inline status.
 * RULES:
 *  - Rounds UP to next whole unit (ceil)
 *  - Shows largest sensible unit (weeks cap at "w", no months/years)
 *  - 0-59s → "1m", 60-119s → "1m", 120-179s → "2m"
 *  - 3600-7199s → "1h", 7200-10799s → "2h"
 *  - 86400-172799s → "1d", 172800-259199s → "2d"
 *  - 604800+ → weeks (e.g., "2w", "8w")
 * EXAMPLES:
 *  - 30s ago → "1m"
 *  - 90s ago → "2m"
 *  - 3700s ago → "2h"
 *  - 90000s ago → "2d"
 *  - 1209600s ago → "2w"
 */
export function fmtAgeShort(epochSec: number, now = nowUtc()): string {
  const delta = now - epochSec;

  // Negative delta (future) - show as present
  if (delta <= 0) return "0m";

  const minute = 60;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  // Weeks (cap at weeks, no months/years)
  if (delta >= week) {
    return `${Math.ceil(delta / week)}w`;
  }

  // Days
  if (delta >= day) {
    return `${Math.ceil(delta / day)}d`;
  }

  // Hours
  if (delta >= hour) {
    return `${Math.ceil(delta / hour)}h`;
  }

  // Minutes (always at least 1m for anything > 0s)
  return `${Math.ceil(delta / minute)}m`;
}
