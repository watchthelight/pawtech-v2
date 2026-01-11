# Command Audit: /utility

> File: `src/commands/utility.ts` | Created: 2026-01-11 | Author: watchthelight

## Overview

**WHAT:** One-time utility command for mass role assignment.
**WHY:** Assigns base role to members without level roles.
**NOTE:** Marked for deletion after use.

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| User check | Line 48+ | Specific user ID or Server Dev role |
| Guild check | None | Guild-only assumed |

## Special Notes

- Hardcoded user ID check (`ENTROPY_USER_ID`)
- Hardcoded role IDs for level roles
- One-time use, marked for deletion

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Has WHAT/WHY/NOTE |
| `CommandContext<I>` signature | ✅ | Uses ctx |
| `withStep()` instrumentation | ❌ | Not instrumented |
| Temporary command | ⚠️ | Should be deleted after use |

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P3 | One-time command, consider removing | S |
| P3 | Hardcoded IDs | Low priority |

**Status:** Temporary utility. Remove after use or convert to proper admin command.
