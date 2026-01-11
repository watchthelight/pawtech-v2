# Command Audit: /accept

> File: `src/commands/gate/accept.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Approve applications via slash command.
**WHY:** Faster than navigating review card in some cases.
**FLOWS:**
- `/accept app:<code>` → Approve by short code
- `/accept user:@User` → Approve by mention
- `/accept uid:<id>` → Approve by raw user ID (for ghost members)

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `executeAccept()` |

## DB Touches

| Operation | Table | Function |
|-----------|-------|----------|
| Read | `application` | `findAppByShortCode()`, `findPendingAppByUserId()` |
| Read | `claim` | `getClaim()` |
| Write | `application` | `approveTx()` |
| Write | `review_action` | `updateReviewActionMeta()` |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | |
| Role check | Line 67 | `requireGatekeeper()` |
| Guild check | Lines 63-66 | Guild-only |

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ⚠️ | Minimal header |
| `CommandContext<I>` signature | ✅ | Uses ctx |
| `withStep()` instrumentation | ⚠️ | Has `ctx.step()` |
| `withSql()` for DB | ❌ | Not wrapped |
| Error handling | ✅ | Good flow |

## Security

- Validates exactly one identifier provided
- Uses `claimGuard()` to prevent unauthorized actions
- `setDMPermission(false)` set

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Missing withSql wrappers | M |
| P3 | Minimal file header | S |

**Recommended commits:**
1. `refactor(accept): add withSql wrappers`
2. `docs(accept): expand file header`
