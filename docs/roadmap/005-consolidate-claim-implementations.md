# Issue #5: Consolidate Duplicate Claim Management Implementations

**Status:** Planned
**Priority:** Medium
**Estimated Effort:** 2-3 hours
**Created:** 2025-11-30

## Summary

Two separate claim management implementations exist in the codebase with overlapping functionality but different reliability characteristics. This creates maintenance burden and increases risk of bugs due to inconsistent behavior.

## Current State

### Problem
We have two files implementing similar claim management functions:

1. **`src/features/reviewActions.ts:24-267`** (Robust Implementation)
   - Transactional operations using `db.transaction()`
   - Panic mode integration checks
   - Comprehensive error handling with typed `ClaimError` class
   - Audit trail logging to `review_action` table
   - Functions: `claimTx()`, `unclaimTx()`, `getClaim()`, `clearClaim()`, `claimGuard()`

2. **`src/features/review/claims.ts:1-101`** (Legacy Implementation)
   - Non-transactional operations
   - No panic mode checks
   - Has explicit race condition warning in comments
   - `upsertClaim()` function has **zero references** (dead code)
   - Functions: `getClaim()`, `getReviewClaim()`, `upsertClaim()`, `clearClaim()`, `claimGuard()`, `CLAIMED_MESSAGE()`

### Current Usage Analysis

**reviewActions.ts** is the active implementation:
- `claimTx()` and `unclaimTx()` are imported by `src/features/review/handlers.ts` (lines 803, 910)
- Used for all actual claim/unclaim operations in button handlers

**claims.ts** functions are used for read-only operations:
- `getClaim()` imported by `handlers.ts` for claim guard checks (line 56)
- `claimGuard()` imported by `handlers.ts` for authorization (line 57)
- `clearClaim()` imported by `handlers.ts` but only used for post-resolution cleanup
- `upsertClaim()` has **zero references** - dead code
- Re-exported by `src/features/review.ts` but only for backwards compatibility

### Risk Assessment
- **Race Conditions:** claims.ts explicitly warns about race conditions in `upsertClaim()` (line 75-76)
- **Inconsistent Behavior:** Two `clearClaim()` implementations with different return types (boolean vs void)
- **No Panic Mode Protection:** claims.ts operations ignore panic mode state
- **Dead Code:** `upsertClaim()` serves no purpose
- **Maintenance Confusion:** Developers must know which implementation to use

## Proposed Changes

### Step 1: Audit All Import Sites
**Goal:** Map complete usage of both files

```bash
# Search for all imports
grep -r "from.*reviewActions" src/
grep -r "from.*review/claims" src/
```

Document every import location and which specific functions are used.

### Step 2: Migrate claims.ts Functions to reviewActions.ts
**Goal:** Create single source of truth with consistent implementations

Add to `src/features/reviewActions.ts`:

1. **`CLAIMED_MESSAGE` constant** (currently only in claims.ts)
   ```typescript
   export const CLAIMED_MESSAGE = (userId: string) =>
     `This application is claimed by <@${userId}>. Ask them to finish or unclaim it.`;
   ```

2. **`getReviewClaim()` function** (if still needed - may be redundant with `getClaim()`)
   - Evaluate if this is just an alias for `getClaim()`
   - If different, document why and add to reviewActions.ts
   - If same, mark for removal

3. **Update `claimGuard()`**
   - Align message format with `CLAIMED_MESSAGE` constant for consistency
   - Current implementations have slightly different wording

### Step 3: Update Import Statements
**Goal:** Point all consumers to reviewActions.ts

Update these files:
- `src/features/review/handlers.ts`
- `src/features/review.ts` (re-exports)
- Any test files

```typescript
// OLD
import { getClaim, claimGuard, clearClaim } from "./review/claims.js";

// NEW
import { getClaim, claimGuard, clearClaim } from "../reviewActions.js";
```

### Step 4: Remove Dead Code
**Goal:** Delete `upsertClaim()` and verify no hidden dependencies

1. Confirm `upsertClaim()` has zero references:
   ```bash
   grep -r "upsertClaim" src/ tests/
   ```

2. Remove function from claims.ts (lines 80-90)

### Step 5: Deprecate and Remove claims.ts
**Goal:** Eliminate duplicate file

1. Add deprecation notice at top of claims.ts:
   ```typescript
   /**
    * @deprecated This file is deprecated. Use src/features/reviewActions.ts instead.
    * Scheduled for removal in next cleanup cycle.
    */
   ```

2. After import migration is complete and tested, delete file entirely

### Step 6: Update Re-exports
**Goal:** Maintain backwards compatibility during transition

In `src/features/review.ts`, update re-exports:

```typescript
// Re-export claims from consolidated source
export {
  CLAIMED_MESSAGE,
  claimGuard,
  getClaim,
  clearClaim,
} from "../reviewActions.js";
```

Remove deprecated `upsertClaim` from re-exports.

## Files Affected

### Modified
- `src/features/reviewActions.ts` - Add CLAIMED_MESSAGE constant and getReviewClaim (if needed)
- `src/features/review/handlers.ts` - Update imports
- `src/features/review.ts` - Update re-exports
- `src/features/review/card.ts` - Update imports (if it uses claims)
- `tests/features/review/claims.test.ts` - Update imports and test consolidated implementation

### Deleted
- `src/features/review/claims.ts` - Remove after migration complete

### Reviewed (no changes needed)
- `src/commands/gate.ts` - Verify it only uses public API from review.ts
- `tests/review/claimGating.test.ts` - Update if it directly imports claims.ts
- `tests/review/slashCommands.test.ts` - Update if it directly imports claims.ts

## Testing Strategy

### Pre-Migration Testing
1. Run existing test suite to establish baseline:
   ```bash
   npm test -- tests/features/review/claims.test.ts
   npm test -- tests/review/claimGating.test.ts
   ```

2. Document all passing tests

### Migration Testing
1. **Unit Tests**
   - Update `tests/features/review/claims.test.ts` to test reviewActions.ts functions
   - Verify all claim guard logic still works
   - Test `CLAIMED_MESSAGE` formatting

2. **Integration Tests**
   - Test claim/unclaim button flows in handlers.ts
   - Verify panic mode blocking still works
   - Confirm audit trail logging to review_action table

3. **Regression Tests**
   - Test concurrent claim attempts (race condition prevention)
   - Verify claim ownership validation
   - Test clearClaim() in both admin and post-resolution contexts

### Post-Migration Validation
```bash
# Verify no lingering imports
grep -r "review/claims" src/
# Should return only deprecation notices

# Run full test suite
npm test

# Check TypeScript compilation
npm run build
```

## Rollback Plan

### If Migration Fails
1. **Immediate Rollback**
   ```bash
   git checkout HEAD -- src/features/review/claims.ts
   git checkout HEAD -- src/features/review/handlers.ts
   git checkout HEAD -- src/features/review.ts
   ```

2. **Restore imports**
   - Revert all import changes to point back to claims.ts
   - Re-export functions from review.ts

3. **Verify baseline**
   ```bash
   npm test
   npm run build
   ```

### If Tests Fail Mid-Migration
1. Keep both files temporarily
2. Use feature flag or environment variable to switch implementations:
   ```typescript
   const USE_NEW_CLAIMS = process.env.USE_CONSOLIDATED_CLAIMS === "true";
   ```
3. Debug in isolated environment
4. Complete migration only after all tests pass

### If Production Issues Occur
1. Review error logs for claim-related failures
2. If claim race conditions detected:
   - Immediate: Re-enable reviewActions.ts (should already be active)
   - Long-term: Do not remove claims.ts until issue resolved
3. If authorization failures detected:
   - Check claimGuard() message format changes
   - Verify getClaim() return type compatibility

## Success Criteria

- [ ] Zero references to `src/features/review/claims.ts` in production code
- [ ] All claim operations use transactional reviewActions.ts functions
- [ ] All tests pass with no regressions
- [ ] TypeScript compilation succeeds
- [ ] No duplicate function definitions
- [ ] Panic mode checks active on all claim operations
- [ ] Audit trail logging consistent across all claim actions
- [ ] Dead code (`upsertClaim`) removed

## Post-Migration Notes

Document in CHANGELOG.md:
```markdown
### Changed
- Consolidated duplicate claim management implementations
- All claim operations now use transactional reviewActions.ts
- Removed race-condition-prone upsertClaim() function
- Unified claim guard messaging

### Removed
- src/features/review/claims.ts (merged into reviewActions.ts)
```

Update handbook/ARCHITECTURE.md:
```markdown
## Claim Management
All claim operations are handled by `src/features/reviewActions.ts`:
- claimTx() - Atomic claim with panic mode check
- unclaimTx() - Atomic unclaim with ownership validation
- getClaim() - Read current claim state
- clearClaim() - Admin override to force-remove claim
- claimGuard() - Authorization check for user actions
```

## Timeline

1. **Day 1:** Audit and planning (Step 1) - 30 minutes
2. **Day 1:** Migration implementation (Steps 2-4) - 1 hour
3. **Day 1:** Testing (complete testing strategy) - 1 hour
4. **Day 2:** Code review and final cleanup (Steps 5-6) - 30 minutes
5. **Day 2:** Documentation updates - 30 minutes

**Total estimated time:** 3.5 hours
