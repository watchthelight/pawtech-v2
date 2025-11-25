/**
 * Pawtropolis Tech — src/lib/csv.ts
 * WHAT: CSV streaming utilities for analytics export.
 * WHY: Enables large dataset exports without memory bloat.
 * FLOWS:
 *  - streamReviewActionsCSV → writes audit rows to stream with proper CSV escaping
 * DOCS:
 *  - RFC 4180 CSV: https://datatracker.ietf.org/doc/html/rfc4180
 *  - Node.js Streams: https://nodejs.org/api/stream.html
 *
 * NOTE: Uses chunked iteration with keyset pagination to cap memory usage.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Writable } from "stream";
import { db } from "../db/db.js";
import { logger } from "./logger.js";
import { tsToIso } from "./time.js";

export type CSVExportOptions = {
  guildId?: string;
  from?: number;
  to?: number;
  allGuilds?: boolean;
};

/**
 * escapeCsvField
 * WHAT: Escapes a field for CSV output per RFC 4180.
 * WHY: Prevents CSV injection and preserves data integrity.
 * HOW: Wraps in quotes if contains comma/newline/quote; doubles internal quotes.
 *
 * @param value - Field value (may be null/undefined)
 * @returns Escaped CSV field
 */
function escapeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  const str = String(value);

  // If field contains comma, newline, or quote, wrap in quotes and escape quotes
  if (str.includes(",") || str.includes("\n") || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * streamReviewActionsCSV
 * WHAT: Streams review_action rows as CSV to a destination stream.
 * WHY: Enables export of large datasets without OOM.
 * HOW: Chunked iteration with keyset pagination (LIMIT/OFFSET); writes header + rows.
 *
 * CSV Format:
 *   timestamp_iso,guild_id,app_id,user_id,moderator_id,action,reason
 *
 * @param opts - Export options (guildId, from, to, allGuilds)
 * @param stream - Destination writable stream
 * @returns Promise<{ rowCount: number, bytes: number }>
 */
/**
 * formatActionLogRow
 * WHAT: Transform action_log row to CSV-friendly format
 * WHY: Moderator history export with metadata
 */
export function formatActionLogRow(row: {
  id: number;
  action: string;
  actor_id: string;
  subject_id?: string | null;
  target?: string | null;
  created_at_s: number;
  reason?: string | null;
  meta_json?: string | null;
  guild_id: string;
}): Record<string, any> {
  // Parse meta_json if present
  let meta: Record<string, any> = {};
  if (row.meta_json) {
    try {
      meta = JSON.parse(row.meta_json);
    } catch {
      meta = { raw: row.meta_json };
    }
  }

  return {
    id: row.id,
    timestamp: new Date(row.created_at_s * 1000).toISOString(),
    action: row.action,
    actor_id: row.actor_id,
    subject_id: row.subject_id || "",
    target: row.target || meta.target || "",
    reason: row.reason || "",
    response_ms: meta.response_ms || "",
    guild_id: row.guild_id,
    app_id: meta.appId || meta.app_id || "",
    app_code: meta.appCode || meta.app_code || "",
    meta_summary: JSON.stringify(meta),
  };
}

/**
 * generateModHistoryCsv
 * WHAT: Generate CSV from action_log rows for moderator history
 * WHY: Export moderator action history for analysis
 */
export function generateModHistoryCsv(rows: any[]): string {
  const columns = [
    "id",
    "timestamp",
    "action",
    "actor_id",
    "subject_id",
    "target",
    "reason",
    "response_ms",
    "guild_id",
    "app_id",
    "app_code",
    "meta_summary",
  ];

  // Header
  const header = columns.map(escapeCsvField).join(",");

  // Format and escape rows
  const formattedRows = rows.map((row) => {
    const formatted = formatActionLogRow(row);
    return columns.map((col) => escapeCsvField(formatted[col])).join(",");
  });

  return [header, ...formattedRows].join("\n");
}

export async function streamReviewActionsCSV(
  opts: CSVExportOptions,
  stream: Writable
): Promise<{ rowCount: number; bytes: number }> {
  const start = Date.now();
  let rowCount = 0;
  let bytes = 0;

  try {
    // Write header
    const header = "timestamp_iso,guild_id,app_id,user_id,moderator_id,action,reason\n";
    stream.write(header);
    bytes += header.length;

    // Build query with chunked iteration
    const chunkSize = 5000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      let sql = `
        SELECT
          ra.created_at,
          a.guild_id,
          ra.app_id,
          a.user_id,
          ra.moderator_id,
          ra.action,
          ra.reason
        FROM review_action ra
        LEFT JOIN application a ON ra.app_id = a.id
      `;

      const conditions: string[] = [];
      const params: any[] = [];

      // Filter by guild (unless allGuilds is true)
      if (!opts.allGuilds && opts.guildId) {
        conditions.push(`a.guild_id = ?`);
        params.push(opts.guildId);
      }

      // Time filters
      if (opts.from !== undefined) {
        conditions.push(`ra.created_at >= ?`);
        params.push(opts.from);
      }
      if (opts.to !== undefined) {
        conditions.push(`ra.created_at <= ?`);
        params.push(opts.to);
      }

      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(" AND ")}`;
      }

      // Order by created_at for deterministic pagination
      sql += ` ORDER BY ra.created_at ASC, ra.id ASC`;
      sql += ` LIMIT ? OFFSET ?`;

      params.push(chunkSize, offset);

      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as Array<{
        created_at: number;
        guild_id: string | null;
        app_id: string;
        user_id: string | null;
        moderator_id: string;
        action: string;
        reason: string | null;
      }>;

      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      // Write rows to stream
      for (const row of rows) {
        const timestamp_iso = tsToIso(row.created_at);
        const guild_id = escapeCsvField(row.guild_id);
        const app_id = escapeCsvField(row.app_id);
        const user_id = escapeCsvField(row.user_id);
        const moderator_id = escapeCsvField(row.moderator_id);
        const action = escapeCsvField(row.action);
        const reason = escapeCsvField(row.reason);

        const line = `${timestamp_iso},${guild_id},${app_id},${user_id},${moderator_id},${action},${reason}\n`;
        stream.write(line);
        bytes += line.length;
        rowCount++;
      }

      // Check if we've exhausted the data
      if (rows.length < chunkSize) {
        hasMore = false;
      } else {
        offset += chunkSize;
      }
    }

    // End the stream
    stream.end();

    const elapsed = Date.now() - start;
    logger.info(
      {
        export: "streamReviewActionsCSV",
        rows: rowCount,
        bytes,
        ms: elapsed,
        scope: opts.guildId || "all",
      },
      "[analytics] export completed"
    );

    return { rowCount, bytes };
  } catch (err) {
    logger.error({ err, opts }, "[analytics] CSV export failed");
    throw err;
  }
}
