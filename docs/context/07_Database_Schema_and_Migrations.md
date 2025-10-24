# 07 — Database Schema and Migrations

**Last Updated:** 2025-10-22
**Status:** Production schema (migrations 001 + 002)

## Summary

- **Database:** SQLite 3 via `better-sqlite3` (synchronous, embedded)
- **Location:** `data/data.db` (configurable via `DB_PATH` env var)
- **Migrations:** TypeScript-based sequential migrations in `src/db/migrations/`
- **Schema:** 5 core tables (applications, action_log, guild_config, mod_metrics, open_modmail)
- **Indexes:** Optimized for dashboard queries and leaderboards

---

## Table of Contents

- [Migration System](#migration-system)
- [Core Tables](#core-tables)
- [Guild Config Table](#guild-config-table)
- [Mod Metrics Table](#mod-metrics-table)
- [Query Examples](#query-examples)
- [Data Reset Pathway](#data-reset-pathway)

---

## Migration System

### Architecture

**Runner:** `src/db/ensure.ts` (executed on bot startup)
**Location:** `src/db/migrations/*.ts`
**Tracking:** Not yet implemented (roadmap: migrations table)

### Migration Files

```
src/db/migrations/
├── 001_base.ts              # Core tables (applications, action_log, guild_config, etc.)
└── 002_mod_metrics.ts       # Mod performance tracking table
```

### Migration 001: Base Schema

**Purpose:** Core application review, logging, and config tables
**File:** `src/db/migrations/001_base.ts`

**Tables Created:**

- `applications` — Verification application storage
- `action_log` — Audit trail for all moderation actions
- `guild_config` — Per-guild configuration (logging channel, welcome template, mod roles)
- `avatar_scans` — Avatar risk scoring cache
- `open_modmail` — Active modmail ticket tracking

**Critical Fix (PR4):**

- Changed `updated_at` column from `INTEGER` to `TEXT` for ISO timestamp consistency
- Removed `updated_at_s` (integer seconds) column (unused, created confusion)
- Schema now uses: `updated_at TEXT` for ISO 8601 timestamps, `created_at INTEGER` for Unix epoch

### Migration 002: Mod Metrics

**Purpose:** Performance tracking for moderator leaderboards and analytics
**File:** `src/db/migrations/002_mod_metrics.ts`

**Table Created:**

- `mod_metrics` — Aggregated moderator statistics with response time percentiles

**Indexes:**

- `idx_mod_metrics_guild_accepts` — Optimizes leaderboard queries (ORDER BY total_accepts DESC)

---

## Core Tables

### `applications`

**Purpose:** Stores all verification applications (pending, claimed, approved, rejected)

```sql
CREATE TABLE applications (
  application_id TEXT PRIMARY KEY,        -- ULID
  applicant_id TEXT NOT NULL,             -- Discord user ID
  guild_id TEXT NOT NULL,                 -- Discord guild ID
  status TEXT NOT NULL,                   -- pending, claimed, approved, rejected, perm_rejected
  claimed_by_moderator TEXT,              -- Moderator user ID (null if pending)
  claimed_at INTEGER,                     -- Unix timestamp (null if pending)
  answer_data TEXT,                       -- JSON blob with Q&A
  submitted_at INTEGER NOT NULL,          -- Unix timestamp
  decided_at INTEGER,                     -- Unix timestamp (null if pending/claimed)
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Indexes
CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_guild_status ON applications(guild_id, status);
CREATE INDEX idx_applications_claimed_by ON applications(claimed_by_moderator);
```

**Status Flow:**

```
pending → claimed → (approved | rejected | perm_rejected)
   ↓         ↓
   └─────────┴─> can unclaim → back to pending
```

**Example Row:**

```json
{
  "application_id": "01HQXY9Z8KTMQ5Z5Z5Z5Z5Z5Z5",
  "applicant_id": "123456789012345678",
  "guild_id": "896070888594759740",
  "status": "approved",
  "claimed_by_moderator": "234567890123456789",
  "claimed_at": 1729565100,
  "answer_data": "{\"q1\":\"Interested in furry art...\",\"q2\":\"Reddit\",\"q3\":\"Yes\",\"q4\":\"Art, gaming\",\"q5\":\"They/them\"}",
  "submitted_at": 1729565000,
  "decided_at": 1729565400,
  "created_at": 1729565000,
  "updated_at": 1729565400
}
```

---

### `action_log`

**Purpose:** Comprehensive audit trail for all moderation actions

```sql
CREATE TABLE action_log (
  action_id TEXT PRIMARY KEY,             -- ULID
  guild_id TEXT NOT NULL,                 -- Discord guild ID
  action TEXT NOT NULL,                   -- app_submitted, claim, approve, reject, kick, modmail_open, modmail_close
  moderator_id TEXT,                      -- Discord user ID (null for user-initiated actions like app_submitted)
  target_user_id TEXT,                    -- Applicant or modmail user ID
  reason TEXT,                            -- Optional for approve, required for reject/kick
  timestamp INTEGER NOT NULL,             -- Unix timestamp
  created_at INTEGER DEFAULT (unixepoch())
);

-- Indexes
CREATE INDEX idx_action_log_guild_action ON action_log(guild_id, action);
CREATE INDEX idx_action_log_moderator ON action_log(moderator_id);
CREATE INDEX idx_action_log_timestamp ON action_log(timestamp);
```

**Action Types:**

- `app_submitted` — User completed verification modal
- `claim` — Moderator claimed application for review
- `approve` — Moderator approved application
- `reject` — Moderator rejected application (soft, can reapply)
- `kick` — Moderator rejected + kicked (hard rejection)
- `perm_reject` — Permanent rejection (alias for kick)
- `modmail_open` — Modmail ticket opened
- `modmail_close` — Modmail ticket closed

**Example Row:**

```json
{
  "action_id": "01HQXY9Z8KTMQ5Z5Z5Z5Z5Z5Z6",
  "guild_id": "896070888594759740",
  "action": "approve",
  "moderator_id": "234567890123456789",
  "target_user_id": "123456789012345678",
  "reason": "Great answers, account looks legitimate",
  "timestamp": 1729565400,
  "created_at": 1729565400
}
```

---

## Guild Config Table

### `guild_config`

**Purpose:** Per-guild configuration storage (logging channel, welcome template, mod roles)

```sql
CREATE TABLE guild_config (
  guild_id TEXT PRIMARY KEY,              -- Discord guild ID
  logging_channel_id TEXT,                -- Override default logging channel (null = use ENV)
  welcome_template TEXT,                  -- Markdown template for welcome message
  mod_role_ids TEXT,                      -- Comma-separated role IDs for moderator permissions
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at TEXT DEFAULT (datetime('now')) -- ISO 8601 timestamp (TEXT, not INTEGER)
);
```

**Critical Note (PR4 Fix):**

- `updated_at` is TEXT (ISO 8601 format: `2025-10-22T03:45:15.123Z`)
- Previous versions incorrectly used `updated_at_s INTEGER` (deprecated, removed in migration)
- `created_at` remains INTEGER (Unix epoch) for historical queries

**Template Variables (welcome_template):**

```
{applicant.mention}      → <@123456789012345678>
{applicant.username}     → Alice
{applicant.tag}          → Alice#1234
{guild.name}             → Pawtropolis
{guild.memberCount}      → 1,247
{timestamp}              → 2025-10-22 03:30:15 UTC
```

**Example Row:**

```json
{
  "guild_id": "896070888594759740",
  "logging_channel_id": "1430015254053654599",
  "welcome_template": "Welcome {applicant.mention} to **{guild.name}**! 🎉\n\nYou are member #{guild.memberCount}.",
  "mod_role_ids": "987662057069482024,896070888762535975,896070888762535966",
  "created_at": 1729565000,
  "updated_at": "2025-10-22T03:45:15.123Z"
}
```

**Upsert Pattern:**

```javascript
function upsertConfig(guildId: string, updates: Partial<GuildConfig>) {
  db.prepare(`
    INSERT INTO guild_config (guild_id, logging_channel_id, welcome_template, mod_role_ids, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(guild_id) DO UPDATE SET
      logging_channel_id = COALESCE(excluded.logging_channel_id, logging_channel_id),
      welcome_template = COALESCE(excluded.welcome_template, welcome_template),
      mod_role_ids = COALESCE(excluded.mod_role_ids, mod_role_ids),
      updated_at = datetime('now')
  `).run(guildId, updates.logging_channel_id, updates.welcome_template, updates.mod_role_ids);
}
```

---

## Mod Metrics Table

### `mod_metrics`

**Purpose:** Aggregated moderator performance statistics (PR5)

```sql
CREATE TABLE mod_metrics (
  moderator_id TEXT NOT NULL,             -- Discord user ID
  guild_id TEXT NOT NULL,                 -- Discord guild ID
  total_claims INTEGER DEFAULT 0,         -- Count of claim actions
  total_accepts INTEGER DEFAULT 0,        -- Count of approve actions
  total_rejects INTEGER DEFAULT 0,        -- Count of reject actions
  total_kicks INTEGER DEFAULT 0,          -- Count of kick actions
  modmail_opens INTEGER DEFAULT 0,        -- Count of modmail_open actions
  response_time_p50_ms INTEGER,           -- Median response time (milliseconds)
  response_time_p95_ms INTEGER,           -- 95th percentile response time (milliseconds)
  updated_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (moderator_id, guild_id)    -- Composite key
);

-- Indexes
CREATE INDEX idx_mod_metrics_guild_accepts
  ON mod_metrics(guild_id, total_accepts DESC);
```

**Composite Primary Key:**

- Ensures one row per (moderator, guild) pair
- Enables upsert pattern for metrics updates

**Computed Columns:**

- `total_claims`, `total_accepts`, etc. → Counted from `action_log`
- `response_time_p50_ms`, `response_time_p95_ms` → Calculated using nearest-rank algorithm

**Example Row:**

```json
{
  "moderator_id": "234567890123456789",
  "guild_id": "896070888594759740",
  "total_claims": 150,
  "total_accepts": 127,
  "total_rejects": 18,
  "total_kicks": 5,
  "modmail_opens": 42,
  "response_time_p50_ms": 480000,
  "response_time_p95_ms": 2700000,
  "updated_at": 1729565400
}
```

**Refresh Frequency:**

- Automated: Every 15 minutes via scheduler
- Manual: `/resetdata` command triggers immediate recalculation

---

## Query Examples

### Leaderboard (Top 10 Moderators)

```sql
SELECT
  m.moderator_id,
  m.total_accepts,
  m.total_rejects,
  m.total_kicks,
  m.response_time_p50_ms,
  m.response_time_p95_ms
FROM mod_metrics m
WHERE m.guild_id = ?
ORDER BY m.total_accepts DESC
LIMIT 10;
```

### Response Time Summary

```sql
SELECT
  AVG(response_time_p50_ms) AS avg_p50,
  AVG(response_time_p95_ms) AS avg_p95,
  MIN(response_time_p50_ms) AS min_p50,
  MAX(response_time_p95_ms) AS max_p95
FROM mod_metrics
WHERE guild_id = ?;
```

### Action Timeline (30 days)

```sql
SELECT
  DATE(timestamp, 'unixepoch') AS date,
  action,
  COUNT(*) AS count
FROM action_log
WHERE guild_id = ?
  AND timestamp >= unixepoch() - 2592000  -- 30 days
GROUP BY date, action
ORDER BY date ASC, action;
```

### Join→Submit Ratio

```sql
-- Application submissions
SELECT COUNT(*) AS submits
FROM action_log
WHERE guild_id = ?
  AND action = 'app_submitted'
  AND timestamp >= unixepoch() - 2592000;

-- Server joins (requires separate tracking)
-- Ratio = (submits / joins) * 100
```

### Pending Applications

```sql
SELECT
  application_id,
  applicant_id,
  submitted_at,
  (unixepoch() - submitted_at) AS wait_time_seconds
FROM applications
WHERE guild_id = ?
  AND status = 'pending'
ORDER BY submitted_at ASC;
```

---

## Data Reset Pathway

### `/resetdata` Command

**Purpose:** Clear analytics data and reset metrics epoch (for testing or privacy)

**Flow:**

```sql
-- 1. Clear mod_metrics table
DELETE FROM mod_metrics WHERE guild_id = ?;

-- 2. Clear action_log (optional, preserves audit trail by default)
-- DELETE FROM action_log WHERE guild_id = ?;

-- 3. Clear metrics cache (in-memory)
metricsCache.clear();

-- 4. Update epoch timestamp
UPDATE guild_config
SET metrics_epoch = unixepoch()
WHERE guild_id = ?;

-- 5. Trigger immediate recalculation
await recalcModMetrics(guildId);
```

**What's Preserved:**

- `applications` table (application history)
- `action_log` table (audit trail)
- `guild_config` table (settings)

**What's Cleared:**

- `mod_metrics` table (all moderator statistics)
- In-memory metrics cache

**Use Cases:**

- Testing metrics engine with fresh data
- Privacy request (GDPR data deletion)
- Migrating between seasons/epochs (quarterly resets)

---

## Changelog

**Since last revision:**

- Corrected `guild_config.updated_at` schema (TEXT ISO 8601, not INTEGER)
- Removed deprecated `updated_at_s` column references
- Added PR5 `mod_metrics` table schema with composite PK
- Documented indexes for leaderboard optimization
- Added query examples for dashboard and analytics
- Included data reset pathway for `/resetdata` command
- Clarified migration 001 vs 002 responsibilities
- Added template variable documentation for welcome messages
- Documented upsert pattern for guild config updates
