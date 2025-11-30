# Issue #20: Remove Unused Select Menu Function

**Status:** Pending
**Priority:** Low
**Type:** Dead Code Cleanup
**Estimated Effort:** 15 minutes

---

## Summary

Remove the unused `buildCandidateSelectMenu()` function from `src/ui/dbRecoveryCard.ts`. This function was intended as an alternative UI pattern for selecting database backup candidates but was never implemented. The codebase uses button rows (`buildCandidateActionRow()`) instead.

---

## Current State

### Problem
- **Location:** `src/ui/dbRecoveryCard.ts:392-418`
- **Function:** `buildCandidateSelectMenu(candidates: BackupCandidate[], nonce: string)`
- **Issue:** Dead code that adds maintenance burden and unused imports
- **Usage:** Only referenced in the function definition itself and audit documentation

### Evidence
The function is exported but never imported or used:
- `buildCandidateActionRow()` is imported and used in `src/commands/database.ts:31,541`
- `buildCandidateSelectMenu()` has zero call sites in the codebase
- The codebase consistently uses button rows for all database recovery UI interactions

---

## Proposed Changes

### Step 1: Remove Function Definition
Delete lines 385-418 in `src/ui/dbRecoveryCard.ts`:
- Remove JSDoc comment block (lines 385-391)
- Remove `buildCandidateSelectMenu()` function (lines 392-418)

### Step 2: Clean Up Unused Import
Remove `StringSelectMenuBuilder` from the discord.js import statement (line 18):
```typescript
// Before:
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,  // <- Remove this line
} from "discord.js";

// After:
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
```

### Step 3: Verify No Hidden References
Grep the entire codebase to confirm no dynamic imports or string-based references exist.

---

## Files Affected

| File | Change Type | Lines Affected |
|------|-------------|----------------|
| `src/ui/dbRecoveryCard.ts` | Delete function | 385-418 (34 lines) |
| `src/ui/dbRecoveryCard.ts` | Remove import | 18 (1 line) |

**Total:** 1 file, ~35 lines removed

---

## Testing Strategy

### Pre-Removal Verification
1. Grep for all references to `buildCandidateSelectMenu`:
   ```bash
   grep -r "buildCandidateSelectMenu" src/
   ```
   Expected: Only definition in `dbRecoveryCard.ts`

2. Verify `StringSelectMenuBuilder` is only used in the unused function:
   ```bash
   grep -r "StringSelectMenuBuilder" src/
   ```
   Expected: Only in `dbRecoveryCard.ts` import and function

### Post-Removal Verification
1. **Build Check:**
   ```bash
   npm run build
   ```
   Expected: Clean build with no TypeScript errors

2. **Runtime Test:**
   - Start bot in development mode
   - Execute `/database recover list` command
   - Verify button-based UI renders correctly
   - Test "Validate" and "Restore" buttons function normally

3. **Import Verification:**
   ```bash
   grep -r "StringSelectMenuBuilder" src/
   ```
   Expected: Zero matches

### Expected Behavior
- Database recovery UI continues to work identically
- Button rows for validation/restore remain functional
- No TypeScript compilation errors
- No runtime errors in database recovery flow

---

## Rollback Plan

### If Issues Arise
1. **Immediate Rollback:**
   ```bash
   git revert <commit-hash>
   ```

2. **Manual Restoration:**
   - Restore lines 385-418 from git history
   - Re-add `StringSelectMenuBuilder` import
   - Rebuild: `npm run build`

### Rollback Indicators
The following would indicate rollback is needed:
- TypeScript compilation errors referencing missing function
- Runtime errors in database recovery commands
- Any grep results showing hidden usage of `buildCandidateSelectMenu`

**Note:** Rollback is highly unlikely as the function has zero call sites and is pure dead code.

---

## Implementation Notes

- This is a safe cleanup with zero functional impact
- Consider this a template for future dead code removals
- Update audit document to mark issue as resolved after completion
- No user-facing changes or documentation updates required

---

**Related Issues:** Codebase Audit 2025-11-30
**Audit Reference:** Issue #20, Line 322
