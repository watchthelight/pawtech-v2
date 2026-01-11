# Command Audit: /artistqueue

> File: `src/commands/artistqueue.ts` | Created: 2025-11-29 | Author: watchthelight

## Overview

**WHAT:** Server Artist rotation queue management.
**WHY:** Allow staff to view, sync, and manage the artist rotation system.
**FLOWS:**
- `/artistqueue list` → View current queue order
- `/artistqueue sync` → Sync queue with Server Artist role holders
- `/artistqueue move <user> <position>` → Reorder an artist
- `/artistqueue skip <user> [reason]` → Skip an artist in rotation
- `/artistqueue unskip <user>` → Remove skip status
- `/artistqueue history [user]` → View assignment history
- `/artistqueue setup` → Initial setup (permissions, sync)

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` |
| Handlers | 7 handlers for each subcommand |

## DB Touches

| Operation | Table | Function |
|-----------|-------|----------|
| Read | `artist_rotation` | `getAllArtists()` |
| Read | `artist_rotation` | `getArtist()` |
| Write | `artist_rotation` | `syncWithRoleMembers()` |
| Write | `artist_rotation` | `moveToPosition()` |
| Write | `artist_rotation` | `skipArtist()` |
| Write | `artist_rotation` | `unskipArtist()` |
| Read | `artist_assignment_log` | `getAssignmentHistory()` |
| Read | `artist_rotation` | `getArtistStats()` |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | `ManageRoles` | UI visibility |
| Runtime check | None | Relies on Discord perm |
| Guild check | Implicit | |

## Rate Limiting

- `sync` subcommand has 5-minute rate limit (`ARTISTQUEUE_SYNC_MS`)

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete with FLOWS |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ✅ | Has withStep |
| `withSql()` for DB | ✅ | Has withSql |
| Switch-based routing | ✅ | Clean switch |

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| None | Clean implementation | - |

**Status:** Well-implemented command with good rate limiting.
