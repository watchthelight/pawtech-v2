# Issue #51: Add Missing recordMigration() Calls

**Status:** Completed
**Priority:** Critical
**Type:** Bug Fix
**Estimated Effort:** 45 minutes

---

## Summary

10 migration files are missing `recordMigration()` calls, causing them to potentially re-run on every deployment since they're not recorded in `schema_migrations`.

## Affected Migrations

1. `011_add_custom_status_column.ts`
2. `012_add_db_backups_table.ts`
3. `013_add_health_alerts_table.ts`
4. `020_add_message_activity_table.ts`
5. `021_add_modmail_message_content.ts`
6. `022_transcript_index.ts`
7. `023_user_activity_indexes.ts`
8. `024_review_action_index.ts`
9. `026_sync_marker.ts`
10. `028_review_action_free_text.ts`

## Proposed Changes

Option A (Preferred): Add `recordMigration(db, "XXX", "migration_name")` to each affected migration

Option B: Update `scripts/migrate.ts` to auto-record migrations after successful execution

## Testing Strategy

1. Run migrations on test database
2. Verify each migration is recorded in `schema_migrations`
3. Run migrations again to confirm idempotency
