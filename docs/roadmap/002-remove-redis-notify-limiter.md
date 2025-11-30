# Roadmap: Remove Dead Code - RedisNotifyLimiter Class

**Issue #2** from Codebase Audit (November 30, 2025)

---

## Summary

The `RedisNotifyLimiter` class in `/Users/bash/Documents/pawtropolis-tech/src/lib/notifyLimiter.ts` is fully implemented but never instantiated anywhere in the codebase. The application exclusively uses `InMemoryNotifyLimiter`. This represents approximately 17 lines of dead code (class definition + documentation).

**Impact:** Low-severity code cleanup that improves maintainability and reduces confusion.

---

## Current State

### What's Wrong

1. **Dead Implementation:** `RedisNotifyLimiter` class (lines 182-198) implements the `INotifyLimiter` interface but all methods throw errors
2. **Never Instantiated:** Only `InMemoryNotifyLimiter` is used in the export (line 206):
   ```typescript
   export const notifyLimiter: INotifyLimiter = new InMemoryNotifyLimiter();
   ```
3. **Misleading Documentation:** Comments reference a non-existent ADR document (`docs/adr/redis-notify-limiter.md`) that was never created
4. **Confusing Intent:** The class appears ready for use but is actually a placeholder that throws errors

### Code Location

**File:** `/Users/bash/Documents/pawtropolis-tech/src/lib/notifyLimiter.ts`

**Lines:** 168-198 (31 lines total including documentation)

**Current Implementation:**
```typescript
/**
 * WHAT: Redis-backed rate limiter adapter interface
 * WHY: Coordinate rate limits across multiple bot instances
 * IMPLEMENTATION: Left as exercise for multi-instance deployment
 * DOCS: See docs/adr/redis-notify-limiter.md
 *
 * Example Redis keys:
 *  - notify:{guildId}:last → timestamp of last notification
 *  - notify:{guildId}:hour:{YYYYMMDDHH} → sorted set of notification timestamps
 *
 * Example methods:
 *  - canNotify(): GET last timestamp, check cooldown; ZCOUNT hour key for cap
 *  - recordNotify(): SET last timestamp; ZADD to hour sorted set with TTL
 */
export class RedisNotifyLimiter implements INotifyLimiter {
  // Placeholder for Redis implementation
  // TODO: Implement using ioredis or redis client
  // See docs/adr/redis-notify-limiter.md for design

  canNotify(guildId: string, config: NotifyConfig): RateLimitCheck {
    throw new Error("RedisNotifyLimiter not implemented - use InMemoryNotifyLimiter");
  }

  recordNotify(guildId: string): void {
    throw new Error("RedisNotifyLimiter not implemented - use InMemoryNotifyLimiter");
  }

  cleanup(): void {
    // Redis handles TTL automatically
  }
}
```

---

## Proposed Changes

### Step-by-Step Removal

1. **Remove the RedisNotifyLimiter class** (lines 168-198)
   - Delete the entire class definition
   - Delete the JSDoc comment block describing the Redis implementation

2. **Update file header documentation** (lines 9-12)
   - Remove the sentence: "For multi-instance deployments, implement RedisNotifyLimiter adapter."
   - Remove the reference: "See docs/adr/redis-notify-limiter.md for Redis migration guide"
   - Simplify to acknowledge the limitation without promising a solution that doesn't exist

3. **Simplify INotifyLimiter interface documentation** (lines 36-43)
   - Update comment from "Allow pluggable implementations (in-memory, Redis, etc.)" to "Abstract interface for notify rate limiter"
   - Keep interface intact (it's good design practice even with one implementation)

4. **Update export comment** (lines 200-205)
   - Remove: "MULTI-INSTANCE: Replace with RedisNotifyLimiter when deploying multiple instances"
   - Simplify to: "MULTI-INSTANCE: This in-memory implementation does not coordinate across bot instances"

### Suggested Documentation Update

Replace lines 9-12 with:
```typescript
 * MULTI-INSTANCE: In-memory implementation works for single process only.
 *   Multi-instance deployments will require a distributed solution (Redis, etc.)
 *   if notification rate limits need to be coordinated across instances.
```

---

## Files Affected

### Modified Files

1. **`/Users/bash/Documents/pawtropolis-tech/src/lib/notifyLimiter.ts`**
   - Remove RedisNotifyLimiter class (lines 168-198)
   - Update documentation comments (lines 9-12, 36-43, 200-205)
   - Net change: -31 lines (or more depending on doc updates)

### No Changes Required

- No imports of `RedisNotifyLimiter` exist in the codebase (verified by grep)
- No tests reference the class
- No configuration files mention it

---

## Testing Strategy

### Pre-Removal Verification

1. **Grep for all references:**
   ```bash
   grep -r "RedisNotifyLimiter" src/ --exclude-dir=node_modules
   ```
   Expected: Only `src/lib/notifyLimiter.ts` should appear

2. **Verify exports:**
   ```bash
   grep -r "from.*notifyLimiter" src/ --exclude-dir=node_modules
   ```
   Expected: Only imports of `notifyLimiter` (the instance), not the class

### Post-Removal Testing

1. **Type checking:**
   ```bash
   npm run typecheck
   ```
   Expected: No new TypeScript errors

2. **Build verification:**
   ```bash
   npm run build
   ```
   Expected: Clean build

3. **Run existing tests:**
   ```bash
   npm test
   ```
   Expected: All tests pass (no tests reference RedisNotifyLimiter)

4. **Runtime smoke test:**
   - Start the bot in development mode
   - Trigger a forum post notification
   - Verify rate limiting still works with InMemoryNotifyLimiter

### Risk Assessment

**Risk Level:** Very Low

- No runtime dependencies on removed code
- Class never instantiated anywhere
- All callers use the exported `notifyLimiter` instance (InMemoryNotifyLimiter)
- Interface remains unchanged

---

## Rollback Plan

### If Issues Arise

1. **Immediate Rollback:**
   ```bash
   git revert <commit-hash>
   ```

2. **Restore from backup:**
   - The class definition is well-documented in this roadmap
   - Can be re-added from git history if needed

### Recovery Time Estimate

- **Revert:** < 1 minute
- **Redeploy:** Standard deployment time (~5 minutes)

### Monitoring

No special monitoring required. This is pure code cleanup with no behavioral changes.

---

## Implementation Checklist

- [ ] Run pre-removal verification (grep for references)
- [ ] Create feature branch: `cleanup/remove-redis-notify-limiter`
- [ ] Remove RedisNotifyLimiter class definition (lines 168-198)
- [ ] Update file header documentation (lines 9-12)
- [ ] Update INotifyLimiter interface comment (lines 36-43)
- [ ] Update export comment (lines 200-205)
- [ ] Run `npm run typecheck`
- [ ] Run `npm run build`
- [ ] Run `npm test`
- [ ] Runtime smoke test (trigger forum notification)
- [ ] Commit with message: "Remove dead code: RedisNotifyLimiter class (Issue #2)"
- [ ] Create PR with reference to this roadmap
- [ ] Code review
- [ ] Merge to main
- [ ] Deploy to production
- [ ] Monitor for 24 hours (no special metrics needed)
- [ ] Mark Issue #2 as complete

---

## Related Work

This cleanup is part of a larger effort to remove dead code identified in the November 30, 2025 codebase audit:

- **Issue #1:** Remove tracer.ts usage from index.ts (~30 lines)
- **Issue #2:** Remove RedisNotifyLimiter class (~31 lines) ← THIS DOCUMENT
- **Issue #3:** Remove unused event wrapper variants (~91 lines)
- **Issue #4:** Delete forumThreadNotify.ts entirely (~230 lines)

**Total Dead Code in Audit:** ~546 lines across 8 files

---

## Notes

- If multi-instance coordination becomes necessary in the future, implement a new class from scratch rather than trying to resurrect this placeholder
- Consider adding a comment to `INotifyLimiter` interface explaining why it exists despite having only one implementation (future extensibility, testability)
- This removal does not affect single-instance deployments (current production setup)
