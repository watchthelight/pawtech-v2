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
  // Two separate Intl.DateTimeFormat calls because combining date and time
  // options in a single formatter produces locale-specific ordering we can't
  // control. This way we always get "DATE at TIME" regardless of locale.
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
  // Duplicates logic from time.ts formatUtc - intentional to keep this module
  // self-contained. If you're tempted to DRY this up, consider that timefmt
  // is the "one true source" for formatting and time.ts might be deprecated.
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
  // :F = "Full" format in user's local timezone. Discord renders this client-side.
  // Warning: doesn't render in embed footers or author fields - use formatAbsoluteUtc there.
  return `<t:${epochSec}:F>`;
}

/**
 * WHAT: Format epoch seconds as Discord relative timestamp.
 * WHY: Shows human-friendly relative time (e.g., "2 minutes ago").
 * FORMAT: <t:epochSec:R> → "2 minutes ago" / "in 5 hours"
 * DOCS: https://discord.com/developers/docs/reference#message-formatting-timestamp-styles
 */
export function toDiscordRel(epochSec: number): string {
  // :R = Relative format ("2 minutes ago"). Updates automatically in Discord client.
  // Same footer/author caveat as toDiscordAbs - use fmtAgeShort for plain text fallback.
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

  // Negative delta = future timestamp. Could be clock skew or a bug.
  // Return "0m" rather than negative values which would look broken.
  if (delta <= 0) return "0m";

  const minute = 60;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  // Weeks - capped here intentionally. Showing "3mo" or "2y" in a tight UI
  // slot looks weird and isn't useful for review age tracking.
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

  // Minutes - always rounds up, so 1 second shows as "1m". This is intentional:
  // sub-minute precision isn't useful for review tracking and "0m" looks like no time.
  return `${Math.ceil(delta / minute)}m`;
}
