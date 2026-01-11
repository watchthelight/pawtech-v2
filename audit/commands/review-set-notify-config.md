# Command Audit: /review-set-notify-config

> File: `src/commands/review/setNotifyConfig.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Configure forum post notification settings.
**WHY:** Allow admins to control where/how role pings are sent.
**FLOWS:**
- Parse options (mode, role, channel, cooldown, max_per_hour)
- Validate inputs
- Update guild_config via setNotifyConfig()
- Log action

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| mode | string | No | "post" (in-thread) or "channel" (separate) |
| role | Role | No | Role to ping on new posts |
| channel | Channel | No | Notification channel |
| cooldown | Integer | No | Seconds between pings |
| max_per_hour | Integer | No | Max pings per hour |

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` |

## DB Touches

| Operation | Table | Function |
|-----------|-------|----------|
| Read | `guild_config` | `getNotifyConfig()` |
| Write | `guild_config` | `setNotifyConfig()` |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | `Administrator` | UI visibility |
| Role check | `requireAdminOrLeadership()` | Admin/Leadership required |
| DM check | `setDMPermission(false)` | Guild-only |

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete with SECURITY/DOCS |
| `CommandContext<I>` signature | ✅ | Uses ctx |
| `withStep()` instrumentation | ❌ | Not instrumented |
| `withSql()` for DB | ❌ | Not wrapped |
| Audit logging | ✅ | Uses logActionPretty |

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Missing withStep/withSql | M |

**Status:** Excellent documentation. Needs instrumentation.
