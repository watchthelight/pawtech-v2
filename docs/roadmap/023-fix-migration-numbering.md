# Migration Numbering Gap - Issue #23

**Status:** Planned
**Priority:** Medium
**Type:** Documentation/Cleanup
**Created:** 2025-11-30

## Issue Summary

Migration files in `/migrations/` have inconsistent numbering with gaps in the sequence, and one migration uses a date prefix instead of the required numeric format. This violates the migration naming convention and could cause the date-prefixed migration to be skipped by the migration runner.

**Source:** Codebase Audit 2025-11-30, Issue #23

## Current State

### Problems Identified

1. **Missing migration numbers**: Gaps exist in the numbering sequence (006, 007, 009, 014, 015, 016 are missing)
2. **Date-prefixed migration**: `2025-10-20_review_action_free_text.ts` uses date format instead of numeric prefix
3. **Migration runner incompatibility**: The runner filters for `^\d{3}_` pattern, which won't match the date-prefixed file

### Migration Files Inventory

**TypeScript migrations (.ts)** - Auto-run by migration system:
- 001_add_logging_channel_id.ts
- 002_create_mod_metrics.ts
- 003_create_user_cache.ts
- 004_metrics_epoch_and_joins.ts
- 005_flags_config.ts
- 008_manual_flags.ts
- 010_limit_questions_to_5.ts
- 011_add_custom_status_column.ts
- 012_add_db_backups_table.ts
- 013_add_health_alerts_table.ts
- **2025-10-20_review_action_free_text.ts** ← Invalid naming format
- 017_add_notify_config_to_guild_config.ts
- 018_add_ping_dev_on_app.ts
- 019_add_app_short_codes_table.ts
- 020_add_message_activity_table.ts
- 021_add_modmail_message_content.ts
- 022_transcript_index.ts
- 023_user_activity_indexes.ts
- 024_review_action_index.ts
- 025_role_automation.ts
- 026_sync_marker.ts

**SQL migrations (.sql)** - Legacy/reference only (not auto-run):
- 000_init.sql
- 001_indices.sql
- 002_questions.sql
- 002_review_cards.sql
- 003_avatar_scan.sql
- 004_permanent_reject.sql
- 005_open_modmail.sql
- 006_review_action_expand.sql
- 007_action_log.sql
- 008_gate_questions_index.sql
- 009_bot_status.sql
- 010_application_updated_at.sql

### Numbering Gaps

**Missing in .ts sequence**: 006, 007, 009, 014, 015, 016

These numbers appear in legacy .sql files but not in TypeScript migrations. Per the migration README, .sql files are legacy/reference only and not auto-run, so these gaps are acceptable.

### Date-Prefixed Migration Details

**File:** `2025-10-20_review_action_free_text.ts`
**Export function:** `migrateReviewActionFreeText()`
**Purpose:** Migrates review_action table to support free-text actions and Unix epoch timestamps
**Current status:** Not picked up by migration runner due to naming convention mismatch

## Proposed Changes

### Step 1: Determine Next Available Migration Number

The date-prefixed migration should be renumbered to follow the highest existing migration number.

**Current highest:** 026
**Proposed number:** 027

### Step 2: Rename Date-Prefixed Migration

**From:** `2025-10-20_review_action_free_text.ts`
**To:** `027_review_action_free_text.ts`

### Step 3: Update Export Function Name

The migration export function must follow the naming convention: `migrate{VERSION}{PascalCaseName}`

**Current:** `export function migrateReviewActionFreeText(db: Database): void`
**New:** `export function migrate027ReviewActionFreeText(db: Database): void`

### Step 4: Verify Idempotency

Confirm that the migration is already idempotent (safe to run multiple times). The existing code includes:
- Table existence checks
- Column type introspection
- CHECK constraint detection
- Row count validation

No changes needed - migration is already properly idempotent.

### Step 5: Document Numbering Gaps

Update `/migrations/README.md` to clarify that:
- Gaps 006, 007, 009 exist because they correspond to .sql files only
- Gaps 014, 015, 016 are genuinely missing (likely development migrations that were never committed)
- Future migrations should continue from 027 onward

## Files Affected

| File | Action | Description |
|------|--------|-------------|
| `/migrations/2025-10-20_review_action_free_text.ts` | Rename | → `027_review_action_free_text.ts` |
| `/migrations/027_review_action_free_text.ts` | Edit | Update export function name to `migrate027ReviewActionFreeText` |
| `/migrations/README.md` | Edit | Document numbering gaps and rationale |

## Testing Strategy

### Pre-Migration Checks

1. **Verify current migration status:**
   ```bash
   npm run migrate:dry
   ```
   Expected: Should NOT list the date-prefixed migration (not detected by runner)

2. **Check schema_migrations table:**
   ```bash
   sqlite3 data/data.db "SELECT * FROM schema_migrations ORDER BY version"
   ```
   Expected: Should NOT contain any record for the date-prefixed migration

### Post-Rename Checks

1. **Verify file detection:**
   ```bash
   npm run migrate:dry
   ```
   Expected: Should now list 027_review_action_free_text as pending (if not already applied)

2. **Verify function name resolution:**
   The migration runner dynamically imports: `migrate{version}{PascalCaseName}`
   Expected: `migrate027ReviewActionFreeText` should be found and executed

3. **Test idempotency:**
   ```bash
   npm run migrate
   npm run migrate  # Run twice
   ```
   Expected: Second run should skip 027 (already applied) with no errors

4. **Verify no data loss:**
   ```bash
   sqlite3 data/data.db "SELECT COUNT(*) FROM review_action"
   ```
   Expected: Same row count before and after migration

### Validation Queries

```sql
-- Verify table structure
PRAGMA table_info(review_action);
-- created_at should be INTEGER type

-- Verify indexes exist
SELECT name FROM sqlite_master
WHERE type='index' AND tbl_name='review_action';
-- Should include idx_review_action_app_time, idx_review_moderator

-- Verify migration recorded
SELECT version, name, datetime(applied_at, 'unixepoch') as applied
FROM schema_migrations
WHERE version = '027';
```

## Rollback Plan

If the migration fails or causes issues:

### Option 1: Quick Rollback (Pre-Migration State)

1. **Stop the application:**
   ```bash
   pm2 stop pawtech
   ```

2. **Restore from backup:**
   The migration runner creates automatic backups before applying migrations.
   ```bash
   ls -lt data/data.db.backup-*
   cp data/data.db.backup-TIMESTAMP data/data.db
   ```

3. **Revert file rename:**
   ```bash
   cd /Users/bash/Documents/pawtropolis-tech/migrations
   git checkout 2025-10-20_review_action_free_text.ts
   rm 027_review_action_free_text.ts
   ```

4. **Restart application:**
   ```bash
   pm2 start pawtech
   ```

### Option 2: Manual Schema Fix

If the migration partially completed:

1. **Check schema_migrations table:**
   ```sql
   SELECT * FROM schema_migrations WHERE version = '027';
   ```

2. **If recorded but schema corrupted, manually drop and restore:**
   ```sql
   -- Remove migration record
   DELETE FROM schema_migrations WHERE version = '027';

   -- Restore from backup
   -- (Then re-run migration)
   ```

### Option 3: Forward Fix

If the migration succeeded but introduced bugs:

1. Create a new migration `028_fix_review_action.ts` to correct issues
2. Do NOT rollback - always move forward with migrations in production

## Success Criteria

- [ ] Migration file renamed to `027_review_action_free_text.ts`
- [ ] Export function renamed to `migrate027ReviewActionFreeText`
- [ ] Migration detected by `npm run migrate:dry`
- [ ] Migration applies successfully without errors
- [ ] Migration is idempotent (can run multiple times safely)
- [ ] `schema_migrations` table contains version `027` record
- [ ] `review_action` table has correct schema (INTEGER created_at, no CHECK constraint)
- [ ] No data loss (row counts match before/after)
- [ ] README.md documents numbering gaps
- [ ] Changes committed to version control

## Notes

- This migration may have already been applied manually to production (given the date prefix of 2025-10-20). If so, the migration's idempotency checks should detect this and skip the schema changes.
- The gaps in numbering (006, 007, 009, 014-016) are cosmetic and don't affect functionality, but should be documented for clarity.
- Future migrations should continue sequentially from 027 onward.

## References

- **Migration runner:** `/scripts/migrate.ts` (line 106: filters for `^\d{3}_` pattern)
- **Migration README:** `/migrations/README.md` (naming conventions)
- **Codebase audit:** `/docs/CODEBASE_AUDIT_2025-11-30.md` (Issue #23)
