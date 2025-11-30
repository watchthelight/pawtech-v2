# Issue #49: Fix Role Reward DM Mentions

**Status:** Planned
**Priority:** Medium
**Type:** Bug Fix
**Estimated Effort:** 30 minutes

---

## Summary

Role reward DM messages attempt to mention roles using `<@&roleId>` format, but role mentions don't render in DMs - they just show as raw text like `<@&1234567890>`. The messages should use the literal role name instead.

## Current State

When users receive role rewards via DM, the message includes role mentions that don't work:
- DMs don't support role mentions (Discord limitation)
- Users see ugly raw mention syntax instead of role names

## Proposed Changes

1. Find all DM sending code in `src/features/levelRewards.ts` (and any other reward-related files)
2. Replace role mention format `<@&${roleId}>` with literal role name fetched from the guild
3. Consider using bold or backticks for emphasis: `**Role Name**` or `` `Role Name` ``

## Files Affected

- `src/features/levelRewards.ts`
- Any other files sending reward DMs

## Testing Strategy

1. Trigger a role reward
2. Verify DM shows readable role name, not raw mention

---

*Note: This issue was identified during the November 2025 codebase audit as a follow-up item.*
