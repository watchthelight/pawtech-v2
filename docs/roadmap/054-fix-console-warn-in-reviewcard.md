# Issue #54: Replace console.warn with Logger in reviewCard.ts

**Status:** Completed
**Priority:** Medium
**Type:** Code Quality
**Estimated Effort:** 10 minutes

---

## Summary

`reviewCard.ts` uses `console.warn` instead of the proper logger, which doesn't integrate with logging infrastructure.

## Current State

- Lines 649, 658 use `console.warn`
- Other files (forumPostNotify.ts) properly use logger

## Proposed Changes

1. Import logger from `../lib/logger.js`
2. Replace `console.warn` with `logger.warn`
3. Structure log data properly with context

## Files Affected

- `src/ui/reviewCard.ts:649, 658`

## Code Change

```typescript
// Before
console.warn(`[reviewCard] Truncated embed...`);

// After
logger.warn({ appId: app.id, removedSections: removedNames }, "[reviewCard] Truncated embed");
```
