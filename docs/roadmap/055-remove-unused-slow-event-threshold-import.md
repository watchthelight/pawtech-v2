# Issue #55: Remove Unused SLOW_EVENT_THRESHOLD_MS Import

**Status:** Completed
**Priority:** Low
**Type:** Dead Code Cleanup
**Estimated Effort:** 5 minutes

---

## Summary

`SLOW_EVENT_THRESHOLD_MS` is imported in eventWrap.ts but never used.

## Current State

- Import on line 18: `import { SLOW_EVENT_THRESHOLD_MS } from "./constants.js";`
- Constant is never used in the file

## Proposed Changes

Either:
A) Remove the unused import
B) Use the constant for slow event warning logs (if that feature is desired)

## Files Affected

- `src/lib/eventWrap.ts:18`
