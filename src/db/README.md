# Database Layer

This folder contains the SQLite database connection, schema bootstrapping, and runtime schema migration utilities.

## Overview

The database layer uses **better-sqlite3** for synchronous SQLite access with Write-Ahead Logging (WAL) mode for improved concurrency. The design philosophy emphasizes:

- **Self-healing schema**: Tables and columns are created on startup if missing
- **Zero-downtime migrations**: Additive schema changes via ALTER TABLE
- **Defensive programming**: Queries are traced, legacy SQL is blocked
- **Referential integrity**: Foreign keys enforced via PRAGMA
- **Performance tuning**: WAL journaling, NORMAL synchronous mode, busy timeout

## Files

### [db.ts](./db.ts)

**Core database connection and bootstrap schema.**

**What it does:**

- Opens SQLite connection with performance-tuned PRAGMAs
- Creates core tables (review_card, review_claim, dm_bridge, transcript, modmail_ticket, modmail_message)
- Wraps `db.prepare()` with tracing and legacy SQL detection
- Handles graceful shutdown (SIGTERM, SIGINT)
- Provides `execRaw()` for multi-statement DDL (migrations only)

**Key Exports:**

| Export         | Type       | Description                                       |
| -------------- | ---------- | ------------------------------------------------- |
| `db`           | `Database` | better-sqlite3 database instance (singleton)      |
| `execRaw(sql)` | `function` | Execute raw multi-statement SQL (migrations only) |

**PRAGMAs Applied:**

```sql
PRAGMA journal_mode = WAL         -- Write-Ahead Logging for concurrency
PRAGMA synchronous = NORMAL       -- Balanced durability vs performance
PRAGMA foreign_keys = ON          -- Enforce referential integrity
PRAGMA busy_timeout = 5000        -- Wait 5s on contention before throwing
```

**Bootstrap Tables:**

1. **review_card** - Tracks Discord message locations for review cards
   - `app_id` (PK), `channel_id`, `message_id`, `updated_at`

2. **review_claim** - Prevents simultaneous review conflicts
   - `app_id` (PK), `reviewer_id`, `claimed_at`

3. **dm_bridge** - Links application IDs to DM channels/threads
   - `app_id` (PK), `user_id`, `thread_id`, `dm_channel_id`, `opened_at`, `closed_at`

4. **transcript** - Audit trail for application messages
   - `id` (AUTOINCREMENT), `app_id`, `ts`, `author_id`, `source`, `content`

5. **modmail_ticket** - Modmail thread tracking
   - `id` (AUTOINCREMENT), `guild_id`, `user_id`, `app_code`, `status`, etc.
   - Unique index: Only one open ticket per (guild, user)

6. **modmail_message** - DM ↔ Thread message mapping
   - `id` (AUTOINCREMENT), `ticket_id`, `direction`, message IDs, reply tracking

**Legacy SQL Guard:**

The `tracedPrepare` wrapper blocks queries matching:

- `__old*` tokens (legacy code markers)
- `ALTER TABLE ... RENAME` (use migrations in ensure.ts instead)

**Tracing:**

Set `DB_TRACE=1` environment variable to log all SQL queries via Pino.

### [ensure.ts](./ensure.ts)

**Runtime schema migrations and self-healing.**

**What it does:**

- Ensures tables/columns exist on startup
- Handles column additions without downtime
- Performs table recreation migrations when ALTER TABLE won't work
- Creates indexes for performance

**Exported Functions:**

| Function                               | Purpose                                                |
| -------------------------------------- | ------------------------------------------------------ |
| `ensureAvatarScanSchema()`             | Create/migrate avatar_scan table with all columns      |
| `ensureApplicationPermaRejectColumn()` | Add permanent rejection columns to application table   |
| `ensureOpenModmailTable()`             | Create open_modmail race-safe tracking table           |
| `ensureApplicationStatusIndex()`       | Index for queue analytics (status, created_at)         |
| `ensureReviewActionFreeText()`         | Remove CHECK constraint, convert created_at to INTEGER |
| `ensureManualFlagColumns()`            | Add manual flag columns to user_activity table         |
| `ensureActionLogSchema()`              | Create action_log and guild_config tables              |

**Migration Patterns:**

#### 1. Additive Column (Simple)

```typescript
if (!colNames.includes("new_column")) {
  logger.info("[ensure] adding new_column");
  db.prepare(`ALTER TABLE foo ADD COLUMN new_column TEXT`).run();
}
```

**Use for:** Adding nullable columns, columns with defaults

#### 2. Table Recreation (Complex)

Used when ALTER TABLE won't work (CHECK constraints, type changes):

```typescript
db.transaction(() => {
  // 1. Backup existing data
  db.exec(`CREATE TABLE foo_bak AS SELECT * FROM foo`);

  // 2. Drop old table + indexes
  db.exec(`DROP TABLE foo`);

  // 3. Create new schema
  db.exec(`CREATE TABLE foo (...)`);

  // 4. Restore data with transformations
  db.prepare(`INSERT INTO foo SELECT ... FROM foo_bak`).run();

  // 5. Drop backup
  db.exec(`DROP TABLE foo_bak`);
})();
```

**Use for:** Removing CHECK constraints, changing column types, restructuring foreign keys

#### 3. Conditional Migration

Migrations check schema state before running:

```typescript
const needsMigration = (() => {
  const ddlRow = db.prepare(`SELECT sql FROM sqlite_schema WHERE name='foo'`).get();
  const hasCheck = /CHECK\s*\(/i.test(ddlRow.sql);
  // ... other checks
  return hasCheck || otherConditions;
})();

if (!needsMigration) {
  logger.info("[ensure] foo table OK");
  return;
}

// Run migration...
```

**Use for:** Idempotent migrations that can be re-run safely

## Database Architecture

### Connection Management

- **Singleton pattern**: `db` is exported as a shared instance
- **Synchronous API**: better-sqlite3 is fully synchronous (no async/await)
- **Auto-shutdown**: Graceful close on SIGTERM/SIGINT
- **Sentry flushing**: Ensures error events are sent before exit

### Schema Versioning

**No traditional migration files.** Instead:

1. **Bootstrap schema** in `db.ts` creates core tables
2. **Runtime migrations** in `ensure.ts` add columns/indexes as needed
3. **Migrations folder** (`migrations/`) for one-time data transformations

**Philosophy:**

- Additive changes only (never drop columns in production)
- Schema self-heals on startup
- No version tracking table needed
- Idempotent operations (CREATE IF NOT EXISTS, column checks)

### Performance Optimizations

**WAL Mode:**

- Readers don't block writers
- Writers don't block readers (except during checkpoint)
- Better concurrency for bot workload

**NORMAL Synchronous:**

- Reduces fsync() calls vs FULL
- Acceptable durability trade-off for bot data
- Critical data should use transactions

**Busy Timeout:**

- 5-second wait on SQLITE_BUSY errors
- Prevents immediate failures during contention
- Gives time for long-running queries to finish

**Indexes:**

- Created via `ensure.ts` functions
- Composite indexes for common query patterns
- Partial indexes for conditional queries (e.g., `WHERE status = 'open'`)

## Common Patterns

### Query Execution

**Synchronous API:**

```typescript
import { db } from "../db/db.js";

// SELECT single row
const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);

// SELECT multiple rows
const apps = db.prepare(`SELECT * FROM application WHERE status = ?`).all("pending");

// INSERT/UPDATE/DELETE
const result = db.prepare(`INSERT INTO foo (bar) VALUES (?)`).run(value);
console.log(result.changes); // Number of rows affected
console.log(result.lastInsertRowid); // Last inserted ID
```

**Transactions:**

```typescript
const insertMany = db.transaction((items) => {
  const stmt = db.prepare(`INSERT INTO foo (bar) VALUES (?)`);
  for (const item of items) {
    stmt.run(item);
  }
});

// Atomic execution (all or nothing)
insertMany([1, 2, 3]);
```

### UPSERT Pattern

**Insert or update on conflict:**

```typescript
db.prepare(
  `
  INSERT INTO guild_config (guild_id, logging_channel_id)
  VALUES (?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    logging_channel_id = excluded.logging_channel_id,
    updated_at = datetime('now')
`
).run(guildId, channelId);
```

**Benefits:**

- Idempotent (safe to re-run)
- Atomic (no race conditions)
- Single query (better performance)

### Schema Introspection

**Check if table exists:**

```typescript
const exists = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
  .get(tableName);

if (!exists) {
  // Create table...
}
```

**Check if column exists:**

```typescript
const cols = db.prepare(`PRAGMA table_info(table_name)`).all() as Array<{ name: string }>;
const hasColumn = cols.some((c) => c.name === "column_name");
```

**Get table DDL:**

```typescript
const ddl = db
  .prepare(`SELECT sql FROM sqlite_schema WHERE type='table' AND name=?`)
  .get(tableName) as { sql: string };

console.log(ddl.sql); // CREATE TABLE ...
```

### Error Handling

**All queries are wrapped with tracing:**

```typescript
try {
  db.prepare(`SELECT * FROM foo WHERE id = ?`).get(id);
} catch (err) {
  // Error is automatically logged by tracedPrepare wrapper
  // Handle gracefully or re-throw
  logger.error({ err, id }, "Failed to fetch foo");
  throw new Error("Database query failed");
}
```

**Foreign key violations:**

```sql
-- Enable foreign keys (already done in db.ts)
PRAGMA foreign_keys = ON;

-- Define foreign key
CREATE TABLE child (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE
);
```

Violations throw `SQLITE_CONSTRAINT` errors.

## Environment Variables

| Variable   | Default        | Description                       |
| ---------- | -------------- | --------------------------------- |
| `DB_PATH`  | `data/data.db` | Path to SQLite database file      |
| `DB_TRACE` | `0`            | Set to `1` to log all SQL queries |

**Example:**

```bash
# Use custom database location
export DB_PATH=/var/lib/pawtropolis/prod.db

# Enable query tracing
export DB_TRACE=1

npm start
```

## Testing

### Unit Tests

**Mock the database:**

```typescript
import Database from "better-sqlite3";

const testDb = new Database(":memory:");
// Apply same PRAGMAs as production
testDb.pragma("journal_mode = WAL");
testDb.pragma("foreign_keys = ON");

// Create schema
testDb.prepare(`CREATE TABLE users (...)`).run();

// Run tests
const result = testDb.prepare(`SELECT * FROM users`).all();
expect(result).toHaveLength(0);
```

### Integration Tests

**Use temporary database:**

```typescript
import fs from "node:fs";
import path from "node:path";
import { db } from "../db/db.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "test.db");

beforeAll(() => {
  process.env.DB_PATH = TEST_DB_PATH;
  // Re-import db module to use test path
});

afterAll(() => {
  db.close();
  fs.unlinkSync(TEST_DB_PATH);
});
```

### Manual Testing

**SQLite CLI:**

```bash
# Open database
sqlite3 data/data.db

# Enable column headers
.headers on
.mode column

# Query
SELECT * FROM review_card LIMIT 10;

# Check schema
.schema review_card

# Exit
.quit
```

**Inspect WAL file:**

```bash
# Check WAL mode status
sqlite3 data/data.db "PRAGMA journal_mode;"
# Output: wal

# View WAL file (binary)
ls -lh data/data.db-wal

# Force checkpoint (merge WAL into main DB)
sqlite3 data/data.db "PRAGMA wal_checkpoint(FULL);"
```

## Migration Guide

### Adding a New Table

**1. Choose location:**

- Core tables (review, modmail) → `db.ts` bootstrap
- Feature-specific tables → `ensure.ts` function

**2. Create table in ensure.ts:**

```typescript
export function ensureMyFeatureTable() {
  try {
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS my_feature (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )
    `
    ).run();

    // Add indexes
    db.prepare(
      `
      CREATE INDEX IF NOT EXISTS idx_my_feature_guild
      ON my_feature(guild_id, created_at DESC)
    `
    ).run();

    logger.info("[ensure] my_feature table ensured");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure my_feature table");
    throw err;
  }
}
```

**3. Call from index.ts:**

```typescript
import { ensureMyFeatureTable } from "./db/ensure.js";

ensureMyFeatureTable();
```

### Adding a Column

**1. For existing production table:**

Use `ensure.ts` pattern:

```typescript
export function ensureMyNewColumn() {
  try {
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='target_table'`)
      .get();

    if (!tableExists) {
      logger.warn("[ensure] target_table does not exist, skipping");
      return;
    }

    const cols = db.prepare(`PRAGMA table_info(target_table)`).all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);

    if (!colNames.includes("my_new_column")) {
      logger.info("[ensure] adding my_new_column");
      db.prepare(`ALTER TABLE target_table ADD COLUMN my_new_column TEXT`).run();
    }

    logger.info("[ensure] my_new_column ensured");
  } catch (err) {
    logger.error({ err }, "[ensure] failed to ensure my_new_column");
    throw err;
  }
}
```

**2. For new table in db.ts:**

Just add it to the CREATE TABLE statement (IF NOT EXISTS prevents errors).

### Changing Column Type

**SQLite doesn't support ALTER COLUMN TYPE.** Use table recreation pattern:

```typescript
export function migrateColumnType() {
  const migrate = db.transaction(() => {
    // 1. Backup
    db.exec(`CREATE TABLE foo_bak AS SELECT * FROM foo`);

    // 2. Drop old
    db.exec(`DROP TABLE foo`);

    // 3. Create with new type
    db.exec(`
      CREATE TABLE foo (
        id INTEGER PRIMARY KEY,
        my_column INTEGER NOT NULL  -- Changed from TEXT
      )
    `);

    // 4. Restore with CAST
    db.prepare(
      `
      INSERT INTO foo (id, my_column)
      SELECT id, CAST(my_column AS INTEGER) FROM foo_bak
    `
    ).run();

    // 5. Cleanup
    db.exec(`DROP TABLE foo_bak`);
  });

  migrate(); // Execute transaction
}
```

### Removing a CHECK Constraint

**See:** `ensureReviewActionFreeText()` in [ensure.ts:376](./ensure.ts#L376)

**Process:**

1. Detect CHECK constraint via schema DDL inspection
2. Backup → Drop → Recreate → Restore
3. Verify row counts match before/after

## Best Practices

### Query Performance

**✅ DO:**

- Use parameterized queries (`?` placeholders)
- Create indexes for WHERE/JOIN columns
- Use transactions for bulk operations
- Keep transactions short (< 1 second)

**❌ DON'T:**

- Concatenate user input into SQL (SQL injection risk)
- Run long queries on the main thread (blocks bot)
- Use `db.exec()` for normal queries (use `db.prepare()` instead)
- Forget to close the database on shutdown

### Schema Design

**✅ DO:**

- Use INTEGER PRIMARY KEY for AUTOINCREMENT (aliased to ROWID)
- Define foreign keys with ON DELETE CASCADE/SET NULL
- Use NOT NULL with DEFAULT for required fields
- Create partial indexes for conditional queries

**❌ DON'T:**

- Use AUTOINCREMENT unless you need stable IDs after deletions
- Store JSON as TEXT without validation (prefer columns)
- Create indexes on every column (overhead vs benefit)
- Use REAL for currency (precision issues)

### Migration Safety

**✅ DO:**

- Test migrations on a database copy first
- Use transactions for multi-step migrations
- Verify row counts before/after data migrations
- Log migration progress and errors

**❌ DON'T:**

- Drop tables/columns in production (data loss risk)
- Run migrations during peak hours
- Assume migrations are idempotent (test re-runs)
- Skip backups before schema changes

### Error Handling

**✅ DO:**

- Catch and log all database errors
- Provide helpful error messages to users
- Use transactions for multi-step operations
- Retry on SQLITE_BUSY errors (handled by busy_timeout)

**❌ DON'T:**

- Swallow errors silently
- Expose SQL error messages to users
- Assume writes always succeed
- Forget to rollback on transaction errors (automatic in better-sqlite3)

## Troubleshooting

### Database is locked

**Problem:** `SQLITE_BUSY: database is locked`

**Causes:**

- Long-running query holding lock
- WAL checkpoint in progress
- Multiple processes accessing database

**Solutions:**

1. Check `busy_timeout` is set (5000ms default)
2. Verify WAL mode: `sqlite3 data/data.db "PRAGMA journal_mode;"`
3. Find long queries via `DB_TRACE=1`
4. Ensure only one bot process per database

### Foreign key constraint failed

**Problem:** `SQLITE_CONSTRAINT: FOREIGN KEY constraint failed`

**Causes:**

- Inserting row with invalid parent ID
- Deleting parent row without CASCADE
- Foreign keys disabled

**Solutions:**

1. Check `PRAGMA foreign_keys` is ON (set in db.ts)
2. Verify parent record exists before insert
3. Use ON DELETE CASCADE for dependent data
4. Check foreign key definitions: `PRAGMA foreign_key_list(table_name);`

### Column already exists

**Problem:** Migration fails with "duplicate column name"

**Cause:** Migration ran twice without idempotency check

**Solution:** Always check column existence before ALTER:

```typescript
if (!colNames.includes("my_column")) {
  db.prepare(`ALTER TABLE foo ADD COLUMN my_column TEXT`).run();
}
```

### Table schema mismatch

**Problem:** Queries fail after migration with "no such column"

**Causes:**

- Migration didn't run (error during startup)
- Using old code with new schema
- Schema drift between environments

**Solutions:**

1. Check logs for migration errors
2. Manually inspect schema: `sqlite3 data/data.db ".schema table_name"`
3. Re-run ensure functions via `npm start`
4. Compare schema across environments

### WAL file too large

**Problem:** `data.db-wal` grows to hundreds of MB

**Cause:** WAL checkpoint not running (readers holding locks)

**Solutions:**

1. Restart bot to force checkpoint
2. Manual checkpoint: `sqlite3 data/data.db "PRAGMA wal_checkpoint(TRUNCATE);"`
3. Check for long-running queries (DB_TRACE=1)
4. Consider `.pragma("wal_autocheckpoint = 1000")` for smaller WAL

## Related Documentation

- [migrations/](../../migrations/) - One-time data transformation scripts
- [src/config/](../config/) - Configuration stores using this database
- [docs/context/07_Database_Schema_and_Migrations.md](../../docs/context/07_Database_Schema_and_Migrations.md) - Full schema reference

## External References

- [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [SQLite PRAGMA](https://sqlite.org/pragma.html)
- [SQLite UPSERT](https://sqlite.org/lang_UPSERT.html)
- [SQLite WAL Mode](https://sqlite.org/wal.html)
- [SQLite Foreign Keys](https://sqlite.org/foreignkeys.html)

## Future Improvements

Potential enhancements for this folder:

1. **Query builder abstraction:**
   - Type-safe query builder (e.g., Kysely, Drizzle)
   - Reduces SQL string errors
   - Better TypeScript integration

2. **Connection pooling:**
   - Multiple database connections for read/write split
   - Requires coordination for WAL checkpoints

3. **Backup automation:**
   - Scheduled SQLite `.backup` command
   - Copy to S3/cloud storage
   - Point-in-time recovery

4. **Schema versioning:**
   - Track applied migrations in `schema_version` table
   - Prevent running old code on new schema

5. **Performance monitoring:**
   - Query execution time tracking
   - Slow query alerts
   - Index usage statistics

6. **Validation layer:**
   - Schema validation via Zod/Yup
   - Runtime type checking on query results
   - Prevents schema drift bugs
