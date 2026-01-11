# Command Audit: /search

> File: `src/commands/search.ts` | Created: 2025-11-28 | Author: watchthelight

## Overview

**WHAT:** Display all of a user's past applications with links to review cards.
**WHY:** Allows moderators to quickly view applicant history for context.
**FLOWS:**
- `/search user:@User` → Paginated embed of all applications
- Shows app code, status, submitted date, resolution reason

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` |

## DB Touches

| Operation | Table | Function |
|-----------|-------|----------|
| Read | `application` | Query by user_id |
| Read | `review_card_msg` | Get card locations |
| Read | `review_action` | Get resolution info |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | `null` | Visible to all |
| Role check | Runtime | Owner OR Staff OR Reviewer |
| Guild check | `setDMPermission(false)` | Guild-only |

## Rate Limiting

- 30-second cooldown per user (`SEARCH_MS`)
- Prevents Discord API spam via username lookups

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete with DOCS |
| `CommandContext<I>` signature | ✅ | Uses ctx |
| `withStep()` instrumentation | ✅ | Has withStep |
| `withSql()` for DB | ✅ | Has withSql |
| Error handling | ✅ | Good try/catch |

## Logging Gap

- Missing `evt` field in logger calls
- Missing audit trail logging (no `logActionPretty`)

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Missing `evt` field in logs | S |
| P3 | No audit trail for searches | M |

**Recommended commits:**
1. `refactor(search): add evt field to logger calls`
2. `feat(search): add audit trail logging`
