# Roadmap: Remove Hardcoded Role IDs

**Issue #25**: Hardcoded Role IDs
**Type**: Portability Fix
**Priority**: Medium
**Estimated Effort**: 2-3 hours

## Issue Summary

The codebase contains hardcoded Discord role IDs that make the bot server-specific and prevent it from working correctly when deployed to other servers. These hardcoded values appear in user-facing messages and functional code.

## Current State

### What's Wrong

Three locations contain hardcoded role IDs:

1. **`/src/commands/config.ts:881-904`** - Bot Dev role hardcoded in user message
   - Role ID `1120074045883420753` (Bot Dev) in response message
   - Role ID `896070888762535969` (Gatekeeper) in documentation comments
   - Message: `Bot Dev role (<@&1120074045883420753>) will...`

2. **`/src/features/review/card.ts:892-893`** - Both roles hardcoded in application logic
   - Gatekeeper role has fallback: `guildCfg?.gatekeeper_role_id ?? "896070888762535969"`
   - Bot Dev role is fully hardcoded: `const botDevRoleId = "1120074045883420753"`

3. **`/src/commands/backfill.ts:44`** - Bot Dev role hardcoded for notifications
   - `NOTIFICATION_ROLE_ID = '1120074045883420753'`
   - Comment acknowledges: "If this bot ever runs on other servers, these should move to per-guild config"

### Why This Is a Problem

- Bot cannot be deployed to other Discord servers without code changes
- User-facing messages reference roles that may not exist
- Violates the multi-guild design pattern already established (see `gatekeeper_role_id` config)
- Creates maintenance burden when role IDs change

## Proposed Changes

### Step 1: Add `bot_dev_role_id` to Guild Config Schema

**File**: `/src/lib/config.ts`

Add new optional field to `GuildConfig` interface:
```typescript
bot_dev_role_id?: string | null;
```

Update the `SAFE_COLUMNS` array to include `"bot_dev_role_id"`.

### Step 2: Create Database Migration

**File**: `/migrations/019_add_bot_dev_role_id.ts` (new file)

Create migration to add `bot_dev_role_id` column to `guild_config` table:
```typescript
ALTER TABLE guild_config ADD COLUMN bot_dev_role_id TEXT DEFAULT NULL
```

Migration should follow the pattern established in `migrations/018_add_ping_dev_on_app.ts`.

### Step 3: Add Configuration Command

**File**: `/src/commands/config.ts`

Add new subcommand handler `executeSetBotDevRole` (similar to `executeSetGatekeeperRole`):
- Accept a role parameter
- Store role ID in `guild_config.bot_dev_role_id`
- Return confirmation message without hardcoded role ID

Update the slash command builder to include the new subcommand.

### Step 4: Update Application Review Card Logic

**File**: `/src/features/review/card.ts:893`

Replace hardcoded Bot Dev role ID with config lookup:
```typescript
// Before:
const botDevRoleId = "1120074045883420753";

// After:
const botDevRoleId = guildCfg?.bot_dev_role_id;
```

Update logic to handle case where `bot_dev_role_id` is not configured:
- If `ping_dev_on_app` is enabled but `bot_dev_role_id` is null, skip dev ping
- Log warning when config is incomplete

### Step 5: Update Config Ping Dev Message

**File**: `/src/commands/config.ts:904`

Remove hardcoded role mention from user-facing message:
```typescript
// Before:
content: `Bot Dev role ping on new applications: ${statusText}\n\nBot Dev role (<@&1120074045883420753>) will ${enabled ? "now be" : "no longer be"} pinged when new applications are submitted.`

// After:
const botDevRoleId = getConfig(interaction.guildId!)?.bot_dev_role_id;
const roleMention = botDevRoleId ? `<@&${botDevRoleId}>` : "the configured Bot Dev role";
content: `Bot Dev role ping on new applications: ${statusText}\n\n${roleMention} will ${enabled ? "now be" : "no longer be"} pinged when new applications are submitted.`
```

Alternatively, simplify to avoid role mention entirely:
```typescript
content: `Bot Dev role ping on new applications: ${statusText}`
```

### Step 6: Update Backfill Command

**File**: `/src/commands/backfill.ts:44`

Replace hardcoded `NOTIFICATION_ROLE_ID` with config lookup:
```typescript
// Before:
const NOTIFICATION_ROLE_ID = '1120074045883420753';

// After:
const config = getConfig(guildId!);
const notificationRoleId = config?.bot_dev_role_id;
```

Update notification logic to handle missing role ID:
- If `bot_dev_role_id` is not configured, send notification without role mention
- Or skip notification entirely with a warning log

### Step 7: Remove Documentation Comments

**File**: `/src/commands/config.ts:881-882`

Remove hardcoded role IDs from documentation:
```typescript
// Remove these lines:
*  - Bot Dev role: 1120074045883420753
*  - Gatekeeper role: 896070888762535969
```

### Step 8: Add Default Configuration

**File**: `/src/db/db.ts`

Add column initialization helper (similar to existing pattern):
```typescript
addColumnIfMissing("guild_config", "bot_dev_role_id", "TEXT");
```

## Files Affected

### Modified Files
1. `/src/lib/config.ts` - Add `bot_dev_role_id` field to interface and safe columns
2. `/src/commands/config.ts` - Add subcommand, update message, remove hardcoded IDs
3. `/src/features/review/card.ts` - Replace hardcoded role ID with config lookup
4. `/src/commands/backfill.ts` - Replace hardcoded role ID with config lookup
5. `/src/db/db.ts` - Add column initialization

### New Files
6. `/migrations/019_add_bot_dev_role_id.ts` - Database migration

### Test Files
7. `/tests/utils/dbFixtures.ts` - Add `bot_dev_role_id` to schema

## Testing Strategy

### Unit Tests
- Test `upsertConfig` with `bot_dev_role_id` parameter
- Test `getConfig` returns `bot_dev_role_id` correctly
- Verify SAFE_COLUMNS includes new field

### Integration Tests
1. **Config Command Testing**
   - Run `/config set-bot-dev-role` with valid role
   - Verify role ID is stored in database
   - Verify confirmation message is appropriate

2. **Application Review Testing**
   - Create test application with `bot_dev_role_id` configured
   - Verify correct role is pinged when `ping_dev_on_app` is enabled
   - Test with `bot_dev_role_id` set to NULL
   - Test with `ping_dev_on_app` disabled

3. **Backfill Command Testing**
   - Run backfill with `bot_dev_role_id` configured
   - Run backfill without `bot_dev_role_id` configured
   - Verify notifications work in both cases

4. **Migration Testing**
   - Run migration on fresh database
   - Run migration on existing database with data
   - Verify column exists and defaults to NULL

### Manual Testing
1. Deploy to test server without existing role configuration
2. Configure Bot Dev role via `/config set-bot-dev-role`
3. Test application submission flow
4. Test `/config ping-dev-on-app` toggle
5. Verify messages display correctly

## Rollback Plan

### Database Rollback
If issues arise, the column can be safely ignored:
- Old code will continue to use hardcoded values
- New column doesn't break existing functionality
- No data migration required for rollback

### Code Rollback
```bash
git revert <commit-hash>
git push origin main
```

### Migration Rollback
Create reverse migration `019_rollback_bot_dev_role_id.ts`:
```sql
-- Note: SQLite doesn't support DROP COLUMN directly
-- Column can remain in database without issues
-- Or use table recreation pattern if necessary
```

### Fallback Strategy
If severe issues occur in production:
1. Revert code changes via git
2. Leave database column in place (safe to ignore)
3. Investigate issues in staging environment
4. Re-deploy with fixes

## Post-Deployment Tasks

1. Configure `bot_dev_role_id` in production via `/config set-bot-dev-role`
2. Monitor logs for warnings about missing role configuration
3. Update deployment documentation to include role configuration step
4. Consider similar audit for other hardcoded IDs (channels, etc.)

## Notes

- This fix follows the existing pattern established by `gatekeeper_role_id`
- Consider adding validation to ensure role exists in guild before saving
- Future work: Audit for hardcoded channel IDs (see `NOTIFICATION_CHANNEL_ID` in backfill.ts)
- The `gatekeeper_role_id` fallback in card.ts can also be removed once all guilds are configured
