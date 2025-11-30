# Issue #71: Wrap messageCreate Handler with wrapEvent

**Status:** Completed
**Priority:** Critical
**Type:** Bug Fix / Error Handling
**Estimated Effort:** 15 minutes

---

## Summary

The `messageCreate` event handler in `src/index.ts` is NOT wrapped with `wrapEvent()`, meaning failures in modmail routing, activity tracking, and dad mode won't be properly caught.

## Current State

```typescript
// Line 1427 - NOT wrapped
client.on("messageCreate", async (message) => {
  // ... modmail routing and message activity tracking ...
});
```

## Impact

- Failures in message processing won't be caught or logged properly
- No timeout protection
- No Sentry error reporting
- Critical features (modmail) could fail silently

## Proposed Changes

```typescript
client.on("messageCreate", wrapEvent("messageCreate", async (message) => {
  // ... existing logic ...
}));
```

## Files Affected

- `src/index.ts:1427`

## Testing Strategy

1. Test modmail routing still works
2. Test message activity tracking
3. Test dad mode functionality
4. Verify errors are properly caught and logged
