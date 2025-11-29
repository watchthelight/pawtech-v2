// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/features/suggestions/store.ts
 * WHAT: Database operations for the suggestion box feature
 * WHY: Centralized data access layer for suggestions and votes
 * FLOWS:
 *  - createSuggestion() → INSERT new suggestion
 *  - getSuggestion() → SELECT by id
 *  - updateSuggestionStatus() → UPDATE status + staff response
 *  - castVote() → UPSERT vote + recalculate totals
 *  - listSuggestions() → SELECT with pagination and filters
 * DOCS:
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */

import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";

// ============================================================================
// Types
// ============================================================================

export type SuggestionStatus = "open" | "approved" | "denied" | "implemented";

export interface Suggestion {
  id: number;
  guild_id: string;
  user_id: string;
  content: string;
  status: SuggestionStatus;
  upvotes: number;
  downvotes: number;
  staff_response: string | null;
  responded_by: string | null;
  message_id: string | null;
  channel_id: string | null;
  created_at: number;
  resolved_at: number | null;
}

export interface SuggestionVote {
  suggestion_id: number;
  user_id: string;
  vote: 1 | -1;
  created_at: number;
}

// ============================================================================
// Schema Initialization
// ============================================================================

let schemaEnsured = false;

/**
 * ensureSuggestionSchema
 * WHAT: Creates suggestion and suggestion_vote tables if missing
 * WHY: Self-healing schema for additive migrations
 */
export function ensureSuggestionSchema(): void {
  if (schemaEnsured) return;

  try {
    // Create suggestion table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS suggestion (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        upvotes INTEGER DEFAULT 0,
        downvotes INTEGER DEFAULT 0,
        staff_response TEXT,
        responded_by TEXT,
        message_id TEXT,
        channel_id TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      )
    `).run();

    // Create suggestion_vote table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS suggestion_vote (
        suggestion_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        vote INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (suggestion_id, user_id),
        FOREIGN KEY (suggestion_id) REFERENCES suggestion(id) ON DELETE CASCADE
      )
    `).run();

    // Create indexes
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_suggestion_guild_status
      ON suggestion(guild_id, status)
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_suggestion_votes
      ON suggestion(guild_id, upvotes DESC)
    `).run();

    logger.info("[ensure] suggestion schema ensured");
    schemaEnsured = true;
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure suggestion schema");
    throw err;
  }
}

/**
 * ensureSuggestionConfigColumns
 * WHAT: Adds suggestion_channel_id and suggestion_cooldown columns to guild_config
 * WHY: Stores per-guild suggestion configuration
 */
export function ensureSuggestionConfigColumns(): void {
  try {
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'`)
      .get();

    if (!tableExists) {
      logger.warn("[ensure] guild_config table does not exist, skipping suggestion columns");
      return;
    }

    const cols = db.prepare(`PRAGMA table_info(guild_config)`).all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);

    if (!colNames.includes("suggestion_channel_id")) {
      logger.info("[ensure] adding suggestion_channel_id column to guild_config");
      db.prepare(`ALTER TABLE guild_config ADD COLUMN suggestion_channel_id TEXT`).run();
    }

    if (!colNames.includes("suggestion_cooldown")) {
      logger.info("[ensure] adding suggestion_cooldown column to guild_config");
      // Default 1 hour (3600 seconds)
      db.prepare(`ALTER TABLE guild_config ADD COLUMN suggestion_cooldown INTEGER DEFAULT 3600`).run();
    }

    logger.info("[ensure] suggestion config columns ensured");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure suggestion config columns");
    throw err;
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * createSuggestion
 * WHAT: Creates a new suggestion in the database
 * RETURNS: The created suggestion with its new ID
 */
export function createSuggestion(
  guildId: string,
  userId: string,
  content: string,
  messageId?: string,
  channelId?: string
): Suggestion {
  ensureSuggestionSchema();

  const now = Math.floor(Date.now() / 1000);

  const result = db.prepare(`
    INSERT INTO suggestion (guild_id, user_id, content, message_id, channel_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(guildId, userId, content, messageId ?? null, channelId ?? null, now);

  const suggestion = db.prepare(`SELECT * FROM suggestion WHERE id = ?`).get(result.lastInsertRowid) as Suggestion;

  logger.info({
    evt: "suggestion_created",
    suggestionId: suggestion.id,
    guildId,
    userId,
  }, `Suggestion #${suggestion.id} created`);

  return suggestion;
}

/**
 * getSuggestion
 * WHAT: Retrieves a suggestion by ID
 * RETURNS: The suggestion or null if not found
 */
export function getSuggestion(id: number): Suggestion | null {
  ensureSuggestionSchema();

  const suggestion = db.prepare(`SELECT * FROM suggestion WHERE id = ?`).get(id) as Suggestion | undefined;
  return suggestion ?? null;
}

/**
 * getSuggestionByGuild
 * WHAT: Retrieves a suggestion by ID with guild verification
 * WHY: Ensures suggestions can only be accessed within their own guild
 */
export function getSuggestionByGuild(id: number, guildId: string): Suggestion | null {
  ensureSuggestionSchema();

  const suggestion = db.prepare(`
    SELECT * FROM suggestion WHERE id = ? AND guild_id = ?
  `).get(id, guildId) as Suggestion | undefined;
  return suggestion ?? null;
}

/**
 * updateSuggestionMessage
 * WHAT: Updates the message_id and channel_id after posting the embed
 */
export function updateSuggestionMessage(id: number, messageId: string, channelId: string): void {
  ensureSuggestionSchema();

  db.prepare(`
    UPDATE suggestion SET message_id = ?, channel_id = ? WHERE id = ?
  `).run(messageId, channelId, id);
}

/**
 * updateSuggestionStatus
 * WHAT: Updates suggestion status with staff response
 * WHY: Staff actions (approve/deny/implement) need to be recorded
 */
export function updateSuggestionStatus(
  id: number,
  status: SuggestionStatus,
  respondedBy: string,
  staffResponse?: string
): void {
  ensureSuggestionSchema();

  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    UPDATE suggestion
    SET status = ?, responded_by = ?, staff_response = ?, resolved_at = ?
    WHERE id = ?
  `).run(status, respondedBy, staffResponse ?? null, now, id);

  logger.info({
    evt: "suggestion_status_updated",
    suggestionId: id,
    status,
    respondedBy,
  }, `Suggestion #${id} ${status}`);
}

/**
 * deleteSuggestion
 * WHAT: Removes a suggestion from the database
 * WHY: Staff can delete inappropriate suggestions
 */
export function deleteSuggestion(id: number): boolean {
  ensureSuggestionSchema();

  const result = db.prepare(`DELETE FROM suggestion WHERE id = ?`).run(id);

  if (result.changes > 0) {
    logger.info({ evt: "suggestion_deleted", suggestionId: id }, `Suggestion #${id} deleted`);
    return true;
  }
  return false;
}

// ============================================================================
// Voting Operations
// ============================================================================

/**
 * castVote
 * WHAT: Records or updates a user's vote on a suggestion
 * WHY: One vote per user, can change vote
 * RETURNS: The updated vote totals and whether this changed an existing vote
 */
export function castVote(
  suggestionId: number,
  userId: string,
  vote: 1 | -1
): { upvotes: number; downvotes: number; changed: boolean } {
  ensureSuggestionSchema();

  const now = Math.floor(Date.now() / 1000);

  // Check for existing vote
  const existing = db.prepare(`
    SELECT vote FROM suggestion_vote WHERE suggestion_id = ? AND user_id = ?
  `).get(suggestionId, userId) as { vote: number } | undefined;

  const changed = existing !== undefined && existing.vote !== vote;

  // UPSERT vote
  db.prepare(`
    INSERT INTO suggestion_vote (suggestion_id, user_id, vote, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (suggestion_id, user_id) DO UPDATE SET vote = excluded.vote, created_at = excluded.created_at
  `).run(suggestionId, userId, vote, now);

  // Recalculate totals
  const upvotes = db.prepare(`
    SELECT COUNT(*) as count FROM suggestion_vote WHERE suggestion_id = ? AND vote = 1
  `).get(suggestionId) as { count: number };

  const downvotes = db.prepare(`
    SELECT COUNT(*) as count FROM suggestion_vote WHERE suggestion_id = ? AND vote = -1
  `).get(suggestionId) as { count: number };

  // Update suggestion totals
  db.prepare(`
    UPDATE suggestion SET upvotes = ?, downvotes = ? WHERE id = ?
  `).run(upvotes.count, downvotes.count, suggestionId);

  logger.debug({
    evt: "suggestion_vote_cast",
    suggestionId,
    userId,
    vote,
    changed,
    upvotes: upvotes.count,
    downvotes: downvotes.count,
  }, `Vote recorded on suggestion #${suggestionId}`);

  return { upvotes: upvotes.count, downvotes: downvotes.count, changed };
}

/**
 * getUserVote
 * WHAT: Gets the user's current vote on a suggestion
 * RETURNS: 1, -1, or null if no vote
 */
export function getUserVote(suggestionId: number, userId: string): 1 | -1 | null {
  ensureSuggestionSchema();

  const vote = db.prepare(`
    SELECT vote FROM suggestion_vote WHERE suggestion_id = ? AND user_id = ?
  `).get(suggestionId, userId) as { vote: number } | undefined;

  return vote?.vote as 1 | -1 | null ?? null;
}

// ============================================================================
// Query Operations
// ============================================================================

/**
 * listSuggestions
 * WHAT: Retrieves suggestions with pagination and optional status filter
 * WHY: Supports /suggestions command with filtering
 */
export function listSuggestions(
  guildId: string,
  options: {
    status?: SuggestionStatus;
    limit?: number;
    offset?: number;
    sortBy?: "votes" | "newest";
  } = {}
): { suggestions: Suggestion[]; total: number } {
  ensureSuggestionSchema();

  const { status, limit = 10, offset = 0, sortBy = "newest" } = options;

  let whereClause = "WHERE guild_id = ?";
  const params: (string | number)[] = [guildId];

  if (status) {
    whereClause += " AND status = ?";
    params.push(status);
  }

  const orderClause = sortBy === "votes"
    ? "ORDER BY (upvotes - downvotes) DESC, created_at DESC"
    : "ORDER BY created_at DESC";

  // Get total count
  const countResult = db.prepare(`
    SELECT COUNT(*) as count FROM suggestion ${whereClause}
  `).get(...params) as { count: number };

  // Get paginated results
  const suggestions = db.prepare(`
    SELECT * FROM suggestion ${whereClause} ${orderClause} LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Suggestion[];

  return { suggestions, total: countResult.count };
}

/**
 * getUserLastSuggestionTime
 * WHAT: Gets the timestamp of the user's most recent suggestion
 * WHY: Enforces cooldown between suggestions
 */
export function getUserLastSuggestionTime(guildId: string, userId: string): number | null {
  ensureSuggestionSchema();

  const result = db.prepare(`
    SELECT created_at FROM suggestion
    WHERE guild_id = ? AND user_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(guildId, userId) as { created_at: number } | undefined;

  return result?.created_at ?? null;
}

/**
 * getSuggestionCooldown
 * WHAT: Gets the suggestion cooldown for a guild (in seconds)
 * RETURNS: Cooldown in seconds, default 3600 (1 hour)
 */
export function getSuggestionCooldown(guildId: string): number {
  ensureSuggestionConfigColumns();

  const result = db.prepare(`
    SELECT suggestion_cooldown FROM guild_config WHERE guild_id = ?
  `).get(guildId) as { suggestion_cooldown: number | null } | undefined;

  return result?.suggestion_cooldown ?? 3600;
}

/**
 * getSuggestionChannelId
 * WHAT: Gets the configured suggestion channel for a guild
 */
export function getSuggestionChannelId(guildId: string): string | null {
  ensureSuggestionConfigColumns();

  const result = db.prepare(`
    SELECT suggestion_channel_id FROM guild_config WHERE guild_id = ?
  `).get(guildId) as { suggestion_channel_id: string | null } | undefined;

  return result?.suggestion_channel_id ?? null;
}
