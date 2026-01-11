# Command Audit: /review-get-notify-config

> File: `src/commands/review/getNotifyConfig.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** View current forum post notification settings.
**WHY:** Allow admins to inspect configuration without database access.
**FLOWS:**
- `/review-get-notify-config` → Shows current notification config as embed

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` |

## DB Touches

| Operation | Table | Function |
|-----------|-------|----------|
| Read | `guild_config` | `getNotifyConfig()` |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | `Administrator` | UI visibility |
| Role check | `requireAdminOrLeadership()` | Admin/Leadership required |
| DM check | `setDMPermission(false)` | Guild-only |

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete with SECURITY note |
| `CommandContext<I>` signature | ✅ | Uses ctx |
| `withStep()` instrumentation | ❌ | Not instrumented |
| `withSql()` for DB | ❌ | Not wrapped |
| Audit logging | ✅ | Uses logActionPretty |

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Missing withStep/withSql | M |

**Status:** Well-documented, good permissions. Needs instrumentation.
