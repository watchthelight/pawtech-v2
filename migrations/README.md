# Pawtropolis Tech - Database Migrations

This folder contains versioned database migrations for the Pawtropolis Tech Discord bot.

## 📁 Folder Structure

```
migrations/
├── README.md                    # This file
├── lib/                         # Shared migration utilities
│   └── helpers.ts              # Common helper functions
├── 000_init.sql                # Legacy SQL migrations (not auto-run)
├── 001_*.sql                   # Legacy SQL migrations
├── 001_add_logging_channel_id.ts  # Modern TypeScript migrations
├── 002_create_mod_metrics.ts
└── ...
```

## 🎯 Migration Formats

### TypeScript Migrations (Preferred)

**Filename format**: `NNN_descriptive_name.ts`

- `NNN`: Zero-padded 3-digit version number (001, 002, etc.)
- `descriptive_name`: Snake_case description of what the migration does
- Extension: `.ts` (TypeScript)

**Example**: `011_add_custom_status_column.ts`

**Export format**:

```typescript
export function migrateNNNDescriptiveName(db: Database): void {
  // Migration logic here
}
```

The function name must be: `migrate` + version + PascalCase(descriptiveName)

**Example**: `migrate011AddCustomStatusColumn`

### SQL Migrations (Legacy)

**Not automatically run by migrate.ts**. These are historical schema changes that were manually applied or are used for reference.

Filename format: `NNN_descriptive_name.sql`

## 🔧 Writing a New Migration

### 1. Create Migration File

```bash
# Determine next version number
cd migrations
ls -1 *.ts | grep -E "^[0-9]{3}_" | sort | tail -1

# Create new migration (if last was 011)
touch 012_add_user_roles.ts
```

### 2. Use Migration Template

```typescript
/**
 * Pawtropolis Tech — migrations/012_add_user_roles.ts
 * WHAT: Brief description of what this migration does
 * WHY: Why this change is needed
 * HOW: How the migration works (ALTER TABLE, CREATE TABLE, etc.)
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (explain how)
 *  - Data preservation: explain how existing data is handled
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, tableExists, recordMigration } from "./lib/helpers.js";

/**
 * Migration: Add user_roles table
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate012AddUserRoles(db: Database): void {
  logger.info("[migration 012] Starting: add user_roles table");

  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Check if table already exists (idempotency)
  if (tableExists(db, "user_roles")) {
    logger.info("[migration 012] user_roles table already exists, skipping");
    recordMigration(db, "012", "add_user_roles");
    return;
  }

  // Apply changes
  logger.info("[migration 012] Creating user_roles table");
  db.exec(`
    CREATE TABLE user_roles (
      user_id   TEXT NOT NULL,
      guild_id  TEXT NOT NULL,
      role_id   TEXT NOT NULL,
      added_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (user_id, guild_id, role_id)
    )
  `);

  // Record migration
  recordMigration(db, "012", "add_user_roles");

  logger.info("[migration 012] ✅ Complete");
}
```

### 3. Test Locally

```bash
# Run migration
npm run migrate

# Verify changes
sqlite3 data/data.db ".schema user_roles"
```

### 4. Commit

```bash
git add migrations/012_add_user_roles.ts
git commit -m "feat(db): add user_roles table for role management"
```

## 🛡️ Safety Best Practices

### Idempotency

All migrations must be **idempotent** (safe to run multiple times):

```typescript
// ✅ GOOD: Check before creating
if (!tableExists(db, "my_table")) {
  db.exec(`CREATE TABLE my_table (...)`);
}

// ❌ BAD: Will fail on second run
db.exec(`CREATE TABLE my_table (...)`);
```

### Foreign Keys

Always enable foreign keys at the start of migrations:

```typescript
db.pragma("foreign_keys = ON");
```

### Transactions

The migration runner wraps each migration in a transaction automatically. If your migration throws an error, all changes will be rolled back.

### Data Preservation

When altering tables:

- Use `ALTER TABLE ADD COLUMN` instead of recreating tables
- Provide DEFAULT values for new columns
- Document how existing data is handled

### Backfill Strategy

If you need to populate new columns with data:

```typescript
// Add column with default
db.exec(`ALTER TABLE users ADD COLUMN verified INTEGER DEFAULT 0`);

// Backfill based on conditions
db.prepare(
  `
  UPDATE users
  SET verified = 1
  WHERE email IS NOT NULL AND email_confirmed = 1
`
).run();
```

## 🔄 Running Migrations

### Development

```bash
# Dry run (show pending migrations without applying)
npm run migrate:dry

# Apply all pending migrations
npm run migrate
```

### Production

Migrations run automatically on deployment:

```bash
ssh pawtech "cd /home/ubuntu/pawtech-v2 && npm run migrate"
```

### Rollback

⚠️ **No automatic rollback support**. If a migration fails:

1. Fix the migration code
2. Restore from backup: `cp data/data.db.backup-TIMESTAMP data/data.db`
3. Re-run migrations

## 📊 Migration Tracking

Migrations are tracked in the `schema_migrations` table:

```sql
SELECT * FROM schema_migrations ORDER BY version;
```

| Column       | Type    | Description                  |
| ------------ | ------- | ---------------------------- |
| `version`    | TEXT    | Version number (e.g., "011") |
| `name`       | TEXT    | Migration name (snake_case)  |
| `applied_at` | INTEGER | Unix timestamp when applied  |

## 🚨 Common Issues

### "Migration function not found"

**Error**: `Migration 012 does not export a migrate function`

**Cause**: Function name doesn't match expected format

**Fix**: Ensure function name is `migrate` + version + PascalCase(name)

```typescript
// ✅ CORRECT
export function migrate012AddUserRoles(db: Database): void {}

// ❌ WRONG
export function addUserRoles(db: Database): void {}
```

### "SQLITE_ERROR: table already exists"

**Cause**: Migration is not idempotent

**Fix**: Add existence check before creating table:

```typescript
if (!tableExists(db, "my_table")) {
  db.exec(`CREATE TABLE my_table (...)`);
}
```

### "Column already exists"

**Cause**: Adding column without checking if it exists

**Fix**: Use `columnExists` helper:

```typescript
if (!columnExists(db, "users", "verified")) {
  db.exec(`ALTER TABLE users ADD COLUMN verified INTEGER DEFAULT 0`);
}
```

## 📚 Additional Resources

### SQLite Documentation

- [ALTER TABLE](https://sqlite.org/lang_altertable.html) - Adding/renaming columns
- [CREATE TABLE](https://sqlite.org/lang_createtable.html) - Table creation syntax
- [PRAGMA](https://sqlite.org/pragma.html) - Database configuration
- [Transactions](https://sqlite.org/lang_transaction.html) - Transaction control

### Project Documentation

- [Database Schema](../docs/context/07_Database_Schema_and_Migrations.md) - Full schema reference
- [Migration Runner](../scripts/migrate.ts) - How migrations are executed
- [Database Ensure](../src/lib/db/ensure.ts) - Schema initialization

## 🔍 Debugging

### View Migration Status

```bash
# Show applied migrations
sqlite3 data/data.db "SELECT version, name, datetime(applied_at, 'unixepoch') as applied FROM schema_migrations ORDER BY version"

# Show pending migrations
npm run migrate:dry
```

### Test Migration Locally

```bash
# Copy production database
scp pawtech:/home/ubuntu/pawtech-v2/data/data.db ./data/data-prod-copy.db

# Test migration
DB_PATH=./data/data-prod-copy.db npm run migrate
```

### Reset Development Database

```bash
rm data/data.db
npm run migrate
```

## ⚠️ Version Number Conflicts

**Issue**: Multiple migrations with the same version number exist in the folder.

**Current state**: Some legacy SQL files have duplicate version numbers (001, 002, 004, 008, 010). These are **not auto-run** by the TypeScript migration runner.

**Resolution**:

- `.ts` migrations are the source of truth
- `.sql` files are legacy/reference only
- When creating new migrations, check existing `.ts` files only

## 📊 Numbering Gaps

The TypeScript migration sequence has the following gaps:

| Missing Numbers | Reason |
|-----------------|--------|
| 006, 007, 009 | These versions exist only as legacy `.sql` files (not auto-run) |
| 014, 015, 016 | Development migrations that were never committed |

**Important**: These gaps are cosmetic and do not affect functionality. The migration runner processes files by version number regardless of gaps.

**Current sequence**: Migrations continue from 028 onward.

## 📝 Migration Checklist

Before committing a new migration:

- [ ] Filename follows `NNN_snake_case.ts` format
- [ ] Function name is `migrateNNNPascalCase`
- [ ] Migration is idempotent (safe to run multiple times)
- [ ] Foreign keys are enabled (`db.pragma("foreign_keys = ON")`)
- [ ] Existing data is preserved or documented
- [ ] Migration logs clearly describe actions
- [ ] Tested locally with `npm run migrate`
- [ ] Uses shared helpers from `lib/helpers.ts`
- [ ] Documentation header explains WHAT, WHY, HOW
- [ ] No breaking changes to production data

---

**Need help?** See [docs/CONTRIBUTING.md](../docs/CONTRIBUTING.md) or ask in development channel.
