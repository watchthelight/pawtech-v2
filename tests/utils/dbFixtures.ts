/**
 * Pawtropolis Tech -- tests/utils/dbFixtures.ts
 * WHAT: Database fixture utilities for creating isolated test databases.
 * WHY: Tests need fresh database state without affecting production data.
 * USAGE:
 *  import { createTestDb, seedTestGuild, cleanupTestData } from "../utils/dbFixtures.js";
 *  const testDb = createTestDb();
 *  seedTestGuild(testDb, "guild-123");
 *
 * PATTERN: Each test file creates its own isolated temp database. This prevents
 * test interference and allows parallel test execution.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Database from "better-sqlite3";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ===== Type Definitions =====

export interface TestDbContext {
  db: Database.Database;
  tempDir: string;
  cleanup: () => void;
}

export interface GuildConfigFixture {
  guild_id: string;
  review_channel_id?: string | null;
  gate_channel_id?: string | null;
  general_channel_id?: string | null;
  unverified_channel_id?: string | null;
  accepted_role_id?: string | null;
  reviewer_role_id?: string | null;
  mod_role_ids?: string | null;
  welcome_template?: string | null;
}

export interface ApplicationFixture {
  id: string;
  guild_id: string;
  user_id: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "kicked" | "needs_info";
  submitted_at?: string;
  resolved_at?: string | null;
  resolver_id?: string | null;
  resolution_reason?: string | null;
  permanently_rejected?: number;
}

export interface ReviewClaimFixture {
  app_id: string;
  reviewer_id: string;
  claimed_at?: string;
}

export interface ReviewActionFixture {
  app_id: string;
  moderator_id: string;
  action: "approve" | "reject" | "perm_reject" | "kick" | "claim" | "unclaim";
  created_at?: string;
  reason?: string | null;
  meta?: string | null;
}

// ===== Database Schema =====

/**
 * Minimal schema for testing. This mirrors the production schema but only
 * includes tables needed for tests.
 */
const TEST_SCHEMA = `
  -- Guild configuration
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    review_channel_id TEXT,
    gate_channel_id TEXT,
    general_channel_id TEXT,
    unverified_channel_id TEXT,
    accepted_role_id TEXT,
    reviewer_role_id TEXT,
    mod_role_ids TEXT,
    gatekeeper_role_id TEXT,
    modmail_log_channel_id TEXT,
    modmail_delete_on_close INTEGER DEFAULT 1,
    welcome_template TEXT,
    info_channel_id TEXT,
    rules_channel_id TEXT,
    welcome_ping_role_id TEXT,
    review_roles_mode TEXT,
    dadmode_enabled INTEGER DEFAULT 0,
    dadmode_odds INTEGER DEFAULT 1000,
    listopen_public_output INTEGER DEFAULT 1,
    leadership_role_id TEXT,
    ping_dev_on_app INTEGER DEFAULT 0,
    image_search_url_template TEXT DEFAULT 'https://lens.google.com/uploadbyurl?url={avatarUrl}',
    reapply_cooldown_hours INTEGER DEFAULT 24,
    min_account_age_hours INTEGER DEFAULT 0,
    min_join_age_hours INTEGER DEFAULT 0,
    avatar_scan_enabled INTEGER DEFAULT 1,
    avatar_scan_nsfw_threshold REAL DEFAULT 0.60,
    avatar_scan_skin_edge_threshold REAL DEFAULT 0.18,
    avatar_scan_weight_model REAL DEFAULT 0.7,
    avatar_scan_weight_edge REAL DEFAULT 0.3,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Applications
  CREATE TABLE IF NOT EXISTS application (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    submitted_at TEXT,
    resolved_at TEXT,
    resolver_id TEXT,
    resolution_reason TEXT,
    permanently_rejected INTEGER DEFAULT 0,
    permanent_reject_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_application_guild_user ON application(guild_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_application_status ON application(status);

  -- Application responses (answers to gate questions)
  CREATE TABLE IF NOT EXISTS application_response (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id TEXT NOT NULL,
    q_index INTEGER NOT NULL,
    answer TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (app_id) REFERENCES application(id)
  );

  -- Review claims (mod claiming an app for review)
  CREATE TABLE IF NOT EXISTS review_claim (
    app_id TEXT PRIMARY KEY,
    reviewer_id TEXT NOT NULL,
    claimed_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (app_id) REFERENCES application(id)
  );

  -- Review actions (audit log)
  CREATE TABLE IF NOT EXISTS review_action (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    reason TEXT,
    meta TEXT,
    FOREIGN KEY (app_id) REFERENCES application(id)
  );

  -- Review card tracking (message IDs for updating cards)
  CREATE TABLE IF NOT EXISTS review_card (
    app_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (app_id) REFERENCES application(id)
  );

  -- Guild questions (gate application questions)
  CREATE TABLE IF NOT EXISTS guild_question (
    guild_id TEXT NOT NULL,
    q_index INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    required INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (guild_id, q_index)
  );

  -- Modmail bridge (linking modmail threads to applications)
  CREATE TABLE IF NOT EXISTS modmail_bridge (
    app_id TEXT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    thread_id TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now')),
    closed_at TEXT,
    FOREIGN KEY (app_id) REFERENCES application(id)
  );

  -- Avatar scan results
  CREATE TABLE IF NOT EXISTS avatar_scan (
    app_id TEXT PRIMARY KEY,
    nsfw_score REAL,
    skin_edge_score REAL,
    flagged INTEGER DEFAULT 0,
    scanned_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (app_id) REFERENCES application(id)
  );
`;

// ===== Database Factory =====

/**
 * Creates an isolated test database in a temporary directory.
 *
 * @returns TestDbContext with database, temp directory path, and cleanup function
 *
 * @example
 * let testCtx: TestDbContext;
 * beforeAll(() => { testCtx = createTestDb(); });
 * afterAll(() => { testCtx.cleanup(); });
 */
export function createTestDb(): TestDbContext {
  const tempDir = mkdtempSync(join(tmpdir(), "pawtropolis-test-"));
  const dbPath = join(tempDir, "test.db");
  const db = new Database(dbPath);

  // Enable foreign keys for referential integrity
  db.pragma("foreign_keys = ON");

  // Create schema
  db.exec(TEST_SCHEMA);

  return {
    db,
    tempDir,
    cleanup: () => {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

// ===== Seeding Functions =====

/**
 * Seeds a guild configuration for testing.
 */
export function seedTestGuild(
  db: Database.Database,
  guildId: string,
  config: Partial<GuildConfigFixture> = {}
): GuildConfigFixture {
  const fixture: GuildConfigFixture = {
    guild_id: guildId,
    review_channel_id: config.review_channel_id ?? "review-channel-123",
    gate_channel_id: config.gate_channel_id ?? "gate-channel-123",
    general_channel_id: config.general_channel_id ?? "general-channel-123",
    unverified_channel_id: config.unverified_channel_id ?? null,
    accepted_role_id: config.accepted_role_id ?? "accepted-role-123",
    reviewer_role_id: config.reviewer_role_id ?? null,
    mod_role_ids: config.mod_role_ids ?? null,
    welcome_template: config.welcome_template ?? null,
  };

  db.prepare(`
    INSERT OR REPLACE INTO guild_config (
      guild_id, review_channel_id, gate_channel_id, general_channel_id,
      unverified_channel_id, accepted_role_id, reviewer_role_id, mod_role_ids,
      welcome_template
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fixture.guild_id,
    fixture.review_channel_id,
    fixture.gate_channel_id,
    fixture.general_channel_id,
    fixture.unverified_channel_id,
    fixture.accepted_role_id,
    fixture.reviewer_role_id,
    fixture.mod_role_ids,
    fixture.welcome_template
  );

  return fixture;
}

/**
 * Seeds an application for testing.
 */
export function seedTestApplication(
  db: Database.Database,
  data: Partial<ApplicationFixture> & { id: string; guild_id: string; user_id: string }
): ApplicationFixture {
  const fixture: ApplicationFixture = {
    id: data.id,
    guild_id: data.guild_id,
    user_id: data.user_id,
    status: data.status ?? "submitted",
    submitted_at: data.submitted_at ?? new Date().toISOString(),
    resolved_at: data.resolved_at ?? null,
    resolver_id: data.resolver_id ?? null,
    resolution_reason: data.resolution_reason ?? null,
    permanently_rejected: data.permanently_rejected ?? 0,
  };

  db.prepare(`
    INSERT INTO application (
      id, guild_id, user_id, status, submitted_at, resolved_at,
      resolver_id, resolution_reason, permanently_rejected
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fixture.id,
    fixture.guild_id,
    fixture.user_id,
    fixture.status,
    fixture.submitted_at,
    fixture.resolved_at,
    fixture.resolver_id,
    fixture.resolution_reason,
    fixture.permanently_rejected
  );

  return fixture;
}

/**
 * Seeds a review claim for testing.
 */
export function seedTestClaim(
  db: Database.Database,
  data: ReviewClaimFixture
): ReviewClaimFixture {
  const fixture: ReviewClaimFixture = {
    app_id: data.app_id,
    reviewer_id: data.reviewer_id,
    claimed_at: data.claimed_at ?? new Date().toISOString(),
  };

  db.prepare(`
    INSERT OR REPLACE INTO review_claim (app_id, reviewer_id, claimed_at)
    VALUES (?, ?, ?)
  `).run(fixture.app_id, fixture.reviewer_id, fixture.claimed_at);

  return fixture;
}

/**
 * Seeds a review action for testing.
 */
export function seedTestReviewAction(
  db: Database.Database,
  data: ReviewActionFixture
): ReviewActionFixture & { id: number } {
  const fixture: ReviewActionFixture = {
    app_id: data.app_id,
    moderator_id: data.moderator_id,
    action: data.action,
    created_at: data.created_at ?? new Date().toISOString(),
    reason: data.reason ?? null,
    meta: data.meta ?? null,
  };

  const result = db.prepare(`
    INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, meta)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    fixture.app_id,
    fixture.moderator_id,
    fixture.action,
    fixture.created_at,
    fixture.reason,
    fixture.meta
  );

  return { ...fixture, id: Number(result.lastInsertRowid) };
}

/**
 * Seeds gate questions for a guild.
 */
export function seedTestQuestions(
  db: Database.Database,
  guildId: string,
  questions: string[]
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO guild_question (guild_id, q_index, prompt, required)
    VALUES (?, ?, ?, 1)
  `);

  questions.forEach((prompt, index) => {
    stmt.run(guildId, index, prompt);
  });
}

// ===== Cleanup Functions =====

/**
 * Removes all test data for a specific guild.
 */
export function cleanupTestData(db: Database.Database, guildId: string): void {
  // Delete in order respecting foreign keys
  db.prepare("DELETE FROM review_action WHERE app_id IN (SELECT id FROM application WHERE guild_id = ?)").run(guildId);
  db.prepare("DELETE FROM review_claim WHERE app_id IN (SELECT id FROM application WHERE guild_id = ?)").run(guildId);
  db.prepare("DELETE FROM review_card WHERE app_id IN (SELECT id FROM application WHERE guild_id = ?)").run(guildId);
  db.prepare("DELETE FROM avatar_scan WHERE app_id IN (SELECT id FROM application WHERE guild_id = ?)").run(guildId);
  db.prepare("DELETE FROM application_response WHERE app_id IN (SELECT id FROM application WHERE guild_id = ?)").run(guildId);
  db.prepare("DELETE FROM modmail_bridge WHERE guild_id = ?").run(guildId);
  db.prepare("DELETE FROM application WHERE guild_id = ?").run(guildId);
  db.prepare("DELETE FROM guild_question WHERE guild_id = ?").run(guildId);
  db.prepare("DELETE FROM guild_config WHERE guild_id = ?").run(guildId);
}

/**
 * Clears all data from all tables (for complete test isolation).
 */
export function clearAllTables(db: Database.Database): void {
  db.prepare("DELETE FROM review_action").run();
  db.prepare("DELETE FROM review_claim").run();
  db.prepare("DELETE FROM review_card").run();
  db.prepare("DELETE FROM avatar_scan").run();
  db.prepare("DELETE FROM application_response").run();
  db.prepare("DELETE FROM modmail_bridge").run();
  db.prepare("DELETE FROM application").run();
  db.prepare("DELETE FROM guild_question").run();
  db.prepare("DELETE FROM guild_config").run();
}

// ===== Query Helpers =====

/**
 * Gets an application by ID from the test database.
 */
export function getApplication(db: Database.Database, appId: string): ApplicationFixture | undefined {
  return db.prepare("SELECT * FROM application WHERE id = ?").get(appId) as ApplicationFixture | undefined;
}

/**
 * Gets a claim by app ID from the test database.
 */
export function getClaim(db: Database.Database, appId: string): ReviewClaimFixture | undefined {
  return db.prepare("SELECT * FROM review_claim WHERE app_id = ?").get(appId) as ReviewClaimFixture | undefined;
}

/**
 * Gets guild config from the test database.
 */
export function getGuildConfig(db: Database.Database, guildId: string): GuildConfigFixture | undefined {
  return db.prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId) as GuildConfigFixture | undefined;
}

/**
 * Counts review actions for an application.
 */
export function countReviewActions(db: Database.Database, appId: string): number {
  const result = db.prepare("SELECT COUNT(*) as count FROM review_action WHERE app_id = ?").get(appId) as { count: number };
  return result.count;
}
