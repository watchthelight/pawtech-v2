# Issue #50: Fix perm_reject vs perm_rejected Status Inconsistency

**Status:** Completed
**Priority:** Critical
**Type:** Bug Fix
**Estimated Effort:** 30 minutes
**Completed:** 2025-11-30

---

## Summary

The application status field uses `'perm_rejected'` in some queries but the review action system uses `'perm_reject'`. This inconsistency could cause cleanup bugs where permanently rejected applications aren't found.

## Root Cause Analysis

After thorough codebase audit, the issue was a **conceptual misunderstanding**, not an actual data inconsistency:

1. **`perm_reject`** is the **action type** recorded in `review_action.action` table
2. **`perm_rejected`** was incorrectly listed as an application status, but this status **never exists**
3. The actual application `status` column only allows: `'draft','submitted','approved','rejected','needs_info','kicked'`
4. Permanently rejected apps have `status = 'rejected'` with `permanently_rejected = 1` column flag

The bug was that `gate.ts:210` queried for a `'perm_rejected'` status that can never exist in the database.

## Changes Made

### 1. Fixed `src/features/gate.ts` (lines 204-212)
- Removed `'perm_rejected'` from the IN clause (it was never a valid status)
- Updated comment to clarify that permanently rejected apps have `status='rejected'` with `permanently_rejected=1`

### 2. Fixed comment in `src/commands/listopen.ts` (lines 32-40)
- Corrected stale comment that incorrectly referred to `perm_rejected` as a status
- Clarified the relationship between `perm_reject` action and `permanently_rejected` column

### 3. Updated documentation in `docs/roadmap/017-fix-gate-full-table-scan.md`
- Removed all references to `'perm_rejected'` in SQL examples
- Added clarifying note about the correct schema design

### 4. Updated documentation in `docs/CODEBASE_AUDIT_2025-11-30.md`
- Corrected SQL example to remove invalid status
- Added clarifying note about permanent rejection schema

## Testing

- All 393 tests pass with no regressions
- No migration needed (no data inconsistency exists in database)

## Key Insight

This was a documentation/code bug, not a data bug. The database schema was always correct:
- `review_action.action` stores the action type (`'perm_reject'`)
- `application.status` stores the terminal status (`'rejected'`)
- `application.permanently_rejected` flag distinguishes permanent rejections
