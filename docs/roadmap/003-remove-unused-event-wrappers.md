# Issue #3: Remove Unused Event Wrapper Variants

**Status:** Proposed
**Impact:** Code cleanup, -91 lines
**Risk:** Low
**Category:** Dead Code Removal

## Summary

Two event wrapper variants in `src/lib/eventWrap.ts` are exported but never used:
- `wrapEventWithTiming` (lines 106-158, 53 lines)
- `wrapEventRateLimited` (lines 227-264, 38 lines)

While `wrapEventRateLimited` is imported in `src/index.ts:76`, it's never actually called. The bot exclusively uses the base `wrapEvent` function for all event handlers.

## Current State

### What's Wrong
- **Dead Code:** 91 lines of exported but unused functionality
- **Misleading API:** Functions appear available but aren't battle-tested
- **Import Pollution:** `wrapEventRateLimited` imported but never invoked
- **Maintenance Burden:** Code that must be maintained despite no usage

### Why It Exists
These variants were likely written as future-proofing:
- `wrapEventWithTiming`: Performance monitoring for slow event handlers
- `wrapEventRateLimited`: Protection against event spam/flood attacks

However, production usage shows the base `wrapEvent` with timeout protection is sufficient.

## Proposed Changes

### Step 1: Verify No Hidden Usage
```bash
# Search entire codebase for any calls (not just imports)
grep -r "wrapEventWithTiming(" src/
grep -r "wrapEventRateLimited(" src/
```

Expected: No results (already verified in audit)

### Step 2: Remove Functions
**File:** `/Users/bash/Documents/pawtropolis-tech/src/lib/eventWrap.ts`

- Delete lines 106-158 (`wrapEventWithTiming` function + JSDoc)
- Delete lines 227-264 (`wrapEventRateLimited` function + JSDoc)

### Step 3: Clean Up Import
**File:** `/Users/bash/Documents/pawtropolis-tech/src/index.ts`

Line 76 currently reads:
```typescript
import { wrapEvent, wrapEventRateLimited } from "./lib/eventWrap.js";
```

Change to:
```typescript
import { wrapEvent } from "./lib/eventWrap.js";
```

### Step 4: Update File Header Comments
**File:** `/Users/bash/Documents/pawtropolis-tech/src/lib/eventWrap.ts`

Update lines 5-6 to remove references to removed variants:
```typescript
 * FLOWS:
 *  - wrapEvent(name, handler) → wrapped handler that catches errors
```

## Files Affected

1. **`/Users/bash/Documents/pawtropolis-tech/src/lib/eventWrap.ts`**
   - Remove `wrapEventWithTiming` function (53 lines)
   - Remove `wrapEventRateLimited` function (38 lines)
   - Update file header comments
   - Net: -91 lines

2. **`/Users/bash/Documents/pawtropolis-tech/src/index.ts`**
   - Remove `wrapEventRateLimited` from import statement
   - Net: -1 token

## Testing Strategy

### Pre-Removal Verification
```bash
# Confirm no actual usage exists
npm run build
grep -r "wrapEventWithTiming\|wrapEventRateLimited" dist/
```

### Post-Removal Testing
1. **Build Check**
   ```bash
   npm run build
   ```
   Expected: No TypeScript errors

2. **Import Check**
   ```bash
   # Verify no broken imports in built code
   node -c dist/index.js
   ```

3. **Runtime Smoke Test**
   - Start bot in dev environment
   - Trigger any event (e.g., send message in test guild)
   - Verify `wrapEvent` still functions correctly
   - Check logs for no import errors

4. **Type Check**
   ```bash
   npm run typecheck
   ```

### Why Testing is Minimal
- Functions are completely unused (zero callers)
- No behavior changes to active code paths
- TypeScript will catch any missed references at compile time

## Rollback Plan

### If Issues Discovered
If somehow a caller is found during testing:

1. **Immediate Rollback**
   ```bash
   git revert <commit-hash>
   ```

2. **Investigation**
   - Identify which code needs the removed functions
   - Decide: Fix caller OR restore functions

### Backup Location
Git history preserves the original code. To restore:
```bash
git show <commit-before-removal>:src/lib/eventWrap.ts > eventWrap.ts.backup
```

## Success Criteria

- [ ] Build passes without TypeScript errors
- [ ] No runtime import errors in production
- [ ] All event handlers continue working (`wrapEvent` unaffected)
- [ ] 91 lines removed from codebase
- [ ] Import statement cleaned up

## Notes

- This is a pure deletion with zero functional impact
- The base `wrapEvent` function remains untouched
- Consider if timing/rate-limiting features needed in future (re-implement then)
- Good candidate for pairing with other cleanup tasks in same PR
