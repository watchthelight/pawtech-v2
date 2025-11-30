# Issue #61: Fix ReviewClaimRow.claimed_at Type Inconsistency

**Status:** Completed
**Priority:** Critical
**Type:** Bug Fix
**Estimated Effort:** 45 minutes

---

## Summary

`claimed_at` field has three different type definitions across the codebase, causing potential runtime errors.

## Current State

| File | Type Definition |
|------|----------------|
| `src/features/reviewActions.ts:30` | `claimed_at: number` |
| `src/features/review/types.ts:64` | `claimed_at: string` |
| `src/ui/reviewCard.ts:58` | `claimed_at: string \| number` |

Database schema: `claimed_at TEXT NOT NULL`

## Impact

Code expecting `number` will fail when receiving a `string` from the database.

## Proposed Changes

1. Standardize on `string` to match database schema
2. Update `src/features/reviewActions.ts`:

```typescript
export type ReviewClaimRow = {
  app_id: string;
  reviewer_id: string;
  claimed_at: string; // ISO timestamp string
};
```

3. Remove duplicate definition in `src/ui/reviewCard.ts`
4. Import from `src/features/review/types.ts`
5. Add transformation helpers if numeric timestamps needed:

```typescript
function claimedAtToDate(claimed_at: string): Date {
  return new Date(claimed_at);
}

function claimedAtToEpoch(claimed_at: string): number {
  return Math.floor(new Date(claimed_at).getTime() / 1000);
}
```

## Files Affected

- `src/features/reviewActions.ts:30`
- `src/features/review/types.ts:64`
- `src/ui/reviewCard.ts:58`

## Testing Strategy

1. Run existing tests to verify no regressions
2. Add type assertions in tests for claimed_at
3. Verify review card displays correct timestamps
