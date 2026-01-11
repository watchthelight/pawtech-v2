# Command Audit: /event

> File: `src/commands/event/index.ts` | Created: 2026-01-04 | Author: watchthelight

## Overview

**WHAT:** Unified event attendance tracking command.
**WHY:** Provides movie and game night tracking under one command.
**FLOWS:**
- `/event movie [subcommand]` → Movie night tracking
- `/event game [subcommand]` → Game night tracking

## Architecture

Router that delegates to handler files:
- `event/movie.ts` - Movie night handlers
- `event/game.ts` - Game night handlers
- `event/data.ts` - Command data definition

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` |
| Handlers | `handleMovieSubcommand()`, `handleGameSubcommand()` |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | |
| Role check | Line 32 | `requireMinRole(ROLE_IDS.MODERATOR)` |
| Guild check | Lines 23-29 | Guild-only |

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete WHAT/WHY/FLOWS |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| Switch-based routing | ✅ | Routes by group |
| Permission at top | ✅ | Before routing |

## Handler Status

| File | withStep | withSql | Notes |
|------|----------|---------|-------|
| movie.ts | ⚠️ | ⚠️ | Partial coverage |
| game.ts | ⚠️ | ⚠️ | Partial coverage |

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Handler files need withStep/withSql | M |

**Recommended commits:**
1. `refactor(event): add withStep/withSql to movie.ts`
2. `refactor(event): add withStep/withSql to game.ts`
