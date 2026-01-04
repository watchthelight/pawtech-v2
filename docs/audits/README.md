# Codebase Audit Plans

**Audit Date:** 2025-12-02
**Overall Assessment:** 7.5/10 - Well-architected with specific improvements needed

---

## Discord Server Audit

For Discord server permission and security audits, see:
- [internal-info/CONFLICTS.md](../internal-info/CONFLICTS.md) - Permission conflicts and security issues
- [internal-info/ROLES.md](../internal-info/ROLES.md) - Full role permission matrix
- [internal-info/CHANNELS.md](../internal-info/CHANNELS.md) - Channel permission overwrites

> **Re-generate:** `npx dotenvx run -- tsx scripts/audit-server-full.ts`

---

## Quick Reference

| # | Plan | Priority | Files | Risk |
|---|------|----------|-------|------|
| 001 | [Architecture](./001-architecture-audit.md) | High | ~60 | Medium |
| 002 | [Security](./002-security-audit.md) | **Critical** | ~10 | Low |
| 003 | [Performance](./003-performance-audit.md) | High | ~25 | Medium |
| 004 | [Dead Code](./004-dead-code-audit.md) | Medium | ~30 | Low |
| 005 | [Database](./005-database-audit.md) | High | ~20 | Medium-High |
| 006 | [Error Handling](./006-error-handling-audit.md) | Medium | ~15 | Low |

---

## Recommended Execution Order

### Phase 1: Critical Security (Do First)
1. **002-security-audit.md** - Fix SQL injection, API key exposure, auth issues

### Phase 2: Performance (High User Impact)
2. **003-performance-audit.md** - Fix N+1 queries, add indexes

### Phase 3: Database Foundation
3. **005-database-audit.md** - Add FKs, cache statements, standardize schema

### Phase 4: Architecture Cleanup
4. **001-architecture-audit.md** - Consolidate permissions, reorganize directories

### Phase 5: Error Handling
5. **006-error-handling-audit.md** - Fix empty catches, add notifications

### Phase 6: Dead Code Removal
6. **004-dead-code-audit.md** - Drop tables, remove unused exports

---

## Critical Issues Summary

| Issue | File | Line | Plan |
|-------|------|------|------|
| SQL Injection (dynamic columns) | `src/features/artJobs/store.ts` | 205 | 002 |
| API Key in URL | `src/features/googleVision.ts` | 118 | 002 |
| N+1 Query (member fetch) | `src/commands/modstats/leaderboard.ts` | 124 | 003 |
| N+1 Query (claim-to-decision) | `src/commands/modstats/helpers.ts` | 62 | 003 |
| Prepared statement recreation | All store files | - | 005 |
| Duplicate column | `application` table | - | 005 |

---

## How to Use These Plans

Each plan is designed to be executed by an agent independently:

```bash
# Example: Execute the security audit plan
claude "Execute the plan in docs/audits/002-security-audit.md"

# Or use the plan-executor agent
# The agent will read the plan, summarize steps, and implement incrementally
```

Each plan contains:
- **Executive Summary** - Quick overview
- **Issues to Fix** - Specific problems with file paths and line numbers
- **Code Examples** - Before/after code snippets
- **Verification Steps** - How to confirm fixes work
- **Estimated Impact** - Files modified, risk level

---

## Dependencies Between Plans

```
002-security-audit.md (standalone)
        ↓
003-performance-audit.md (standalone, can run parallel with 002)
        ↓
005-database-audit.md (some overlap with 003 on indexes)
        ↓
001-architecture-audit.md (refactoring, do after schema stable)
        ↓
006-error-handling-audit.md (can run parallel with 001)
        ↓
004-dead-code-audit.md (cleanup, do last)
```

---

## Questions Before Starting

These items need clarification before removal (documented in 004):

1. **`invalidateDraftsCache()`** - Bug or intentional?
2. **Metrics functions in modPerformance.ts** - Planned feature?
3. **`lost_and_found` table** - Corrupted, needs investigation
4. **NSFW flag store functions** - Pending moderation UI?

---

## Post-Audit Tasks

After all plans executed:

1. Run full test suite: `npm run check`
2. Deploy to staging environment
3. Monitor Sentry for new errors
4. Update CHANGELOG.md with improvements
5. Schedule follow-up audit in 3 months
