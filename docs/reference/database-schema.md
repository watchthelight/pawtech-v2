# Database Schema and Migrations

## Current Schema (Authoritative)

The bot uses SQLite 3.x via better-sqlite3, stored at `./data/data.db`. All tables use `TEXT` for timestamps (ISO 8601 format) and Discord IDs (snowflakes).

### `configs` Table

```sql
CREATE TABLE configs (
  guild_id TEXT PRIMARY KEY,

  -- Channel IDs
  review_channel_id TEXT,
  modmail_channel_id TEXT,
  -- [MISSING] logging_channel_id TEXT,  ⚠️ Column not yet added

  -- Role IDs
  member_role_id TEXT,
  moderator_role_id TEXT,

  -- Templates
  acceptance_message TEXT,
  rejection_message TEXT,

  -- Toggles (0 or 1)
  auto_kick_rejected INTEGER DEFAULT 0,
  require_claim INTEGER DEFAULT 1,

  -- Metadata
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- No indexes needed (single row per guild)
```

**Known Issue**: `logging_channel_id` column missing. `/config set logging` fails with:

```
SqliteError: no such column: configs.logging_channel_id
```

### `review_action` Table

```sql
CREATE TABLE review_action (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- User data
  user_id TEXT NOT NULL UNIQUE,        -- One application per user
  display_name TEXT NOT NULL,
  age INTEGER NOT NULL,
  reason TEXT NOT NULL,
  referral TEXT,

  -- Review state
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'accepted' | 'rejected'
  claimed_by TEXT,                         -- Moderator Discord ID (nullable)
  claimed_at TEXT,
  decided_at TEXT,

  -- Metadata
  submitted_at TEXT NOT NULL,
  review_message_id TEXT,                  -- Discord message ID of review card

  -- [DEPRECATED] review_action TEXT,      -- Old enum column; migrating to reason

  CHECK (status IN ('pending', 'accepted', 'rejected'))
);

CREATE INDEX idx_review_action_status ON review_action(status);
CREATE INDEX idx_review_action_claimed_by ON review_action(claimed_by);
CREATE INDEX idx_review_action_submitted_at ON review_action(submitted_at);
CREATE INDEX idx_review_action_user_id ON review_action(user_id);
```

**Migration Issue**: Attempt to rename `review_action` column blocked by legacy SQL guard (see below).

### `action_log` Table

```sql
CREATE TABLE action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Foreign keys (nullable; one must be set)
  app_id INTEGER,                      -- FK to review_action.id
  thread_id TEXT,                      -- FK to open_modmail.thread_id

  -- Action data
  moderator_id TEXT NOT NULL,          -- Discord user ID ('0' for system)
  action TEXT NOT NULL,                -- 'claim', 'accept', 'reject', 'modmail_close', etc.
  reason TEXT,                         -- Free-text reason (nullable)
  metadata TEXT,                       -- JSON blob for extra data (nullable)

  -- Metadata
  timestamp TEXT NOT NULL,

  FOREIGN KEY (app_id) REFERENCES review_action(id) ON DELETE CASCADE,

  CHECK (action IN ('submit', 'claim', 'unclaim', 'accept', 'reject', 'kick',
                    'modmail_open', 'modmail_close', 'modmail_reopen', 'config_change'))
);

CREATE INDEX idx_action_log_app_id ON action_log(app_id);
CREATE INDEX idx_action_log_thread_id ON action_log(thread_id);
CREATE INDEX idx_action_log_moderator_id ON action_log(moderator_id);
CREATE INDEX idx_action_log_timestamp ON action_log(timestamp);
CREATE INDEX idx_action_log_action ON action_log(action);
```

### `open_modmail` Table

```sql
CREATE TABLE open_modmail (
  thread_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'closed'

  -- Optional FK to link modmail to application
  related_app_id INTEGER,

  -- Lifecycle timestamps
  created_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by TEXT,                      -- Moderator ID or '0' for auto-close
  reopened_at TEXT,

  -- Transcript storage (optional)
  transcript TEXT,

  FOREIGN KEY (related_app_id) REFERENCES review_action(id) ON DELETE SET NULL,

  CHECK (status IN ('open', 'closed'))
);

CREATE INDEX idx_open_modmail_user_id ON open_modmail(user_id);
CREATE INDEX idx_open_modmail_status ON open_modmail(status);
CREATE INDEX idx_open_modmail_created_at ON open_modmail(created_at);
```

### `user_activity` Table

```sql
CREATE TABLE user_activity (
  guild_id           TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  joined_at          INTEGER NOT NULL,         -- Unix timestamp (seconds)
  first_message_at   INTEGER,                  -- Unix timestamp (seconds), nullable
  flagged_at         INTEGER,                  -- Unix timestamp (seconds), nullable
  flagged_reason     TEXT,                     -- Manual or auto flag reason (512 chars max)
  manual_flag        INTEGER DEFAULT 0,        -- 0=auto-flagged, 1=manual flag via /flag
  flagged_by         TEXT,                     -- Moderator user ID who flagged (nullable)
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX idx_user_activity_guild_user ON user_activity(guild_id, user_id);
```

**Purpose**: Tracks user join timestamps, first message timestamps, and flag status for bot detection (Silent-Since-Join and manual `/flag` command).

**Flag Workflow**:
1. User joins → `joined_at` recorded
2. User sends first message → `first_message_at` recorded
3. Auto-flagger detects silent user → `flagged_at` set, `manual_flag=0`
4. OR: Moderator runs `/flag` → `flagged_at` set, `manual_flag=1`, `flagged_by` set, `flagged_reason` stored

## Example DDL (Complete Schema)

**Full database initialization** (`scripts/init_db.sql`):

```sql
-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- Set WAL mode for concurrent reads
PRAGMA journal_mode = WAL;

-- Configs table
CREATE TABLE IF NOT EXISTS configs (
  guild_id TEXT PRIMARY KEY,
  review_channel_id TEXT,
  modmail_channel_id TEXT,
  member_role_id TEXT,
  moderator_role_id TEXT,
  acceptance_message TEXT,
  rejection_message TEXT,
  auto_kick_rejected INTEGER DEFAULT 0,
  require_claim INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Review actions table
CREATE TABLE IF NOT EXISTS review_action (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  age INTEGER NOT NULL,
  reason TEXT NOT NULL,
  referral TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  claimed_by TEXT,
  claimed_at TEXT,
  decided_at TEXT,
  submitted_at TEXT NOT NULL,
  review_message_id TEXT,
  CHECK (status IN ('pending', 'accepted', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_review_action_status ON review_action(status);
CREATE INDEX IF NOT EXISTS idx_review_action_claimed_by ON review_action(claimed_by);
CREATE INDEX IF NOT EXISTS idx_review_action_submitted_at ON review_action(submitted_at);
CREATE INDEX IF NOT EXISTS idx_review_action_user_id ON review_action(user_id);

-- Action log table
CREATE TABLE IF NOT EXISTS action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER,
  thread_id TEXT,
  moderator_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  metadata TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (app_id) REFERENCES review_action(id) ON DELETE CASCADE,
  CHECK (action IN ('submit', 'claim', 'unclaim', 'accept', 'reject', 'kick',
                    'modmail_open', 'modmail_close', 'modmail_reopen', 'config_change'))
);

CREATE INDEX IF NOT EXISTS idx_action_log_app_id ON action_log(app_id);
CREATE INDEX IF NOT EXISTS idx_action_log_thread_id ON action_log(thread_id);
CREATE INDEX IF NOT EXISTS idx_action_log_moderator_id ON action_log(moderator_id);
CREATE INDEX IF NOT EXISTS idx_action_log_timestamp ON action_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_action_log_action ON action_log(action);

-- Modmail table
CREATE TABLE IF NOT EXISTS open_modmail (
  thread_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  related_app_id INTEGER,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by TEXT,
  reopened_at TEXT,
  transcript TEXT,
  FOREIGN KEY (related_app_id) REFERENCES review_action(id) ON DELETE SET NULL,
  CHECK (status IN ('open', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_open_modmail_user_id ON open_modmail(user_id);
CREATE INDEX IF NOT EXISTS idx_open_modmail_status ON open_modmail(status);
CREATE INDEX IF NOT EXISTS idx_open_modmail_created_at ON open_modmail(created_at);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

## Migration Plan: Add `logging_channel_id`

### Migration 001: Add Logging Channel Column

**File**: `migrations/001_add_logging_channel_id.ts`

```typescript
import Database from "better-sqlite3";

export function up(db: Database.Database): void {
  console.log("Running migration 001: Add logging_channel_id to configs");

  // Step 1: Add column
  db.prepare("ALTER TABLE configs ADD COLUMN logging_channel_id TEXT").run();

  // Step 2: Backfill with environment variable (if set)
  const envChannel = process.env.LOGGING_CHANNEL;
  if (envChannel) {
    const result = db
      .prepare(
        `
      UPDATE configs
      SET logging_channel_id = ?
      WHERE logging_channel_id IS NULL
    `
      )
      .run(envChannel);

    console.log(`Backfilled ${result.changes} rows with LOGGING_CHANNEL=${envChannel}`);
  }

  // Step 3: Record migration
  db.prepare(
    `
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES (1, 'add_logging_channel_id', ?)
  `
  ).run(new Date().toISOString());

  console.log("Migration 001 complete.");
}

export function down(db: Database.Database): void {
  console.warn("Rollback not supported: SQLite cannot drop columns.");
  console.warn("To revert, restore database from backup.");
}
```

**Run Migration**:

```bash
npm run migrate  # tsx scripts/migrate.ts
```

**Migration Runner** (`scripts/migrate.ts`):

```typescript
import Database from "better-sqlite3";
import { up as migration001 } from "../migrations/001_add_logging_channel_id.js";

const db = new Database("./data/data.db");

// Check current version
const currentVersion = db.prepare("SELECT MAX(version) as v FROM schema_migrations").get()?.v || 0;

console.log(`Current schema version: ${currentVersion}`);

// Apply pending migrations
const migrations = [{ version: 1, up: migration001 }];

for (const migration of migrations) {
  if (migration.version > currentVersion) {
    console.log(`Applying migration ${migration.version}...`);
    migration.up(db);
  }
}

console.log("All migrations applied.");
db.close();
```

## Blocked Migration: `review_action` Column Rename

### Problem

Attempting to rename deprecated `review_action` column to `reason` fails with:

```
Error: Legacy SQL detected in prepare(): ALTER TABLE review_action RENAME TO review_action_old;
better-sqlite3 blocks this statement to prevent data loss.
```

**Root Cause**: better-sqlite3 blocks `ALTER TABLE ... RENAME TO` (table rename) to protect against accidental data loss in complex schemas.

### Safe Migration Strategy: Create-Copy-Swap

**Migration 002**: Replace table with clean schema.

```typescript
import Database from "better-sqlite3";

export function up(db: Database.Database): void {
  console.log("Running migration 002: Rename review_action column to reason");

  // Step 1: Disable foreign keys temporarily
  db.prepare("PRAGMA foreign_keys = OFF").run();

  // Step 2: Create new table with clean schema
  db.prepare(
    `
    CREATE TABLE review_action_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      age INTEGER NOT NULL,
      reason TEXT NOT NULL,
      referral TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      claimed_by TEXT,
      claimed_at TEXT,
      decided_at TEXT,
      submitted_at TEXT NOT NULL,
      review_message_id TEXT,
      CHECK (status IN ('pending', 'accepted', 'rejected'))
    )
  `
  ).run();

  // Step 3: Copy data (migrate old review_action column to reason)
  db.prepare(
    `
    INSERT INTO review_action_new (
      id, user_id, display_name, age, reason, referral,
      status, claimed_by, claimed_at, decided_at, submitted_at, review_message_id
    )
    SELECT
      id, user_id, display_name, age,
      COALESCE(reason, review_action, 'No reason provided') as reason,  -- Merge columns
      referral, status, claimed_by, claimed_at, decided_at,
      submitted_at, review_message_id
    FROM review_action
  `
  ).run();

  // Step 4: Recreate indexes on new table
  db.prepare("CREATE INDEX idx_review_action_status ON review_action_new(status)").run();
  db.prepare("CREATE INDEX idx_review_action_claimed_by ON review_action_new(claimed_by)").run();
  db.prepare(
    "CREATE INDEX idx_review_action_submitted_at ON review_action_new(submitted_at)"
  ).run();
  db.prepare("CREATE INDEX idx_review_action_user_id ON review_action_new(user_id)").run();

  // Step 5: Swap tables (drop old, rename new)
  db.prepare("DROP TABLE review_action").run();
  db.prepare("ALTER TABLE review_action_new RENAME TO review_action").run();

  // Step 6: Re-enable foreign keys
  db.prepare("PRAGMA foreign_keys = ON").run();

  // Step 7: Verify foreign key integrity
  const fkCheck = db.prepare("PRAGMA foreign_key_check(action_log)").all();
  if (fkCheck.length > 0) {
    console.error("Foreign key violations detected:", fkCheck);
    throw new Error("Migration failed: foreign key integrity check failed");
  }

  // Step 8: Record migration
  db.prepare(
    `
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES (2, 'rename_review_action_to_reason', ?)
  `
  ).run(new Date().toISOString());

  console.log("Migration 002 complete.");
}

export function down(db: Database.Database): void {
  console.error("Rollback not implemented for this migration.");
  console.error("Restore from backup taken before migration.");
}
```

**Pre-Migration Checklist**:

1. ✅ Backup database: `cp data.db data.db.backup_$(date +%Y%m%d)`
2. ✅ Test migration in dev environment first
3. ✅ Schedule during low-traffic window (off-hours)
4. ✅ Verify row counts match before/after:
   ```sql
   -- Before migration
   SELECT COUNT(*) FROM review_action;
   -- After migration
   SELECT COUNT(*) FROM review_action; -- Should match
   ```

### Verification Queries

**Check schema**:

```sql
PRAGMA table_info(review_action);
-- Should show: reason | TEXT | 0 | | 0
-- Should NOT show: review_action column
```

**Verify data integrity**:

```sql
-- Check all rows have reason
SELECT COUNT(*) FROM review_action WHERE reason IS NULL;
-- Should return: 0

-- Compare totals
SELECT COUNT(*) FROM review_action;
SELECT COUNT(*) FROM action_log WHERE app_id IS NOT NULL;
-- Counts should be consistent
```

**Check foreign keys**:

```sql
PRAGMA foreign_key_check(action_log);
-- Should return: (empty result)
```

## Data Integrity Rules

### Foreign Key Constraints

| Child Table  | Column         | Parent Table  | Parent Column | On Delete |
| ------------ | -------------- | ------------- | ------------- | --------- |
| action_log   | app_id         | review_action | id            | CASCADE   |
| open_modmail | related_app_id | review_action | id            | SET NULL  |

**Enforcement**:

```sql
PRAGMA foreign_keys = ON;  -- Enable at database connection
```

### Unique Constraints

- `review_action.user_id` (one application per user)
- `configs.guild_id` (one config per guild)
- `open_modmail.thread_id` (one ticket per thread)

### NOT NULL Constraints

- All timestamp fields (`created_at`, `submitted_at`, etc.)
- Core identifiers (`user_id`, `moderator_id`, `action`)
- Required fields (`display_name`, `age`, `reason`)

### Check Constraints

```sql
-- Status enums
CHECK (status IN ('pending', 'accepted', 'rejected'))
CHECK (status IN ('open', 'closed'))

-- Action types
CHECK (action IN ('submit', 'claim', 'unclaim', 'accept', 'reject', 'kick',
                  'modmail_open', 'modmail_close', 'modmail_reopen', 'config_change'))

-- Logical constraints (potential additions)
CHECK (age >= 18)
CHECK (LENGTH(reason) >= 50)
```

## Example Queries for Analytics

### Average Review Time by Moderator

```sql
SELECT
  moderator_id,
  COUNT(*) as total_decisions,
  AVG((julianday(decided_at) - julianday(claimed_at)) * 24) as avg_hours
FROM review_action ra
JOIN action_log al ON ra.id = al.app_id
WHERE ra.decided_at IS NOT NULL
  AND al.action = 'claim'
GROUP BY moderator_id
ORDER BY avg_hours ASC;
```

### Daily Application Volume

```sql
SELECT
  DATE(submitted_at) as date,
  COUNT(*) as total_applications,
  SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
  SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
FROM review_action
WHERE submitted_at > datetime('now', '-30 days')
GROUP BY DATE(submitted_at)
ORDER BY date DESC;
```

### Modmail Response Time

```sql
SELECT
  AVG(julianday(first_staff_message) - julianday(om.created_at)) * 24 as avg_hours
FROM open_modmail om
JOIN (
  SELECT thread_id, MIN(timestamp) as first_staff_message
  FROM action_log
  WHERE action = 'message_sent'
    AND moderator_id != '0'
  GROUP BY thread_id
) al ON om.thread_id = al.thread_id
WHERE om.created_at > datetime('now', '-30 days');
```

### Pending Queue Depth

```sql
SELECT
  COUNT(*) as pending_count,
  AVG(julianday('now') - julianday(submitted_at)) * 24 as avg_wait_hours,
  MAX(julianday('now') - julianday(submitted_at)) * 24 as max_wait_hours
FROM review_action
WHERE status = 'pending' AND claimed_by IS NULL;
```

## Actionable Recommendations

### Immediate Actions

1. **Apply migration 001**: Add `logging_channel_id` column to unblock `/config set logging`.
2. **Backup before migration 002**: Test create-copy-swap in dev; apply to prod during off-hours.
3. **Validate foreign keys**: Run `PRAGMA foreign_key_check` after all migrations.

### Schema Improvements

1. **Add composite indexes**: `(status, claimed_by)` on review_action for queue queries.
2. **Implement soft deletes**: Add `deleted_at` column instead of hard deletes (audit trail).
3. **Create aggregates table**: Pre-compute daily metrics (avoid heavy queries on action_log).

### Migration Framework

1. **Version tracking**: Use `schema_migrations` table (already planned above).
2. **Rollback support**: Write `down()` functions for reversible migrations (backup-based fallback).
3. **Test harness**: Automated tests for migrations (snapshot DB before/after, compare schemas).

### Performance Optimizations

1. **Analyze query plans**: `EXPLAIN QUERY PLAN SELECT ...` for slow queries.
2. **Vacuum database**: Weekly `VACUUM` to reclaim space after deletes.
3. **WAL checkpoint**: `PRAGMA wal_checkpoint(TRUNCATE)` after bulk operations.
