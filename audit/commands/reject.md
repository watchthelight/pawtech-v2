# Command Audit: /reject

> File: `src/commands/gate/reject.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Reject applications via slash command.
**WHY:** Supports both workflow types with optional permanent rejection.
**FLOWS:**
- `/reject reason:<text> app:<code>` → Reject by short code
- `/reject reason:<text> user:@User` → Reject by mention
- `/reject reason:<text> uid:<id> [perm:true]` → Reject with permanent flag

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `executeReject()` |

## DB Touches

| Operation | Table | Function |
|-----------|-------|----------|
| Read | `application` | `findAppByShortCode()`, `findPendingAppByUserId()` |
| Read | `claim` | `getClaim()` |
| Write | `application` | `rejectTx()` |
| Write | `review_action` | `updateReviewActionMeta()` |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | |
| Role check | Line 73 | `requireGatekeeper()` |
| Guild check | Lines 69-72 | Guild-only |

## Input Validation

- Reason is required (line 43)
- Reason max length checked via `MAX_REASON_LENGTH`

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ⚠️ | Minimal header |
| `CommandContext<I>` signature | ✅ | Uses ctx |
| `withStep()` instrumentation | ⚠️ | Has `ctx.step()` |
| `withSql()` for DB | ❌ | Not wrapped |
| Error handling | ✅ | Good flow |

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Missing withSql wrappers | M |
| P3 | Minimal file header | S |

**Recommended commits:**
1. `refactor(reject): add withSql wrappers`
2. `docs(reject): expand file header`
