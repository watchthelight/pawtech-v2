# Issue #52: Add Panic Mode Check to Gate Submissions

**Status:** Completed
**Priority:** High
**Type:** Enhancement
**Estimated Effort:** 20 minutes

---

## Summary

Gate entry and modal submission flows don't check for panic mode, but other features (claims, movie night, level rewards) do. New applications could flood the review queue during emergencies.

## Current State

- `reviewActions.ts:65-68` - Has panic mode check for claims
- `movieNight.ts:315-321` - Has panic mode check for tier updates
- `levelRewards.ts:46-66` - Has panic mode check for rewards
- `gate.ts` - NO panic mode check before accepting submissions

## Proposed Changes

1. Add panic mode check at the start of gate submission flow
2. Return user-friendly message if guild is in panic mode
3. Log panic mode rejections for monitoring

## Files Affected

- `src/features/gate.ts` (modal submission handler)

## Testing Strategy

1. Enable panic mode on test guild
2. Attempt to submit gate application
3. Verify submission is blocked with appropriate message
