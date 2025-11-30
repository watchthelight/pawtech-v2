# Issue #62: Consolidate Duplicate Type Definitions

**Status:** Completed
**Priority:** High
**Type:** Code Quality / Tech Debt
**Estimated Effort:** 1 hour

---

## Summary

Multiple types are defined identically in multiple files, creating maintenance burden and risk of divergence.

## Duplicate Types Found

### ApplicationStatus (2 copies)
- `src/features/review/types.ts:14`
- `src/ui/reviewCard.ts:21`

### ReviewAnswer (2 copies)
- `src/features/review/types.ts:25`
- `src/ui/reviewCard.ts:38`

### AvatarScanRow (3 copies with different naming!)
- `src/features/avatarScan.ts:46` (snake_case)
- `src/features/review/types.ts:92` (camelCase)
- `src/ui/reviewCard.ts:44` (camelCase)

### ReviewClaimRow (3 copies)
- `src/features/reviewActions.ts:27`
- `src/features/review/types.ts:62`
- `src/ui/reviewCard.ts:56`

### ModmailTicket (2 copies with different fields!)
- `src/features/modmail/types.ts:16`
- `src/ui/reviewCard.ts:61`

### NotifyConfig (2 copies)
- `src/features/notifyConfig.ts:16`
- `src/lib/notifyLimiter.ts:17`

## Proposed Changes

1. Keep canonical definitions in `src/features/review/types.ts`
2. Create separate `*DbRow` types for database representations
3. Update all imports to use canonical source
4. Add transformation functions for DB→UI conversion

### Type Consolidation Plan

```typescript
// src/features/review/types.ts - canonical source
export type ApplicationStatus = "draft" | "submitted" | "approved" | "rejected" | "needs_info" | "kicked";

export interface ReviewAnswer {
  q_index: number;
  question: string;
  answer: string;
}

// Database row (snake_case)
export interface AvatarScanDbRow {
  application_id: string;
  nsfw_score: number | null;
  edge_score: number;
  furry_score: number;
  scalie_score: number;
  // ...
}

// UI representation (camelCase)
export interface AvatarScanRow {
  finalPct: number;
  nsfwScore: number | null;
  furryScore: number;
  scalieScore: number;
  // ...
}

// Transformation function
export function toAvatarScanRow(db: AvatarScanDbRow): AvatarScanRow {
  return {
    finalPct: db.final_pct,
    nsfwScore: db.nsfw_score,
    furryScore: db.furry_score,
    // ...
  };
}
```

## Files Affected

- `src/features/review/types.ts` (canonical source)
- `src/features/avatarScan.ts` (rename type)
- `src/features/reviewActions.ts` (import instead of define)
- `src/ui/reviewCard.ts` (import instead of define)
- `src/features/modmail/types.ts` (keep as canonical)
- `src/lib/notifyLimiter.ts` (import instead of define)

## Testing Strategy

1. Run full test suite after each file change
2. Verify TypeScript compilation passes
3. Test review card rendering
