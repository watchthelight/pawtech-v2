# Command Audit: /art

> File: `src/commands/art.ts` | Created: 2025-12-01 | Author: watchthelight

## Overview

**WHAT:** Server Artist job management commands.
**WHY:** Allow artists to view, update, and complete their assigned art jobs.
**FLOWS:**
- `/art jobs` → View current active jobs
- `/art bump <id|user+type> [stage]` → Update job status
- `/art finish <id|user+type>` → Mark job complete
- `/art view <id|user+type>` → View job details
- `/art leaderboard` → View monthly and all-time stats
- `/art all` → Staff only: view all active jobs
- `/art assign` → Assign a job to an artist
- `/art getstatus` → Get job status

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` |
| Handlers | 8 handlers: `handleJobs`, `handleBump`, `handleFinish`, `handleView`, `handleLeaderboard`, `handleAll`, `handleAssign`, `handleGetstatus` |

## DB Touches

| Operation | Table | Function |
|-----------|-------|----------|
| Read | `art_job` | `getActiveJobsForArtist()` |
| Read | `art_job` | `getActiveJobsForRecipient()` |
| Read | `art_job` | `getAllActiveJobs()` |
| Read | `art_job` | `getJobByArtistNumber()` |
| Read | `art_job` | `getJobByRecipient()` |
| Write | `art_job` | `updateJobStatus()` |
| Write | `art_job` | `finishJob()` |
| Read | `art_job` | `getMonthlyLeaderboard()` |
| Read | `art_job` | `getAllTimeLeaderboard()` |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | Discoverable to all |
| Role check | Per-handler | `/art all` requires Staff |
| Guild check | Implicit | Jobs are guild-specific |

**Gap:** Missing `setDMPermission(false)`.

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete WHAT/WHY/FLOWS |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ✅ | Has withStep |
| `withSql()` for DB | ✅ | Has withSql |
| Switch-based routing | ✅ | Clean switch |
| Error handling | ⚠️ | Varies by handler |

## Bugs / Dead Code

- **None identified** - Clean implementation

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Missing `setDMPermission(false)` | S |

**Recommended commits:**
1. `fix(art): add setDMPermission(false)`
