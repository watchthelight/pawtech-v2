# Issue #53: Sync ALLOWED_CONFIG_COLUMNS with GuildConfig Type

**Status:** Completed
**Priority:** High
**Type:** Bug Fix
**Estimated Effort:** 30 minutes

---

## Summary

`ALLOWED_CONFIG_COLUMNS` allowlist in config.ts is missing columns from the GuildConfig type, and has phantom columns that don't exist in the type. This causes silent failures when upserting certain config values.

## Missing from Allowlist

- `leadership_role_id`
- `ping_dev_on_app`
- `review_roles_mode`

## Phantom Columns (in allowlist but not in type)

- `flags_channel_id`
- `silent_first_msg_days`
- `logging_channel_id`
- Multiple notification-related columns

## Proposed Changes

1. Audit actual database schema for guild_config table
2. Update GuildConfig type to match schema
3. Update ALLOWED_CONFIG_COLUMNS to match type
4. Remove any phantom columns or add them to type if they exist

## Files Affected

- `src/lib/config.ts:24-62` (GuildConfig type)
- `src/lib/config.ts:368-381` (ALLOWED_CONFIG_COLUMNS)

## Testing Strategy

1. Verify all columns in allowlist exist in database
2. Test upserting each config column
3. Verify no silent failures in logs
