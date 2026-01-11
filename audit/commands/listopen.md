# Command Audit: /listopen

> File: `src/commands/listopen.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Lists open applications for moderators.
**WHY:** Provides quick access to pending review queue.
**FLOWS:**
- `/listopen` → Paginated list of claimed apps not yet decided
- `/listopen scope:all` → All open applications (Gatekeeper+)
- `/listopen scope:drafts` → Draft applications (Gatekeeper+)

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` |
| Button handlers | `handleListOpenPagination()` |

## DB Touches

| Operation | Table | Function |
|-----------|-------|----------|
| Read | `application` | Queries for open apps |
| Read | `review_card_msg` | Get card locations |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | `null` | Visible to all |
| Role check | Runtime | Owner OR Staff OR Reviewer |
| Guild check | `setDMPermission(false)` | Guild-only |

## Rate Limiting

**Gap:** No rate limit currently. Could add guild-level limit.

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete with DOCS |
| `CommandContext<I>` signature | ✅ | Uses ctx |
| `withStep()` instrumentation | ✅ | Has withStep |
| `withSql()` for DB | ✅ | Has withSql |
| Error handling | ✅ | Good try/catch |

## Caching

- Uses LRU cache for draft applications
- 1-minute TTL, 1000 max entries
- Prevents DB spam on frequent queries

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P3 | No rate limit | S |

**Status:** Well-implemented with caching. Consider adding rate limit.
