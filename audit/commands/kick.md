# Command Audit: /kick

> File: `src/commands/gate/kick.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Kick applicants via slash command.
**WHY:** Records review_action and attempts DM + kick.
**FLOWS:**
- `/kick reason:<text> app:<code>` → Kick by short code
- `/kick reason:<text> user:@User` → Kick by mention
- `/kick reason:<text> uid:<id>` → Kick by raw user ID

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `executeKick()` |

## DB Touches

| Operation | Table | Function |
|-----------|-------|----------|
| Read | `application` | `findAppByShortCode()`, `findPendingAppByUserId()` |
| Read | `claim` | `getClaim()` |
| Write | `application` | `kickTx()` |
| Write | `review_action` | `updateReviewActionMeta()` |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | |
| Role check | Line 58 | `requireGatekeeper()` |
| Guild check | Lines 54-57 | Guild-only |

## Input Validation

- Reason is required
- Reason max length checked (`MAX_REASON_LENGTH`)
- Comment notes role hierarchy may block kicks (50013)

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ⚠️ | Minimal header |
| `CommandContext<I>` signature | ✅ | Uses ctx |
| `withStep()` instrumentation | ⚠️ | Has `ctx.step()` |
| `withSql()` for DB | ❌ | Not wrapped |
| Error handling | ✅ | Fail-soft with logging |

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Missing withSql wrappers | M |
| P3 | Minimal file header | S |

**Recommended commits:**
1. `refactor(kick): add withSql wrappers`
2. `docs(kick): expand file header`
