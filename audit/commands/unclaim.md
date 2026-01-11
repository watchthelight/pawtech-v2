# Command Audit: /unclaim

> File: `src/commands/gate/unclaim.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Release claims on applications.
**WHY:** Allows moderators to release claims. Admins can unclaim any application.
**FLOWS:**
- `/unclaim app:<code>` → Unclaim by short code
- `/unclaim user:@User` → Unclaim by mention
- `/unclaim uid:<id>` → Unclaim by raw user ID

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `executeUnclaim()` |

## DB Touches

| Operation | Table | Function |
|-----------|-------|----------|
| Read | `application` | `findAppByShortCode()`, `findPendingAppByUserId()` |
| Read | `claim` | `getClaim()` |
| Write | `claim` | `clearClaim()` |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Role check | `requireGatekeeper()` | Gatekeeper role required |
| Guild check | `setDMPermission(false)` | Guild-only |
| Ownership | Runtime | Must own claim OR be Admin+ |

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Has WHAT/WHY |
| `CommandContext<I>` signature | ✅ | Uses ctx |
| `withStep()` instrumentation | ⚠️ | Has ctx.step() |
| `withSql()` for DB | ❌ | Not wrapped |
| DM permission | ✅ | `setDMPermission(false)` |

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Missing withSql wrappers | M |
