# Issue #68: Fix edge_score Nullability Mismatch

**Status:** Completed
**Priority:** High
**Type:** Bug Fix
**Estimated Effort:** 15 minutes

---

## Summary

TypeScript type defines `edge_score: number | null` but database schema defines it as `NOT NULL DEFAULT 0`.

## Current State

```typescript
// src/features/avatarScan.ts:50
edge_score: number | null;  // Allows null

// src/db/ensure.ts:86
db.prepare(`ALTER TABLE avatar_scan ADD COLUMN edge_score REAL DEFAULT 0`).run();
// DEFAULT 0 means it's never null
```

## Impact

- Code may attempt to handle null values that will never exist
- Type system doesn't accurately reflect actual data

## Proposed Changes

1. Update type to match database:

```typescript
// src/features/avatarScan.ts
export type AvatarScanRow = {
  application_id: string;
  avatar_url: string;
  nsfw_score: number | null;
  edge_score: number;  // Changed: never null, defaults to 0
  furry_score: number;
  scalie_score: number;
  // ...
};
```

2. Remove null checks for edge_score in code:

```typescript
// Before
const score = row.edge_score ?? 0;

// After (no null check needed)
const score = row.edge_score;
```

## Files Affected

- `src/features/avatarScan.ts:50`
- Any code that null-checks edge_score

## Testing Strategy

1. Run TypeScript compiler to find any null check issues
2. Run existing tests
3. Verify avatar scan functionality works
