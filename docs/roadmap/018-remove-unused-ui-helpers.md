# Roadmap: Remove Unused UI Helper Functions

**Issue:** #18 - Unused UI Helper Functions
**Location:** `src/ui/reviewCard.ts`
**Type:** Dead Code Cleanup
**Priority:** Low
**Effort:** 1-2 hours

---

## Problem Summary

The `reviewCard.ts` module exports 7 helper functions that are never used anywhere in the codebase:

- `escapeMd` (line 120) - Escapes markdown characters
- `wrapCode` (line 135) - Wraps text in code blocks with word wrapping
- `truncateAnswer` (line 178) - Truncates answer text with indicator
- `fmtRel` (line 187) - Formats timestamps as relative (e.g., "2h ago")
- `fmtUtc` (line 226) - Formats timestamps as UTC strings
- `fmtLocal` (line 233) - Formats timestamps in local format
- `discordTimestamp` (line 276) - Formats Discord timestamp tags

These functions contribute approximately 50 lines of dead code and create unnecessary maintenance burden. They appear to be remnants from earlier design iterations that have since been replaced by alternative implementations.

---

## Current State

**File:** `/Users/bash/Documents/pawtropolis-tech/src/ui/reviewCard.ts`

### Unused Functions (lines 120-278):

1. **escapeMd** - 10 lines - Markdown escaping utility
2. **wrapCode** - 39 lines - Code block word wrapping
3. **truncateAnswer** - 5 lines - Text truncation with indicator
4. **fmtRel** - 4 lines - Wrapper around `fmtAgeShort` from timefmt module
5. **fmtUtc** - 3 lines - Wrapper around `formatAbsoluteUtc` from timefmt module
6. **fmtLocal** - 11 lines - Local date formatting with Intl API
7. **discordTimestamp** - 3 lines - Discord timestamp tag formatter

### Notes:

- **`discordTimestamp`** has a duplicate implementation in `src/ui/dbRecoveryCard.ts` (line 79), which is used locally in that file
- The main embed builder (`buildReviewEmbedV3`) uses the `ts()` helper from `src/utils/dt.js` instead
- Timestamp formatting is primarily handled by imports from `src/lib/timefmt.js`
- No external imports of these functions exist outside this file

---

## Proposed Changes

### Step 1: Verify No Usage
Run comprehensive grep searches to confirm zero usage:
```bash
rg '\bescapeMd\b' --type ts
rg '\bwrapCode\b' --type ts
rg '\btruncateAnswer\b' --type ts
rg '\bfmtRel\b' --type ts
rg '\bfmtUtc\b' --type ts
rg '\bfmtLocal\b' --type ts
rg 'import.*discordTimestamp.*from.*reviewCard' --type ts
```

Expected: Only matches in audit documentation and the definition in `reviewCard.ts`

### Step 2: Remove Function Definitions
Delete the following code blocks from `src/ui/reviewCard.ts`:

- **Lines 117-130:** `escapeMd` function and its JSDoc comment
- **Lines 132-173:** `wrapCode` function and its JSDoc comment
- **Lines 175-182:** `truncateAnswer` function and its JSDoc comment
- **Lines 184-190:** `fmtRel` function and its JSDoc comment
- **Lines 223-228:** `fmtUtc` function and its JSDoc comment
- **Lines 230-243:** `fmtLocal` function and its JSDoc comment
- **Lines 272-278:** `discordTimestamp` function and its JSDoc comment

### Step 3: Clean Up parseClaimedAt
The `parseClaimedAt` helper (lines 192-221) can remain as it's actively used by `buildReviewEmbedV3` (line 510).

### Step 4: Update Comments
Verify that the "Helper Functions" section comment (line 113-115) still makes sense with fewer helpers remaining.

### Step 5: Verify Build
```bash
npm run build
```

Ensure TypeScript compilation succeeds without errors.

### Step 6: Run Tests
```bash
npm test
```

Verify no test failures related to removed functions.

---

## Files Affected

### Modified
- `/Users/bash/Documents/pawtropolis-tech/src/ui/reviewCard.ts`
  - Remove 7 exported functions (~55 lines total)
  - Retain: `getStatusColor`, `getEmbedColor`, `googleReverseImageUrl`, `buildActionRowsV2`, `buildReviewEmbedV3`, and private helpers

### No Changes Required
- `/Users/bash/Documents/pawtropolis-tech/src/ui/dbRecoveryCard.ts` - Has its own `discordTimestamp` implementation
- `/Users/bash/Documents/pawtropolis-tech/src/lib/timefmt.js` - Already provides timestamp utilities
- `/Users/bash/Documents/pawtropolis-tech/src/utils/dt.js` - Already provides `ts()` helper

---

## Testing Strategy

### Pre-Removal Verification
1. **Usage Audit:**
   ```bash
   # Verify each function is only referenced in its definition
   rg -l 'escapeMd|wrapCode|truncateAnswer|fmtRel|fmtUtc|fmtLocal' --type ts
   ```
   Expected: Only `reviewCard.ts` and audit documentation

2. **Import Check:**
   ```bash
   # Check for any destructured imports
   rg 'import \{[^}]*(escapeMd|wrapCode|truncateAnswer|fmtRel|fmtUtc|fmtLocal|discordTimestamp)[^}]*\} from.*reviewCard' --type ts
   ```
   Expected: No matches

### Post-Removal Verification
1. **Build Test:**
   ```bash
   npm run build
   ```
   Expected: Clean build with no TypeScript errors

2. **Runtime Test:**
   - Start bot in development mode
   - Trigger review card generation (submit test application)
   - Verify embed renders correctly
   - Check action buttons function properly

3. **Import Test:**
   Verify remaining exported functions are still accessible:
   ```typescript
   import {
     getStatusColor,
     getEmbedColor,
     buildReviewEmbedV3
   } from './ui/reviewCard.js';
   ```

### Regression Prevention
- No existing tests should break (these functions are unused)
- Review card visual appearance should remain unchanged
- All button interactions should continue working

---

## Rollback Plan

### If Issues Arise
The changes are isolated to a single file with no external dependencies, making rollback straightforward:

1. **Immediate Rollback:**
   ```bash
   git checkout HEAD -- src/ui/reviewCard.ts
   npm run build
   ```

2. **Identify Issue:**
   - Check TypeScript compilation errors
   - Review runtime exceptions
   - Check for any missed imports in newly added files

3. **Selective Restoration:**
   If a specific function is needed:
   ```bash
   git show HEAD:src/ui/reviewCard.ts | grep -A 20 "export function functionName"
   ```
   Copy only the required function back

### Prevention
- Before merging, ensure all imports are checked using:
  ```bash
  npm run build && npm test
  ```
- Run full integration test suite
- Monitor first 24h after deployment for any runtime errors

---

## Success Criteria

- [ ] All 7 unused functions removed from `reviewCard.ts`
- [ ] TypeScript build completes without errors
- [ ] No test failures
- [ ] Review card embeds render correctly in Discord
- [ ] File size reduced by ~55 lines
- [ ] No regression in review workflow functionality
- [ ] Code review approved
- [ ] Changes merged to main

---

## Notes

- This is a pure cleanup task with zero functional impact
- Functions appear to be from an earlier design iteration (possibly V1/V2 embed builders)
- Current implementation uses `buildReviewEmbedV3` which relies on different utilities
- Consider similar audits for other UI modules (`dbRecoveryCard.ts`, etc.)

---

**Created:** 2025-11-30
**Status:** Ready for Implementation
