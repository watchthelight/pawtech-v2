# Database & Data Handling Audit Plan

**Audit Date:** 2025-12-02
**Priority:** High
**Estimated Scope:** ~20 files modified, 3 migrations

---

## Executive Summary

The database layer has strong foundations (transactions, WAL mode, foreign keys enabled) but needs improvements in schema design (missing FKs, inconsistent timestamps, duplicate columns), prepared statement caching, and migration patterns.

---

## Critical Issues

### 1. Missing Foreign Key Constraints

**Problem:** Many tables lack proper foreign key relationships despite logical dependencies.

**Tables missing FKs:**

| Table | Missing FK | Should Reference |
|-------|-----------|------------------|
| `nsfw_flags` | guild_id | guild_config(guild_id) |
| `nsfw_flags` | user_id | (no user table - document why) |
| `avatar_scan` | application_id | application(id) |
| `user_activity` | guild_id | guild_config(guild_id) |
| `artist_queue` | guild_id | guild_config(guild_id) |
| `art_job` | - | artist_queue or artist_assignment_log |
| `modmail_ticket` | guild_id | guild_config(guild_id) |
| `action_log` | app_id | application(id) |

**Create migration `migrations/XXX_add_foreign_keys.ts`:**
```typescript
import { db } from "../src/db/db.js";
import { tableExists, columnExists } from "./lib/helpers.js";

export function migrate() {
  // SQLite doesn't support ADD CONSTRAINT for FKs
  // Must recreate tables with FKs

  // Example for nsfw_flags:
  db.transaction(() => {
    // 1. Create new table with FK
    db.prepare(`
      CREATE TABLE nsfw_flags_new (
        id INTEGER PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        flagged_at INTEGER NOT NULL,
        reviewed INTEGER NOT NULL DEFAULT 0,
        reviewed_by TEXT,
        reviewed_at INTEGER,
        FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id) ON DELETE CASCADE
      )
    `).run();

    // 2. Copy data
    db.prepare(`INSERT INTO nsfw_flags_new SELECT * FROM nsfw_flags`).run();

    // 3. Drop old, rename new
    db.prepare(`DROP TABLE nsfw_flags`).run();
    db.prepare(`ALTER TABLE nsfw_flags_new RENAME TO nsfw_flags`).run();

    // 4. Recreate indexes
    db.prepare(`CREATE INDEX idx_nsfw_flags_guild_reviewed ON nsfw_flags(guild_id, reviewed)`).run();
  })();

  // Repeat for other tables...
}
```

**Risk:** High - requires careful data migration. Test thoroughly.

**Files to create:**
- `migrations/XXX_add_foreign_keys.ts`

---

### 2. Duplicate Column in application Table

**Problem:** Schema has both `perma_rejected` AND `permanently_rejected` columns.

**Create migration `migrations/XXX_remove_duplicate_column.ts`:**
```typescript
import { db } from "../src/db/db.js";

export function migrate() {
  // Check which column is actually used
  const usesPermaRejected = db.prepare(`
    SELECT COUNT(*) as count FROM application WHERE perma_rejected = 1
  `).get() as { count: number };

  const usesPermanentlyRejected = db.prepare(`
    SELECT COUNT(*) as count FROM application WHERE permanently_rejected = 1
  `).get() as { count: number };

  console.log(`perma_rejected=1: ${usesPermaRejected.count}`);
  console.log(`permanently_rejected=1: ${usesPermanentlyRejected.count}`);

  // Merge data into permanently_rejected (the canonical column)
  db.prepare(`
    UPDATE application
    SET permanently_rejected = 1
    WHERE perma_rejected = 1 AND permanently_rejected = 0
  `).run();

  // Note: SQLite doesn't support DROP COLUMN before 3.35.0
  // For older versions, must recreate table
  // Check version and handle appropriately
}
```

**Files to create:**
- `migrations/XXX_remove_duplicate_column.ts`

---

### 3. Inconsistent Timestamp Types

**Problem:** Mix of TEXT (ISO8601) and INTEGER (Unix epoch) across tables.

**Current state:**
```sql
-- TEXT timestamps:
application.created_at TEXT DEFAULT (datetime('now'))
audit_sessions.started_at TEXT DEFAULT (datetime('now'))

-- INTEGER timestamps:
action_log.created_at_s INTEGER
role_assignments.created_at INTEGER DEFAULT (strftime('%s', 'now'))
```

**Recommendation:** Standardize on INTEGER (Unix epoch seconds).

**Create migration `migrations/XXX_standardize_timestamps.ts`:**
```typescript
import { db } from "../src/db/db.js";

export function migrate() {
  // Convert application.created_at from TEXT to INTEGER
  db.transaction(() => {
    // Add new column
    db.prepare(`ALTER TABLE application ADD COLUMN created_at_s INTEGER`).run();

    // Convert existing data
    db.prepare(`
      UPDATE application
      SET created_at_s = CAST(strftime('%s', created_at) AS INTEGER)
      WHERE created_at IS NOT NULL
    `).run();

    // Set default for new rows (can't change default on existing column)
    // Note: Would need table recreation to change column default
  })();

  // Similar for audit_sessions.started_at
}
```

**Note:** This is a larger change. Consider phasing:
1. Phase 1: Add `_s` columns alongside TEXT columns
2. Phase 2: Update code to use INTEGER columns
3. Phase 3: Drop TEXT columns

---

### 4. Prepared Statement Caching

**Problem:** Statements created inline on every call instead of cached.

**Current pattern (throughout all stores):**
```typescript
export function getFlag(guildId: string, userId: string) {
  // Statement parsed on EVERY call
  return db.prepare("SELECT * FROM flags WHERE guild_id = ? AND user_id = ?")
    .get(guildId, userId);
}
```

**Fixed pattern:**
```typescript
// Statement parsed ONCE at module load
const getFlagStmt = db.prepare(
  "SELECT * FROM flags WHERE guild_id = ? AND user_id = ?"
);

export function getFlag(guildId: string, userId: string) {
  return getFlagStmt.get(guildId, userId);
}
```

**Files to modify (all stores):**
- `src/store/flagsStore.ts`
- `src/store/nsfwFlagsStore.ts`
- `src/store/auditSessionStore.ts`
- `src/config/loggingStore.ts`
- `src/config/flaggerStore.ts`
- `src/features/panicStore.ts`
- `src/features/statusStore.ts`
- `src/features/artJobs/store.ts`
- `src/features/review/queries.ts`
- `src/features/artistRotation/queue.ts`
- `src/features/artistRotation/store.ts`
- `src/features/modmail/queries.ts`
- `src/features/analytics/queries.ts`
- `src/lib/config.ts` (guild config queries)
- ~10 more files

**Approach:**
1. For each file, identify all `db.prepare()` calls
2. Move to module-level constants
3. Update function bodies to use cached statements
4. Handle dynamic SQL separately (can't cache)

---

## High Priority Issues

### 5. Dual Schema Management

**Problem:** Tables defined in BOTH `db.ts` AND migrations.

**Current state:**
- `src/db/db.ts:91-396` - Creates tables directly on startup
- `src/db/ensure.ts` - Also creates/modifies tables
- `migrations/*.ts` - ALSO creates tables

**Recommendation:** Pure migrations approach (single source of truth).

**Actions:**
1. Audit which tables are created where
2. Ensure all tables have migration files
3. Remove CREATE TABLE from `db.ts` (keep only connection setup)
4. Remove table creation from `ensure.ts`
5. Document in CLAUDE.md that migrations are authoritative

**Files to modify:**
- `src/db/db.ts` (remove CREATE TABLE statements)
- `src/db/ensure.ts` (remove table creation)
- Add any missing migration files

---

### 6. Missing Input Validation in Stores

**Problem:** No validation that required fields are valid before inserting.

**Current:**
```typescript
export function upsertManualFlag(params: { guildId: string; userId: string; ... }) {
  // No validation that guildId/userId are valid snowflakes
  db.prepare(`INSERT INTO user_activity ...`).run(params.guildId, params.userId);
}
```

**Fix - Create validation helper:**
```typescript
// src/lib/validation.ts
const SNOWFLAKE_REGEX = /^\d{17,20}$/;

export function validateSnowflake(id: string, fieldName: string): void {
  if (!id || !SNOWFLAKE_REGEX.test(id)) {
    throw new Error(`Invalid ${fieldName}: "${id}" is not a valid Discord snowflake`);
  }
}

export function validateNonEmpty(str: string, fieldName: string): void {
  if (!str || str.trim().length === 0) {
    throw new Error(`${fieldName} cannot be empty`);
  }
}
```

**Then in stores:**
```typescript
import { validateSnowflake } from "../lib/validation.js";

export function upsertManualFlag(params: { guildId: string; userId: string; ... }) {
  validateSnowflake(params.guildId, 'guildId');
  validateSnowflake(params.userId, 'userId');
  // ... rest of function
}
```

**Files to create:**
- `src/lib/validation.ts`

**Files to modify:**
- All store files (add validation at function entry)

---

### 7. Transaction Wrapping for Multi-Step Operations

**Problem:** Some multi-step database operations lack transaction wrapping.

**Example in `src/features/artistRotation/queue.ts:85-101`:**
```typescript
export function removeArtist(guildId: string, userId: string): number | null {
  // DELETE artist
  db.prepare(`DELETE FROM artist_queue WHERE guild_id = ? AND user_id = ?`)
    .run(guildId, userId);

  // UPDATE positions - NOT IN TRANSACTION!
  db.prepare(`UPDATE artist_queue SET position = position - 1 WHERE ...`)
    .run(guildId, artist.position);

  // If crash between these, queue positions are corrupted
}
```

**Fix:**
```typescript
export function removeArtist(guildId: string, userId: string): number | null {
  return db.transaction(() => {
    const artist = db.prepare(`SELECT position FROM artist_queue WHERE ...`).get(...);
    if (!artist) return null;

    db.prepare(`DELETE FROM artist_queue WHERE guild_id = ? AND user_id = ?`)
      .run(guildId, userId);

    db.prepare(`UPDATE artist_queue SET position = position - 1 WHERE ...`)
      .run(guildId, artist.position);

    return artist.position;
  })();
}
```

**Files to audit for missing transactions:**
- `src/features/artistRotation/queue.ts` (removeArtist, moveToPosition)
- `src/features/gate.ts` (draft operations)
- Any function with multiple db.prepare().run() calls

---

### 8. Missing CHECK Constraints

**Problem:** Some status columns lack CHECK constraints.

**Tables missing constraints:**
- `art_job.status` - No constraint (could be any string)
- `audit_sessions.status` - No constraint
- `modmail_ticket.status` - Has constraint (good)
- `application.status` - Has constraint (good)

**Create migration:**
```typescript
export function migrate() {
  // For art_job - must recreate table in SQLite
  db.transaction(() => {
    db.prepare(`
      CREATE TABLE art_job_new (
        id INTEGER PRIMARY KEY,
        guild_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'assigned'
          CHECK (status IN ('assigned', 'in_progress', 'completed', 'cancelled')),
        -- ... rest of columns
      )
    `).run();

    db.prepare(`INSERT INTO art_job_new SELECT * FROM art_job`).run();
    db.prepare(`DROP TABLE art_job`).run();
    db.prepare(`ALTER TABLE art_job_new RENAME TO art_job`).run();
  })();
}
```

---

## Medium Priority Issues

### 9. Redundant Indexes

**Problem:** Duplicate indexes on application table.

**Current:**
```sql
idx_app_guild_status ON application(guild_id, status)
idx_application_guild_status ON application(guild_id, status)  -- DUPLICATE!
```

**Create migration:**
```typescript
export function migrate() {
  db.prepare(`DROP INDEX IF EXISTS idx_app_guild_status`).run();
  // Keep idx_application_guild_status
}
```

---

### 10. guild_config Table Too Wide

**Problem:** 50+ columns in single table.

**Recommendation:** Split into logical subtables (future consideration).

```sql
-- Option: Separate tables
guild_config_channels (guild_id, review_channel_id, gate_channel_id, ...)
guild_config_roles (guild_id, mod_role_ids, admin_role_ids, ...)
guild_config_features (guild_id, nsfw_detection_enabled, ...)
guild_config_thresholds (guild_id, flag_threshold, ...)
```

**Note:** This is a significant refactor. Document as future work.

---

### 11. Normalize CSV Columns

**Problem:** Role IDs stored as comma-separated strings.

**Current:**
```sql
guild_config.mod_role_ids TEXT  -- "123,456,789"
```

**Better:**
```sql
CREATE TABLE guild_mod_roles (
  guild_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, role_id),
  FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id) ON DELETE CASCADE
);
```

**Benefits:**
- Can query efficiently (no string parsing)
- Referential integrity
- Easier updates

**Note:** Significant refactor. Document as future work.

---

## Backup & Recovery

### 12. Automated Daily Backups

**Current:** Backups only happen during migrations.

**Create scheduler job:**
```typescript
// src/scheduler/dbBackup.ts
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import path from "node:path";
import fs from "node:fs";

const BACKUP_DIR = "data/backups";
const RETENTION_DAYS = 7;

export async function runDailyBackup(): Promise<void> {
  const timestamp = new Date().toISOString().split('T')[0];
  const backupPath = path.join(BACKUP_DIR, `data-${timestamp}.db`);

  // Ensure backup directory exists
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // Use SQLite backup API
  await db.backup(backupPath);
  logger.info({ backupPath }, "[backup] Daily backup completed");

  // Cleanup old backups
  const files = fs.readdirSync(BACKUP_DIR);
  const cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);

  for (const file of files) {
    const filePath = path.join(BACKUP_DIR, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      logger.info({ file }, "[backup] Removed old backup");
    }
  }
}
```

**Register in scheduler:**
```typescript
// Run daily at 3 AM
schedule.scheduleJob('0 3 * * *', runDailyBackup);
```

**Files to create:**
- `src/scheduler/dbBackup.ts`

**Files to modify:**
- `src/scheduler/index.ts` (register job)

---

### 13. Integrity Monitoring

**Add periodic integrity checks:**
```typescript
// src/scheduler/dbIntegrity.ts
export async function checkDatabaseIntegrity(): Promise<void> {
  const integrityResult = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };

  if (integrityResult.integrity_check !== 'ok') {
    logger.error({ result: integrityResult }, "[db] Integrity check failed!");
    // Alert via Discord or other channel
  }

  const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
  if (fkViolations.length > 0) {
    logger.error({ violations: fkViolations }, "[db] Foreign key violations detected!");
  }
}
```

---

## Documentation

### 14. Create Database Documentation

**Create `docs/DATABASE.md`:**
```markdown
# Database Schema Documentation

## Overview
- SQLite via better-sqlite3 (synchronous)
- WAL mode enabled
- Foreign keys enforced

## Tables

### guild_config
Primary configuration table for each Discord guild.
- PK: guild_id (Discord snowflake)
- Contains: channel IDs, role IDs, feature flags, thresholds

### application
Gate application submissions.
- PK: id (TEXT, ULID)
- FK: guild_id → guild_config
- Status: draft, submitted, approved, rejected, perm_rejected

... (document all tables)

## Migrations
Migrations are the single source of truth for schema.
Run: `npm run migrate`

## Backups
Daily automated backups to data/backups/
Retention: 7 days
```

---

## Verification Steps

After each change:

1. **Run migrations:**
   ```bash
   npm run migrate:dry  # Preview
   npm run migrate      # Apply
   ```

2. **Verify integrity:**
   ```sql
   PRAGMA integrity_check;
   PRAGMA foreign_key_check;
   ```

3. **Run tests:**
   ```bash
   npm run test
   ```

4. **Verify bot startup:**
   ```bash
   npm run dev
   ```

---

## Estimated Impact

- **Migrations created:** 5-6
- **Files modified:** ~20
- **Risk level:** Medium-High (schema changes)
- **Recommended approach:**
  - Test each migration on copy of production data
  - Deploy during low-traffic period
  - Keep backup before each migration
