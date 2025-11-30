# Roadmap: Delete Dead File `forumThreadNotify.ts`

**Issue ID:** #4
**Type:** Dead Code Cleanup
**Priority:** Low
**Effort:** 15 minutes

## Issue Summary

The file `src/events/forumThreadNotify.ts` (~230 lines) is completely unused. It exports `handleForumThreadCreate()` and `registerForumThreadNotifyHandler()` but neither function is imported or called anywhere in the codebase.

The active implementation is `src/events/forumPostNotify.ts`, which is properly integrated into the event system via `src/index.ts` (line 1532). The active version also includes critical retry logic for Discord race conditions (error 10008) that the dead file lacks.

## Current State

### What's Wrong
- **Dead file:** `src/events/forumThreadNotify.ts` (230 lines)
- **Unused exports:** `handleForumThreadCreate()`, `registerForumThreadNotifyHandler()`
- **No imports:** Grep confirms no other files import these functions
- **Active alternative exists:** `forumPostNotify()` in `src/events/forumPostNotify.ts`

### Key Differences
The dead file is an older implementation that lacks:
- Retry logic for Discord race condition (error 10008) when starter message isn't ready
- Direct integration with the modern event wrapping system (`wrapEvent`)
- The registration pattern used (manual `client.on()` wrapper) vs inline event handler

The active `forumPostNotify.ts` includes:
```typescript
// Lines 43-57: Retry logic for Discord race condition
if (err.code === 10008) {
  logger.info(..., "starter message not ready, retrying in 2s");
  await new Promise((resolve) => setTimeout(resolve, 2000));
  // ... retry logic
}
```

## Proposed Changes

### Step-by-Step Removal

1. **Verify no imports** (safety check)
   ```bash
   grep -r "forumThreadNotify" --include="*.ts" --include="*.js" src/
   ```
   Expected: Only finds the file itself and the audit doc

2. **Delete the file**
   ```bash
   rm src/events/forumThreadNotify.ts
   ```

3. **Verify build passes**
   ```bash
   npm run build
   ```

4. **Commit the change**
   ```bash
   git add -u src/events/forumThreadNotify.ts
   git commit -m "Remove dead file forumThreadNotify.ts (unused, replaced by forumPostNotify.ts)"
   ```

## Files Affected

### Deleted
- `/Users/bash/Documents/pawtropolis-tech/src/events/forumThreadNotify.ts` (entire file)

### No Changes Required
- `src/events/forumPostNotify.ts` - Active implementation (already in use)
- `src/index.ts` - Already using `forumPostNotify()`, not the dead file

## Testing Strategy

### Pre-Delete Verification
1. Run grep to confirm no imports: `grep -r "handleForumThreadCreate\|registerForumThreadNotifyHandler" src/`
2. Check TypeScript references: `npm run build` should succeed before deletion

### Post-Delete Verification
1. **Build check:** `npm run build` - Must pass with no errors
2. **Runtime test:** Start bot in dev mode, create a forum post in configured channel
3. **Verify notification:** Confirm role ping appears in thread (proves active implementation works)
4. **Log check:** Verify `[forumPostNotify]` logs appear (not `[forumThreadNotify]`)

### Expected Behavior
- No change in functionality - forum notifications continue working via `forumPostNotify.ts`
- Build completes successfully
- No TypeScript errors about missing imports

## Rollback Plan

If deletion causes unexpected issues:

1. **Restore from git:**
   ```bash
   git checkout HEAD~1 -- src/events/forumThreadNotify.ts
   git commit -m "Revert: restore forumThreadNotify.ts"
   ```

2. **Alternative: Restore from audit branch** (if committed there)
   ```bash
   git show <commit-hash>:src/events/forumThreadNotify.ts > src/events/forumThreadNotify.ts
   ```

3. **Verify restoration:**
   ```bash
   npm run build
   git status
   ```

### Why Rollback is Safe
- File has complete git history
- No database migrations or config changes involved
- Active implementation is separate file with no dependencies on dead code
- Can restore file in under 30 seconds if needed

## Notes

- This is purely a cleanup task - no functional changes expected
- The active implementation (`forumPostNotify.ts`) is superior due to race condition handling
- No need to update documentation (dead file was never documented as official handler)
- Consider this a low-priority cleanup that improves code maintainability
