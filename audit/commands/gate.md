# Command Audit: /gate

> File: `src/commands/gate/gateMain.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Guild gate management command.
**WHY:** Setup, reset, status, config, welcome, and question management.
**FLOWS:**
- `/gate setup <channels> <roles>` → Initialize config for guild
- `/gate status` → View current gate status
- `/gate welcome` → Preview welcome message
- `/gate questions` → View gate questions
- `/gate reset` → Reset gate data (owner-only, password protected)

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` in gateMain.ts |
| Modal handlers | `handleResetModal()` |

## DB Touches

| Operation | Table | Function |
|-----------|-------|----------|
| Read/Write | `guild_config` | `upsertConfig()`, `getConfig()` |
| Read/Write | `gate_question` | `seedDefaultQuestionsIfEmpty()`, `getQuestions()` |
| Write | Various | Reset operations |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | `SendMessages` | Very permissive |
| Role check | Per-subcommand | `requireStaff`, `requireOwnerOnly` |
| Guild check | Implicit | |
| Password | Reset only | Uses `secureCompare()` |

## Security

- Reset requires owner-only + password verification
- Uses constant-time password comparison
- Modal for password input (not in command options)

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ⚠️ | Minimal header |
| `CommandContext<I>` signature | ✅ | Uses ctx |
| `withStep()` instrumentation | ⚠️ | Partial |
| `withSql()` for DB | ✅ | Has withSql |
| Switch-based routing | ✅ | Clean switch |

## Related Commands

| Command | File | Purpose |
|---------|------|---------|
| `/accept` | `gate/accept.ts` | Approve applications |
| `/reject` | `gate/reject.ts` | Reject applications |
| `/kick` | `gate/kick.ts` | Kick applicants |
| `/unclaim` | `gate/unclaim.ts` | Release claims |

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Incomplete withStep coverage | M |
| P3 | Minimal file header | S |

**Recommended commits:**
1. `refactor(gate): add withStep to all handlers`
2. `docs(gate): expand file header`
