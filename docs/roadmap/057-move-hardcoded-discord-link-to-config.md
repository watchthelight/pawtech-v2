# Issue #57: Move Hardcoded Discord Link to Config

**Status:** Completed
**Priority:** Medium
**Type:** Enhancement
**Estimated Effort:** 20 minutes

---

## Summary

`levelRewards.ts:243` contains a hardcoded Discord support link with guild/channel/message IDs that won't work for other guilds.

## Current State

```typescript
dmMessage += `...Open a support ticket: https://discord.com/channels/896070888594759740/1103728856294236160/1243749041062547591`;
```

## Proposed Changes

1. Add `support_channel_id` to guild_config (or reuse existing config)
2. Generate support link dynamically from guild config
3. Provide fallback message if not configured

## Files Affected

- `src/features/levelRewards.ts:243`
- `src/lib/config.ts` (add new column if needed)
- Migration for new column (if needed)

## Testing Strategy

1. Test DM with configured support channel
2. Test DM with no support channel configured (fallback)
