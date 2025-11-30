# Issue #74: Add Null Checks to Channel Fetch Operations

**Status:** Completed
**Priority:** High
**Type:** Bug Fix
**Estimated Effort:** 30 minutes

---

## Summary

Several channel fetch operations lack proper error handling, which can crash commands if channels are deleted or bot loses access.

## Affected Files

### 1. src/commands/send.ts:138

```typescript
// Current - throws if channel deleted
const loggingChannel = await interaction.client.channels.fetch(loggingChannelId);

// Proposed
const loggingChannel = await interaction.client.channels.fetch(loggingChannelId).catch(() => null);
if (!loggingChannel) {
  logger.warn({ loggingChannelId, guildId: interaction.guildId }, "[send] Logging channel not accessible");
}
```

### 2. src/scheduler/staleApplicationCheck.ts:194

```typescript
// Current - breaks entire cron job if channel missing
const channel = await client.channels.fetch(reviewChannelId);

// Proposed
const channel = await client.channels.fetch(reviewChannelId).catch(() => null);
if (!channel) {
  logger.warn({ reviewChannelId, guildId }, "[stale-alert] Review channel not accessible, skipping guild");
  return;
}
```

### 3. src/lib/configCard.ts:44

```typescript
// Current - throws during config display
const channel = await guild.channels.fetch(targetChannelId);

// Proposed
const channel = await guild.channels.fetch(targetChannelId).catch(() => null);
```

## Impact

- Commands crash with unhandled exceptions
- Scheduled jobs fail completely instead of gracefully skipping
- Poor user experience with cryptic errors

## Files Affected

- `src/commands/send.ts:138`
- `src/scheduler/staleApplicationCheck.ts:194`
- `src/lib/configCard.ts:44`

## Testing Strategy

1. Test with valid channels (should work as before)
2. Test with deleted/inaccessible channels (should handle gracefully)
3. Verify appropriate error logging
