# Command Audit: /roles

> File: `src/commands/roles.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Role automation configuration commands.
**WHY:** Configure level tiers, level rewards, and event attendance tiers.
**FLOWS:**
- `/roles add-level-tier <level> <role>` → Map level to role (Amaribot)
- `/roles add-level-reward <level> <role>` → Map level to reward token
- `/roles add-movie-tier <tier> <role> <count>` → Movie attendance tier
- `/roles add-game-tier <tier> <role> <count>` → Game attendance tier
- `/roles list [type]` → View current mappings
- `/roles remove <type> <id>` → Remove a mapping

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` |
| Handlers | 8 handlers for add/remove/list |

## DB Touches

| Operation | Table | Function |
|-----------|-------|----------|
| Read | `role_tier` | `getRoleTiers()` |
| Write | `role_tier` | Various insert/delete |
| Read | `level_reward` | |
| Write | `level_reward` | |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | |
| Role check | Line 148+ | Manual `ManageRoles` check |
| Guild check | Implicit | |

**Gap:** Missing `setDMPermission(false)`.

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete with DOCS |
| `CommandContext<I>` signature | ✅ | Uses ctx |
| `withStep()` instrumentation | ✅ | Has withStep |
| `withSql()` for DB | ✅ | Has withSql |
| Switch-based routing | ✅ | Clean switch |
| Error handling | ✅ | Good logging |

## Logging

Uses `evt` field consistently:
- `add_level_tier`, `add_level_tier_error`
- `add_level_reward`, `add_level_reward_error`
- `add_movie_tier`, `add_movie_tier_error`
- etc.

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Missing `setDMPermission(false)` | S |

**Recommended commits:**
1. `fix(roles): add setDMPermission(false)`
