# Issue #79: Move Poke Category IDs to Database Config

**Status:** Completed
**Priority:** High
**Type:** Enhancement / Configuration
**Estimated Effort:** 45 minutes

---

## Summary

`src/commands/poke.ts` contains 10 hardcoded category IDs and 1 excluded channel ID that should be configurable.

## Current State

```typescript
const POKE_CATEGORY_IDS = [
  "896070891539169316",
  "1393461646718140436",
  "1093758499026161775",
  "1403065958645723186",
  "1414693133333135444",
  "1305265295186767994",
  "1107091298642620416",
  "917571574834515989",
  "896070891539169312",
  "1299177155661553674",
];
const EXCLUDED_CHANNEL_ID = "896958848009637929";
```

## Impact

- Command becomes unusable if categories change
- Requires code deployment to update
- Can't use poke in other guilds without code changes

## Proposed Changes

1. Add new columns to guild_config:

```sql
ALTER TABLE guild_config ADD COLUMN poke_category_ids_json TEXT;
ALTER TABLE guild_config ADD COLUMN poke_excluded_channel_ids_json TEXT;
```

2. Update poke.ts:

```typescript
function getPokeConfig(guildId: string): { categoryIds: string[], excludedChannelIds: string[] } {
  const cfg = getGuildConfig(guildId);

  return {
    categoryIds: cfg?.poke_category_ids_json
      ? JSON.parse(cfg.poke_category_ids_json)
      : FALLBACK_CATEGORY_IDS,
    excludedChannelIds: cfg?.poke_excluded_channel_ids_json
      ? JSON.parse(cfg.poke_excluded_channel_ids_json)
      : [FALLBACK_EXCLUDED_CHANNEL_ID],
  };
}
```

3. Add /config subcommand:

```
/config poke add-category <category>
/config poke remove-category <category>
/config poke exclude-channel <channel>
/config poke list
```

## Files Affected

- `src/commands/poke.ts`
- `src/lib/config.ts`
- `src/db/ensure.ts`
- `src/commands/config.ts`

## Testing Strategy

1. Test /poke with configured categories
2. Test fallback to hardcoded values
3. Test /config poke commands
4. Test with excluded channels
