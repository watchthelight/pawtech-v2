# Issue #56: Add Logging to Empty Catch Block in listopen.ts

**Status:** Completed
**Priority:** Low
**Type:** Code Quality
**Estimated Effort:** 5 minutes

---

## Summary

Empty catch block at `listopen.ts:113-115` silently swallows errors, making debugging difficult.

## Current State

```typescript
} catch {
  return "unknown";
}
```

## Proposed Changes

Add debug logging:

```typescript
} catch (error) {
  logger.debug({ error }, "[listopen] Failed to resolve username");
  return "unknown";
}
```

## Files Affected

- `src/commands/listopen.ts:113-115`
