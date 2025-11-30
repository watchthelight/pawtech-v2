# Issue #77: Add Logging to Silent .catch() Handlers in review handlers

**Status:** Completed
**Priority:** High
**Type:** Code Quality / Observability
**Estimated Effort:** 45 minutes

---

## Summary

`src/features/review/handlers.ts` has 20+ instances of `.catch(() => undefined)` that silently swallow errors, making debugging impossible.

## Current State

```typescript
// Pattern found 20+ times at lines 110, 117, 135, 141, 149, 192, 217, etc.
interaction.reply({ ... }).catch(() => undefined);
replyOrEdit(interaction, { ... }).catch(() => undefined);
```

## Impact

- When review operations fail (approve/reject/kick), developers have no visibility
- Can't distinguish between Discord API issues, permission problems, or code bugs
- Silent failures make production debugging extremely difficult

## Proposed Changes

Add debug-level logging to all catch handlers:

```typescript
// Instead of:
interaction.reply({ ... }).catch(() => undefined);

// Use:
interaction.reply({ ... }).catch((err) => {
  logger.debug({ err, appId: app?.id, action: 'reply' }, "[review] interaction reply failed");
});
```

Consider creating a helper function:

```typescript
function safeReply(interaction: Interaction, options: InteractionReplyOptions, context: object) {
  return interaction.reply(options).catch((err) => {
    logger.debug({ err, ...context }, "[review] interaction reply failed");
  });
}
```

## Files Affected

- `src/features/review/handlers.ts` (20+ locations)

## Testing Strategy

1. Test all review actions still work
2. Test expired interaction handling (should log at debug level)
3. Verify no spam in production logs (debug level filtered)
