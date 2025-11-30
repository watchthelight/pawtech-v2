# Issue #76: Migrate send.ts to Structured Logging

**Status:** Completed
**Priority:** High
**Type:** Code Quality / Observability
**Estimated Effort:** 15 minutes

---

## Summary

`src/commands/send.ts` uses console.warn/error for error conditions instead of structured logger, losing context for debugging.

## Current State

```typescript
// Line 141
console.warn(`[send] Logging channel ${loggingChannelId} is not a text channel`);

// Line 179
console.warn(`[send] Failed to send audit log: ${err}`);

// Line 272
console.warn(`[send] Failed to fetch reply_to message ${replyToId}: ${err}`);

// Line 289
console.error(`[send] Failed to send message: ${err}`);
```

## Impact

- Errors lack structured context (no guildId, userId, channelId)
- Can't filter/alert on these in monitoring systems
- Error objects not properly serialized (just stringified)
- Missing correlation IDs for debugging

## Proposed Changes

```typescript
// Line 141
logger.warn({ loggingChannelId, channelType: channel?.type, guildId: interaction.guildId },
  "[send] Logging channel is not a text channel");

// Line 179
logger.warn({ err, channelId: loggingChannelId, guildId: interaction.guildId },
  "[send] Failed to send audit log");

// Line 272
logger.warn({ err, replyToId, channelId: interaction.channelId },
  "[send] Failed to fetch reply_to message");

// Line 289
logger.error({ err, channelId: interaction.channelId, userId: interaction.user.id, guildId: interaction.guildId },
  "[send] Failed to send message");
```

## Files Affected

- `src/commands/send.ts:141,179,272,289`

## Testing Strategy

1. Test /send command works correctly
2. Trigger error conditions and verify structured logs
3. Check Sentry receives error events
