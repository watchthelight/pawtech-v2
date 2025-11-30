# Issue #19: Remove Unused Avatar Scan Functions

**Status:** Proposed
**Impact:** Code cleanup, -70 lines
**Risk:** Low
**Category:** Dead Code Removal

## Summary

Two functions in `src/features/avatarScan.ts` are exported but never used in production code:
- `storeScan` (lines 234-294, ~61 lines) - persists avatar scan results to SQLite
- `buildReverseImageUrl` (lines 372-400, ~29 lines) - builds reverse image search URLs from templates

While `buildReverseImageUrl` has test coverage, neither function is called by any production code. The `storeScan` function has zero references anywhere in the codebase.

## Current State

### What's Wrong
- **Dead Code:** 90 lines of exported but unused functionality
- **Misleading API:** Functions appear available but aren't used by the application
- **Test Waste:** `buildReverseImageUrl` has tests (`tests/review/avatarScanField.test.ts`, `tests/avatarScan/reverseLink.test.ts`) but no production usage
- **Maintenance Burden:** Code that must be maintained despite providing no value
- **Confusion:** File header documentation mentions `buildReverseImageUrl` in FLOWS (line 8) but it's unused

### Why It Exists
These functions were likely built for planned features:
- `storeScan`: Intended to cache avatar scan results in database for review cards
- `buildReverseImageUrl`: Template-based reverse image search URL generation for reviewers

The codebase currently uses `googleReverseImageUrl()` (line 358) for reverse image search instead, which is simpler and doesn't require guild config templates.

### Current Usage
- `storeScan`: 0 references (production or tests)
- `buildReverseImageUrl`: 2 test files only, 0 production usage
- `googleReverseImageUrl`: Actual function used in production (likely)

## Proposed Changes

### Step 1: Verify No Hidden Usage
```bash
# Confirm no production usage exists
grep -r "storeScan(" src/ --exclude-dir=__tests__
grep -r "buildReverseImageUrl(" src/ --exclude-dir=__tests__
```

Expected: No results (already verified in audit)

### Step 2: Remove Test Files
Since `buildReverseImageUrl` only exists to support tests, remove the tests first:

**Files to delete:**
- `/Users/bash/Documents/pawtropolis-tech/tests/review/avatarScanField.test.ts`
- `/Users/bash/Documents/pawtropolis-tech/tests/avatarScan/reverseLink.test.ts`

### Step 3: Remove Functions
**File:** `/Users/bash/Documents/pawtropolis-tech/src/features/avatarScan.ts`

- Delete lines 234-294 (`storeScan` function + JSDoc)
- Delete lines 372-400 (`buildReverseImageUrl` function + JSDoc)
- Remove helper functions if no longer needed:
  - Check if `serializeEvidence` (lines 207-220) is used elsewhere
  - Check if `deserializeEvidence` (lines 222-232) is used elsewhere
  - These are likely only used by `storeScan`, so remove them too

### Step 4: Update File Header Comments
**File:** `/Users/bash/Documents/pawtropolis-tech/src/features/avatarScan.ts`

Update lines 5-8 to remove references to removed functions:
```typescript
 * FLOWS:
 *  - scanAvatar(): resolve URL → Google Vision API → return scores
 *  - getScan(): read stored scores for a given application_id from SQLite
```

Remove the line about `buildReverseImageUrl`.

### Step 5: Clean Up Unused Imports/Types
Check if `GuildConfig` import (line 14) is still needed after removing `storeScan` and `buildReverseImageUrl`. If not, remove it.

## Files Affected

1. **`/Users/bash/Documents/pawtropolis-tech/src/features/avatarScan.ts`**
   - Remove `storeScan` function (~61 lines)
   - Remove `buildReverseImageUrl` function (~29 lines)
   - Remove `serializeEvidence` helper (~14 lines)
   - Remove `deserializeEvidence` helper (~11 lines)
   - Update file header comments
   - Possibly remove `GuildConfig` import
   - Net: ~115 lines

2. **`/Users/bash/Documents/pawtropolis-tech/tests/review/avatarScanField.test.ts`**
   - Delete entire file (~71 lines)

3. **`/Users/bash/Documents/pawtropolis-tech/tests/avatarScan/reverseLink.test.ts`**
   - Delete entire file (~47 lines)

**Total cleanup:** ~233 lines of code and tests

## Testing Strategy

### Pre-Removal Verification
```bash
# Confirm no actual production usage
npm run build
grep -r "storeScan\|buildReverseImageUrl" dist/ --exclude="*.map"
```

### Post-Removal Testing
1. **Build Check**
   ```bash
   npm run build
   ```
   Expected: No TypeScript errors

2. **Type Check**
   ```bash
   npm run typecheck
   ```

3. **Test Suite**
   ```bash
   npm test
   ```
   Expected: All remaining tests pass

4. **Runtime Smoke Test**
   - Start bot in dev environment
   - Trigger avatar scan flow (submit an application)
   - Verify `scanAvatar()` and `getScan()` still work correctly
   - Check that `googleReverseImageUrl()` is used for reverse image search
   - Verify no import or runtime errors

### Why Testing is Minimal
- Functions are completely unused in production (zero callers)
- Tests being removed only test the unused functions
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
   - Decide: Fix caller to use `googleReverseImageUrl()` OR restore functions

### Backup Location
Git history preserves the original code. To restore:
```bash
# Restore source file
git show <commit-before-removal>:src/features/avatarScan.ts > avatarScan.ts.backup

# Restore test files
git show <commit-before-removal>:tests/review/avatarScanField.test.ts > avatarScanField.test.ts.backup
git show <commit-before-removal>:tests/avatarScan/reverseLink.test.ts > reverseLink.test.ts.backup
```

## Success Criteria

- [ ] Build passes without TypeScript errors
- [ ] No runtime import errors in production
- [ ] Avatar scanning continues working (`scanAvatar`, `getScan` unaffected)
- [ ] ~233 lines removed from codebase (code + tests)
- [ ] File header documentation updated
- [ ] All remaining tests pass

## Notes

- This is a pure deletion with zero functional impact on production code
- The active functions (`scanAvatar`, `getScan`, `googleReverseImageUrl`) remain untouched
- Consider documenting why `googleReverseImageUrl` was chosen over `buildReverseImageUrl`
- If template-based reverse image search is needed in future, can be re-implemented then
- Good candidate for pairing with other dead code cleanup tasks in same PR
