# Issue #78: Move Artist Rotation IDs to Database Config

**Status:** Completed
**Priority:** High
**Type:** Enhancement / Configuration
**Estimated Effort:** 1 hour

---

## Summary

`src/features/artistRotation/constants.ts` contains 6+ hardcoded Discord IDs that will break if roles are deleted or IDs change.

## Current State

```typescript
export const ARTIST_ROLE_ID = "896070888749940770";
export const AMBASSADOR_ROLE_ID = "896070888762535967";
export const SERVER_ARTIST_CHANNEL_ID = "1131332813585661982";
export const TICKET_ROLES = {
  headshot: "929950578379993108",
  halfbody: "1402298352560902224",
  emoji: "1414982808631377971",
};
```

## Impact

- Entire artist rotation feature breaks if any role is deleted or recreated
- Requires code deployment to update IDs
- Bot cannot be used in other guilds without code changes

## Proposed Changes

1. Add new columns to guild_config table:

```sql
ALTER TABLE guild_config ADD COLUMN artist_role_id TEXT;
ALTER TABLE guild_config ADD COLUMN ambassador_role_id TEXT;
ALTER TABLE guild_config ADD COLUMN server_artist_channel_id TEXT;
ALTER TABLE guild_config ADD COLUMN artist_ticket_roles_json TEXT;
```

2. Update constants.ts to use config:

```typescript
export function getArtistConfig(guildId: string): ArtistRotationConfig | null {
  const cfg = getGuildConfig(guildId);
  if (!cfg?.artist_role_id) return null;

  return {
    artistRoleId: cfg.artist_role_id,
    ambassadorRoleId: cfg.ambassador_role_id,
    serverArtistChannelId: cfg.server_artist_channel_id,
    ticketRoles: cfg.artist_ticket_roles_json ? JSON.parse(cfg.artist_ticket_roles_json) : null,
  };
}
```

3. Add /config subcommand for artist rotation settings

4. Keep existing hardcoded values as fallback for main guild

## Files Affected

- `src/features/artistRotation/constants.ts`
- `src/features/artistRotation/*.ts` (update to use config)
- `src/lib/config.ts` (add new columns)
- `src/db/ensure.ts` (add migrations)
- `src/commands/config.ts` (add artist rotation settings)

## Testing Strategy

1. Test artist rotation with configured values
2. Test fallback to hardcoded values
3. Test /config commands for artist settings
