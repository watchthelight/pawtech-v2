# Codebase Audit Report

**Date:** November 30, 2025
**Audited By:** 5 parallel project-manager agents
**Scope:** Full codebase analysis including core infrastructure, commands, features, database, events, and UI layers

---

## Executive Summary

A comprehensive audit of the Pawtropolis Tech Discord bot codebase identified **48 issues** across all layers. The codebase demonstrates strong documentation practices, good error handling, and proper security measures in most areas. However, there are opportunities to remove dead code (~400+ lines), fix potential race conditions, and standardize patterns.

| Severity | Count |
|----------|-------|
| Critical | 10 |
| High Priority | 12 |
| Medium Priority | 15 |
| Low Priority | 11 |

---

## Table of Contents

1. [Critical Issues](#critical-issues)
2. [High Priority Issues](#high-priority-issues)
3. [Medium Priority Issues](#medium-priority-issues)
4. [Low Priority Issues](#low-priority-issues)
5. [Security Observations](#security-observations)
6. [Performance Concerns](#performance-concerns)
7. [Positive Findings](#positive-findings)
8. [Recommendations](#recommendations)

---

## Critical Issues

### 1. Dead Code: tracer.ts Usage in index.ts

**Location:** `src/index.ts:72, 766-790`

**Issue:** The `tracer.ts` module is imported and used but the trace object is never consumed:

```typescript
import { newTrace, tlog, withStep } from "./lib/tracer.js";

const trace = newTrace("gate", "interactionCreate");
(interaction as any).__trace = trace;  // NEVER READ ELSEWHERE
(interaction as any).__ownerBypass = isOwner(interaction.user.id);  // NEVER READ ELSEWHERE
```

**Impact:** ~30 lines of dead code. The `__trace` and `__ownerBypass` properties are set but never accessed.

**Recommendation:** Remove tracer.ts usage from index.ts. Use the existing `reqctx` system which is already in place throughout the codebase.

---

### 2. Dead Code: RedisNotifyLimiter Class

**Location:** `src/lib/notifyLimiter.ts:182-205`

**Issue:** The `RedisNotifyLimiter` class is fully implemented (87 lines) but never instantiated. Only `InMemoryNotifyLimiter` is used.

```typescript
export const notifyLimiter: INotifyLimiter = new InMemoryNotifyLimiter();
```

**Recommendation:** Remove the class or document it as future work with a TODO comment.

---

### 3. Dead Code: Unused Event Wrapper Variants

**Location:** `src/lib/eventWrap.ts:106-158, 227-264`

**Issue:** Two functions are exported but never used:
- `wrapEventWithTiming` (53 lines)
- `wrapEventRateLimited` (38 lines)

Additionally, `wrapEventRateLimited` is imported in index.ts but never called.

**Recommendation:** Remove unused imports and functions.

---

### 4. Dead File: forumThreadNotify.ts

**Location:** `src/events/forumThreadNotify.ts` (entire file)

**Issue:** This file exports `handleForumThreadCreate()` and `registerForumThreadNotifyHandler()` but neither is imported anywhere. The active implementation is `forumPostNotify.ts`.

**Key Difference:** `forumPostNotify.ts` has retry logic for Discord race conditions (error 10008), while `forumThreadNotify.ts` lacks this.

**Recommendation:** Delete `forumThreadNotify.ts` entirely.

---

### 5. Duplicate Code: Two Claim Management Implementations

**Locations:**
- `src/features/reviewActions.ts:24-267`
- `src/features/review/claims.ts:1-101`

**Issue:** Both files export similar functions with different implementations:
- `reviewActions.ts` provides **transactional** operations with panic mode checks
- `review/claims.ts` provides **non-transactional** operations with a race condition warning

Additionally, `upsertClaim()` in claims.ts has **zero references** in the codebase.

**Recommendation:** Deprecate `review/claims.ts` and consolidate on `reviewActions.ts`.

---

### 6. SQL Injection Risk: Unvalidated Table Names

**Location:** `migrations/lib/helpers.ts:95`

**Issue:** Table names are interpolated directly into PRAGMA queries without validation:

```typescript
return db.prepare(`PRAGMA table_info(${tableName})`).all()
```

While `src/db/db.ts` has proper validation using `SQL_IDENTIFIER_RE`, the helpers file does NOT.

**Recommendation:** Add the same validation pattern:

```typescript
const SQL_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
if (!SQL_IDENTIFIER_RE.test(tableName)) {
  throw new Error(`Invalid table name: ${tableName}`);
}
```

---

### 7. SQL Injection Risk: String Interpolation in ALTER TABLE

**Location:** `src/lib/config.ts:141, 177, 211, 244`

**Issue:** Column names interpolated into ALTER TABLE statements:

```typescript
db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} TEXT`).run();
```

While column names come from hardcoded arrays (reducing risk), there's no explicit validation.

**Recommendation:** Add identifier validation before interpolation.

---

### 8. Duplicate Auth Logic in Review Commands

**Locations:**
- `src/commands/review/setNotifyConfig.ts:101-126`
- `src/commands/review/getNotifyConfig.ts:46-76`

**Issue:** Both commands implement identical multi-tier authorization logic (owner bypass, server owner, staff permissions, leadership role). This is error-prone and makes security updates harder.

**Recommendation:** Extract to a shared `requireAdminOrLeadership()` helper function.

---

### 9. Unsafe Type Casting with `as any`

**Locations:**
- `src/commands/review/setNotifyConfig.ts:115, 117`
- `src/commands/review/getNotifyConfig.ts:63, 67`
- `src/commands/sample.ts:84-86`
- `src/commands/gate.ts:485`

**Issue:** Multiple uses of `as any` to bypass TypeScript's type safety when handling `GuildMember` vs `APIInteractionGuildMember`.

**Recommendation:** Create proper type guards or update function signatures to accept union types.

---

### 10. Memory Leak Risk: Unbounded Map Growth

**Location:** `src/features/modmail/routing.ts:100-145`

**Issue:** The `forwardedMessages` Map tracks message IDs but cleanup only happens every 60 seconds. High-volume servers could accumulate thousands of entries.

```typescript
const forwardedMessages = new Map<string, number>();
const FORWARDED_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FORWARDED_CLEANUP_INTERVAL_MS = 60 * 1000; // Cleanup every minute
```

**Recommendation:** Add size-based eviction or use an LRU cache.

---

## High Priority Issues

### 11. Schema Inconsistency: Mixed Timestamp Formats

**Locations:**
- `src/db/ensure.ts:587` uses `updated_at_s INTEGER`
- `src/config/loggingStore.ts:123-124` uses `updated_at TEXT`
- `src/db/db.ts:108` uses `updated_at TEXT`

**Issue:** The `guild_config` table has BOTH `updated_at` (TEXT/ISO8601) and `updated_at_s` (INTEGER/Unix epoch). Different stores use different columns inconsistently.

**Impact:** Confusing schema, potential bugs, wasted storage.

**Recommendation:** Standardize on INTEGER (Unix epoch) for efficiency.

---

### 12. Missing Database Index: modmail_ticket

**Location:** Queries in `src/features/opsHealth.ts:447`, `src/features/modmail/tickets.ts:59`

**Issue:** Multiple queries filter by `guild_id AND status` but no covering index exists.

**Recommendation:** Add index:
```sql
CREATE INDEX idx_modmail_ticket_guild_status ON modmail_ticket(guild_id, status);
```

---

### 13. Missing Database Index: application

**Location:** Queries in `src/features/opsHealth.ts:152`, `src/features/gate.ts:188, 194`

**Issue:** Queries filter by `guild_id + status` but the existing index on `(status, created_at)` doesn't help.

**Recommendation:** Add composite index:
```sql
CREATE INDEX idx_application_guild_status ON application(guild_id, status, created_at);
```

---

### 14. Cache Invalidation Race Condition

**Location:** `src/config/loggingStore.ts:118-120`

**Issue:** Cache is invalidated BEFORE the database write:

```typescript
invalidateCache(guildId);  // Cache invalidated first
db.prepare(...).run(...);   // Then DB write happens
```

If the DB write fails, subsequent reads may get stale data.

**Recommendation:** Move `invalidateCache()` to AFTER successful DB write.

---

### 15. Race Condition: Artist Rotation Queue

**Location:** `src/features/artistRotation/handlers.ts:154-168`

**Issue:** Queue position updates aren't wrapped in a transaction:

```typescript
newPosition = moveToEnd(guild.id, data.artistId);  // Async operation
incrementAssignments(guild.id, data.artistId);     // Separate operation
```

**Impact:** Simultaneous assignments could cause incorrect queue positions.

---

### 16. Inconsistent Tracing Systems

**Files:** `src/lib/tracer.ts` vs `src/lib/reqctx.ts`

**Issue:** Two separate tracing systems doing similar things:
- `tracer.ts`: ULID-based traces (used in 7 files)
- `reqctx.ts`: Base62 trace IDs (used in 114+ files)

**Recommendation:** Migrate remaining tracer.ts users to reqctx and remove tracer.ts.

---

### 17. Database Query Inefficiency: Full Table Scan

**Location:** `src/features/gate.ts:207-209`

**Issue:** Loading all resolved applications without guild filtering:

```sql
SELECT id FROM application WHERE status IN ('approved', 'rejected', 'kicked', 'perm_rejected')
```

**Impact:** O(n) scan through all historical applications. For 100k applications, this loads all 100k IDs into memory.

**Recommendation:** Add `AND guild_id = ?` filter.

---

### 18. Unused UI Helper Functions

**Location:** `src/ui/reviewCard.ts`

**Issue:** Multiple exported functions are never used:
- `escapeMd` (line 120)
- `wrapCode` (line 135)
- `truncateAnswer` (line 178)
- `fmtRel` (line 187)
- `fmtUtc` (line 226)
- `fmtLocal` (line 233)
- `discordTimestamp` (line 276)

**Recommendation:** Remove unused exports to reduce maintenance burden.

---

### 19. Unused Function: storeScan and buildReverseImageUrl

**Location:** `src/features/avatarScan.ts:234, 372`

**Issue:** Both functions are exported but have zero references.

---

### 20. Unused Function: buildCandidateSelectMenu

**Location:** `src/ui/dbRecoveryCard.ts:392`

**Issue:** Alternative select menu implementation that's never used.

---

### 21. Unused Function: execRaw

**Location:** `src/db/db.ts:42-50`

**Issue:** Dangerous multi-statement DDL function that's never called.

---

### 22. TODO: Webhook Integration Not Implemented

**Location:** `src/features/opsHealth.ts:596-597`

**Issue:** External alerting (PagerDuty, Slack) is configured via env var but silently ignored:

```typescript
// TODO: POST to webhook with alert payload. For now, Discord is enough.
logger.debug({ alertId: alert.id }, "[opshealth] webhook notification skipped (not implemented)");
```

---

## Medium Priority Issues

### 23. Migration Numbering Gap

**Location:** `migrations/`

**Issue:** Migration files have gaps: 006, 007, 009, 014, 015, 016 are missing. Also, `2025-10-20_review_action_free_text.ts` uses date prefix instead of number.

**Recommendation:** Document why numbers were skipped or renumber files.

---

### 24. Duplicate Schema Creation: sync_marker

**Locations:**
- `src/db/db.ts:269-289`
- `migrations/026_sync_marker.ts`

**Issue:** Table created in two places, violating single source of truth.

---

### 25. Hardcoded Role IDs

**Location:** `src/commands/config.ts:881-904`

**Issue:** Bot Dev role ID hardcoded in user-facing message:

```typescript
`Bot Dev role (<@&1120074045883420753>) will...`
```

**Impact:** Server-specific; breaks if used in other servers.

---

### 26. Inconsistent Ephemeral Reply Patterns

**Locations:** Throughout commands

**Issue:** Some commands use ephemeral for errors/public for success, others do the opposite. No clear guideline.

---

### 27. Magic Numbers Without Constants

**Location:** `src/features/sync.ts`

```typescript
await new Promise((resolve) => setTimeout(resolve, 650));  // What's 650?
```

**Recommendation:** Extract to named constant: `const GUILD_SYNC_DELAY_MS = 650;`

---

### 28. Hardcoded 30-Minute Threshold

**Location:** `src/features/movieNight.ts:232-237`

**Issue:** Movie night qualification threshold is hardcoded:

```typescript
const qualified = session.totalMinutes >= 30;
```

**Recommendation:** Make configurable per guild.

---

### 29. Commented-Out Code

**Location:** `src/commands/buildCommands.ts:98-100`

```typescript
// modmailContextMenu.toJSON(),
```

**Question:** Is this a TODO or legacy code?

---

### 30. Startup Schema Checks on Every Read

**Location:** `src/lib/config.ts:359-364`

**Issue:** Six `ensure*Column()` functions called on every `getConfig()` read:

```typescript
export function getConfig(guildId: string) {
  ensureUnverifiedChannelColumn();
  ensureWelcomeTemplateColumn();
  // ... 4 more
}
```

**Recommendation:** Call all ensure functions once at startup.

---

### 31. Redundant Null Checks in listopen.ts

**Location:** `src/commands/listopen.ts:354-372`

**Issue:** Triple-nested try-catch for user fetching when the inner `.catch(() => null)` handlers already handle failures.

---

### 32. Potential Memory Leak: Rate Limiter Maps

**Locations:**
- `src/commands/flag.ts:26` - `flagCooldowns` Map
- `src/commands/modstats.ts:559` - `resetRateLimiter` Map

**Issue:** In-memory Maps never clear old entries. Could accumulate thousands of entries over time.

**Recommendation:** Implement periodic cleanup or use LRU cache.

---

### 33. Silent Failures in Dad Mode

**Location:** `src/listeners/messageDadMode.ts:121-124`

**Issue:** Reply failures logged at debug level, hiding permission issues from operators.

---

### 34. Redundant Scheduler Cleanup Logic

**Location:** All three schedulers

**Issue:** Each `stop*Scheduler()` function clears both passed-in interval AND module-level `_activeInterval`, indicating unclear ownership.

---

### 35. UI Embed Truncation Logic

**Location:** `src/ui/reviewCard.ts:656-680`

**Issue:** Sequential truncation using string indexOf for section headers. Fragile if headers change.

**Recommendation:** Use structured section building with size tracking.

---

### 36. Timestamp Inconsistency in Claim Transactions

**Location:** `src/features/reviewActions.ts:115-123`

**Issue:** Same transaction uses ISO string for one table, epoch seconds for another:

```typescript
const claimedAt = nowUtc(); // ISO string
const createdAtEpoch = Math.floor(Date.now() / 1000); // Epoch
```

---

### 37. Fragile Migration Detection

**Location:** `migrations/2025-10-20_review_action_free_text.ts:68-84`

**Issue:** Uses probe inserts to detect CHECK constraints, which could fail FK constraints.

---

## Low Priority Issues

### 38. Unused currentTraceId Function

**Location:** `src/lib/cmdWrap.ts:376`

**Issue:** Trivial wrapper `currentTraceId(ctx)` just returns `ctx.traceId`. Only used in 2 places.

---

### 39. Verbose Migration Flags

**Location:** `src/lib/config.ts:73-77`

**Issue:** Multiple boolean flags for schema migrations don't scale:

```typescript
let welcomeTemplateEnsured = false;
let welcomeChannelsEnsured = false;
// ... 4 more
```

**Recommendation:** Use a Set to track ensured migrations.

---

### 40. Duplicate allowedMentions Pattern

**Locations:** Multiple files

**Issue:** `allowedMentions: { parse: [] }` appears in many locations.

**Recommendation:** Create shared constant `SAFE_ALLOWED_MENTIONS`.

---

### 41. Incomplete Error Hints

**Location:** `src/lib/errorCard.ts:30-65`

**Issue:** `hintFor()` only handles ~6 error codes. Discord has many more common errors.

---

### 42. Default Event Timeout Too Long

**Location:** `src/lib/eventWrap.ts:28`

**Issue:** 30-second default timeout for event handlers is very high.

**Recommendation:** Lower to 10 seconds.

---

### 43. Config Cache Invalidation Gap

**Location:** `src/lib/config.ts:252-254, 348`

**Issue:** TTL-based cache doesn't handle stale data during concurrent updates.

---

### 44. Unused Sample Data

**Location:** `src/constants/sampleData.ts:113`

**Issue:** `SAMPLE_REJECTION_REASON_LONG` is exported but never used.

---

### 45. Test-Only Functions Unused

**Location:** All three schedulers

**Issue:** `__test__stopScheduler()` functions exported but not detected as used.

**Status:** RESOLVED - These functions were removed after verification they were unused. See roadmap/045-verify-test-functions.md.

---

### 46. Role ID Validation Redundancy

**Location:** `src/commands/config.ts:207-214, 285-291, 328-334`

**Issue:** Regex validation for role IDs when Discord.js already validates role objects.

---

### 47. Inconsistent Password Comparison

**Locations:**
- `src/commands/gate.ts` uses `safeEq()`
- `src/commands/modstats.ts` uses `secureCompare()`

**Issue:** Two different secure comparison implementations.

**Recommendation:** Consolidate to single utility.

---

### 48. Event Listeners Not Explicitly Removed

**Location:** `src/index.ts:650-1531`

**Issue:** Event listeners registered but not explicitly removed during shutdown. `client.destroy()` should handle this, but explicit cleanup is cleaner.

**Recommendation:** Add `client.removeAllListeners()` before destroy.

---

## Security Observations

### Positive Practices

1. **Prepared Statements:** All user input uses parameterized queries
2. **Timing-Safe Password Comparison:** Uses `timingSafeEqual()` for password checks
3. **Foreign Keys Enabled:** `PRAGMA foreign_keys = ON` enforces referential integrity
4. **Transaction Safety:** Migrations use transactions for atomicity
5. **WAL Mode:** Improves concurrency
6. **Dangerous SQL Detection:** `tracedPrepare` wrapper blocks legacy SQL patterns

### Areas for Improvement

1. Standardize on single secure comparison utility
2. Add identifier validation to all dynamic SQL
3. Document the allowlist validation in config.ts more prominently

---

## Performance Concerns

1. **Missing Indexes:** Add compound indexes for common query patterns
2. **Full Table Scans:** Gate entry deletion loads all historical applications
3. **Startup Schema Checks:** Called on every config read instead of once at startup
4. **Unbounded Maps:** Rate limiter maps grow indefinitely

---

## Positive Findings

The codebase demonstrates many excellent practices:

1. **Excellent Documentation:** Every command has comprehensive header comments
2. **Comprehensive Error Handling:** Consistent try-catch with structured logging
3. **Proper Transaction Usage:** Critical operations use `db.transaction()`
4. **Panic Mode Integration:** Review operations check `isPanicMode()`
5. **Graceful Shutdown:** Coordinated cleanup of schedulers, threads, client
6. **Race Condition Handling:** `forumPostNotify.ts` has retry logic for Discord race conditions
7. **Type Safety:** Strong TypeScript usage with discriminated unions
8. **Scheduler Best Practices:** All use `interval.unref()` to prevent keeping process alive
9. **Idempotent Operations:** Many functions handle duplicate calls gracefully

---

## Recommendations

### Immediate Actions (This Week)

1. Delete `src/events/forumThreadNotify.ts`
2. Add SQL identifier validation to `migrations/lib/helpers.ts`
3. Fix cache invalidation order in `loggingStore.ts`
4. Add missing database indexes

### Short Term (Next 2 Weeks)

1. Remove all unused exports identified by ts-prune
2. Consolidate claim management to single implementation
3. Extract shared auth logic from review commands
4. Standardize timestamp formats

### Medium Term (Next Month)

1. Migrate from tracer.ts to reqctx system
2. Implement size-based eviction for Maps
3. Add periodic cleanup for rate limiter Maps
4. Make movie night threshold configurable

### Long Term (Backlog)

1. Implement webhook integration for opsHealth
2. Clean up migration numbering
3. Create comprehensive type guards for Discord.js types
4. Standardize ephemeral vs public reply patterns

---

## Appendix: Dead Code Summary

| File | Lines | Description |
|------|-------|-------------|
| `src/events/forumThreadNotify.ts` | ~230 | Entire file unused |
| `src/lib/notifyLimiter.ts` | ~87 | RedisNotifyLimiter class |
| `src/lib/eventWrap.ts` | ~91 | wrapEventWithTiming, wrapEventRateLimited |
| `src/index.ts` | ~30 | tracer.ts usage |
| `src/ui/reviewCard.ts` | ~50 | 7 unused helper functions |
| `src/features/avatarScan.ts` | ~20 | storeScan, buildReverseImageUrl |
| `src/features/review/claims.ts` | ~30 | upsertClaim (race-prone version) |
| `src/db/db.ts` | ~8 | execRaw function |
| **Total** | **~546** | **Estimated dead code lines** |

---

*Report generated by automated codebase audit. Manual verification recommended before making changes.*
