# Command Audit: /developer

> File: `src/commands/developer.ts` | Created: 2026-01-11 | Author: watchthelight

## Overview

**WHAT:** Developer/debugging commands for staff.
**WHY:** Enable staff to debug issues by looking up trace IDs from error cards.
**FLOWS:**
- `/developer trace <trace_id>` → Lookup trace from cache → display verbose breakdown
- `/developer stats` → Show trace cache statistics

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` |
| Handlers | `handleTrace()`, `handleStats()` |

## DB Touches

**None** - Reads from in-memory trace cache only.

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | |
| Role check | Line 51 | `requireStaff(interaction)` |
| Guild check | Implicit | |

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete with DOCS |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ✅ | Has withStep |
| Switch-based routing | ✅ | Clean switch |
| Error handling | ✅ | Good validation |

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| None | Clean implementation | - |

**Status:** Exemplary command structure. Good validation of trace ID format.
