# Issue #72: Fix Empty Catch Block in forumPostNotify.ts

**Status:** Completed
**Priority:** Critical
**Type:** Bug Fix / Error Handling
**Estimated Effort:** 10 minutes

---

## Summary

Empty catch block at `src/events/forumPostNotify.ts:122` completely swallows errors when sending fallback messages for non-mentionable roles.

## Current State

```typescript
try {
  await thread.send({
    content: `New feedback post by ${starterMessage.author} - role <@&${roleId}> (not mentionable): ${threadUrl}`,
    allowedMentions: SAFE_ALLOWED_MENTIONS
  });
} catch {}
```

## Impact

- Staff will not be notified about new forum posts if the fallback fails
- No logging of why the fallback failed
- Silent failures make debugging impossible

## Proposed Changes

```typescript
try {
  await thread.send({
    content: `New feedback post by ${starterMessage.author} - role <@&${roleId}> (not mentionable): ${threadUrl}`,
    allowedMentions: SAFE_ALLOWED_MENTIONS
  });
} catch (err) {
  logger.warn({ err, threadId: thread.id, roleId }, "[forumPostNotify] fallback message failed");
}
```

## Files Affected

- `src/events/forumPostNotify.ts:122`

## Testing Strategy

1. Test forum post notification with mentionable role
2. Test forum post notification with non-mentionable role
3. Verify fallback errors are logged
