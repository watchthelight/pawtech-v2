# Command Audit: /isitreal

> File: `src/commands/isitreal.ts` | Created: 2025-12-03 | Author: watchthelight

## Overview

**WHAT:** Detect AI-generated images using multiple detection APIs.
**WHY:** Helps moderators identify potentially AI-generated content.
**FLOWS:**
- User provides message ID or link
- Extracts images from attachments and embeds
- Calls 4 AI detection APIs in parallel
- Shows ephemeral report with per-service scores

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` |
| Context Menu | `isitRealContextMenu` ("Is It Real?") |

## External Services

| Service | Usage |
|---------|-------|
| SightEngine | AI detection |
| Hive | AI detection |
| Optic | AI detection |
| RapidAPI | AI detection |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | |
| Role check | Line 62 | `requireMinRole(ROLE_IDS.JUNIOR_MOD)` |
| Guild check | Lines 53-59 | Guild text channel only |

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete WHAT/WHY/FLOWS |
| `CommandContext<I>` signature | ✅ | Uses ctx |
| `withStep()` instrumentation | ✅ | Good coverage |
| Switch-based routing | N/A | No subcommands |
| Error handling | ✅ | Good try/catch |

## Performance

- Defers early (API calls take time)
- Parallel API calls for speed
- Rate limiting note in comments

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| None | Clean implementation | - |

**Status:** Well-implemented with good withStep coverage.
