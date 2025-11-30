# Issue #67: Cleanup Test Data from Production Database

**Status:** Completed
**Priority:** High
**Type:** Data Cleanup
**Estimated Effort:** 15 minutes

---

## Summary

Production database contains test guild configurations with fake IDs like `test-guild-time-*` that cause stale alert errors.

## Current State

Bot logs show errors when stale alert scheduler tries to process test guilds:

```
DiscordAPIError[50035]: Invalid Form Body
channel_id[NUMBER_TYPE_COERCE]: Value "channel-123" is not snowflake.
guildId: "test-guild-time-1761001213622"
reviewChannelId: "channel-123"
```

This indicates test data was left in the database from unit tests or development.

## Proposed Changes

1. Create cleanup script:

```typescript
// scripts/cleanup-test-data.ts
import Database from "better-sqlite3";

const db = new Database("./data/data.db");

// Find test guilds
const testGuilds = db.prepare(`
  SELECT guild_id FROM guild_config
  WHERE guild_id LIKE 'test-%'
     OR guild_id LIKE 'mock-%'
     OR review_channel_id = 'channel-123'
`).all();

console.log(`Found ${testGuilds.length} test guild configs to remove`);

// Remove test data
const deleteConfig = db.prepare("DELETE FROM guild_config WHERE guild_id = ?");
const deleteApps = db.prepare("DELETE FROM application WHERE guild_id = ?");
const deleteActions = db.prepare("DELETE FROM review_action WHERE guild_id = ?");

for (const { guild_id } of testGuilds) {
  console.log(`Removing test guild: ${guild_id}`);
  deleteActions.run(guild_id);
  deleteApps.run(guild_id);
  deleteConfig.run(guild_id);
}

console.log("Cleanup complete");
```

2. Run cleanup:

```bash
npx tsx scripts/cleanup-test-data.ts
```

3. Add validation to prevent future test data:

```typescript
// In guild config insert/update
if (guild_id.startsWith('test-') || guild_id.startsWith('mock-')) {
  throw new Error("Cannot save test guild to production database");
}
```

## Files Affected

- `scripts/cleanup-test-data.ts` (new)
- `src/lib/config.ts` (add validation)

## Testing Strategy

1. Backup database before cleanup
2. Run cleanup script
3. Verify stale alert errors stop
4. Run bot and check logs are clean
