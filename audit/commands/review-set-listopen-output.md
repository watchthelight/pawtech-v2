# Command Audit: /review-set-listopen-output

> File: `src/commands/review-set-listopen-output.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Toggle /listopen output visibility (public vs ephemeral).
**WHY:** Allows guilds to customize moderator workflow privacy.
**FLOWS:**
- `/review-set-listopen-output mode:public` → Makes /listopen visible to all
- `/review-set-listopen-output mode:ephemeral` → Makes /listopen ephemeral

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` |

## DB Touches

| Operation | Table | Function |
|-----------|-------|----------|
| Read | `guild_config` | `getConfig()` |
| Write | `guild_config` | `upsertConfig()` |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | `ManageGuild` | UI visibility |
| Role check | Runtime | Owner OR ManageGuild |
| DM check | `setDMPermission(false)` | Guild-only |

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete with DOCS |
| `CommandContext<I>` signature | ✅ | Uses ctx |
| `withStep()` instrumentation | ❌ | Not instrumented |
| `withSql()` for DB | ❌ | Not wrapped |
| Audit logging | ✅ | Uses logActionPretty |

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Missing withStep/withSql | M |

**Status:** Good documentation, needs instrumentation.
