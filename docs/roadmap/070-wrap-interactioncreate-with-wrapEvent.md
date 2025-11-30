# Issue #70: Wrap interactionCreate Handler with wrapEvent

**Status:** Completed
**Priority:** Critical
**Type:** Bug Fix / Error Handling
**Estimated Effort:** 15 minutes

---

## Summary

The `interactionCreate` event handler in `src/index.ts` is NOT wrapped with `wrapEvent()` like other event handlers, meaning unhandled errors could crash the bot.

## Current State

```typescript
// Line 778 - NOT wrapped
client.on("interactionCreate", async (interaction) => {
  // ... 650+ lines of routing logic ...
});

// Compare to other handlers (properly wrapped)
client.on("guildCreate", wrapEvent("guildCreate", async (guild) => {
```

## Impact

- Critical interaction routing failures won't be caught, logged, or reported to Sentry
- Unhandled promise rejections could crash the bot
- No timeout protection for slow handlers

## Proposed Changes

```typescript
client.on("interactionCreate", wrapEvent("interactionCreate", async (interaction) => {
  // ... existing 650+ lines of routing logic ...
}));
```

## Files Affected

- `src/index.ts:778`

## Testing Strategy

1. Test all interaction types still work (commands, buttons, modals, selects)
2. Verify errors are properly caught and logged
3. Test Sentry receives error reports
