# Command Audit: /stats

> File: `src/commands/stats/index.ts` | Created: 2026-01-04 | Author: watchthelight

## Overview

**WHAT:** Unified analytics command for moderation statistics.
**WHY:** Consolidates analytics commands under unified /stats parent.
**FLOWS:**
- `/stats activity` → Server activity heatmap (SM+)
- `/stats approval-rate` → Approval/rejection analytics (Staff)
- `/stats leaderboard` → Moderator rankings (GK+)
- `/stats user [@user]` → Individual mod stats (GK+)
- `/stats export` → Full CSV export (SA+)
- `/stats reset` → Clear and rebuild stats (SA+, password)
- `/stats history` → Mod action history (Leadership)

## Architecture

Router that delegates to handler files:
- `activity.ts` - Heatmap generation
- `approvalRate.ts` - Approval analytics
- `leaderboard.ts` - Rankings
- `user.ts` - Individual stats
- `export.ts` - CSV generation
- `reset.ts` - Stats rebuild
- `history.ts` - Action history

## Permissions Model

| Subcommand | Required Role | Notes |
|------------|---------------|-------|
| activity | SM+ | Staff |
| approval-rate | Staff | |
| leaderboard | GK+ | Gatekeeper+ |
| user | GK+ | Gatekeeper+ |
| export | SA+ | Senior Admin+ |
| reset | SA+ | + Password |
| history | Leadership | |

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete with FLOWS |
| Switch-based routing | ✅ | Clean switch |
| Permission per-handler | ✅ | Each handler checks |
| Handler signatures | ✅ | All receive ctx |

## Handler Status

| File | withStep | withSql | Notes |
|------|----------|---------|-------|
| activity.ts | ✅ | ✅ | Good |
| approvalRate.ts | ⚠️ | ⚠️ | Partial |
| leaderboard.ts | ✅ | ✅ | Fixed |
| user.ts | ✅ | ✅ | Fixed |
| export.ts | ✅ | ✅ | Fixed |
| reset.ts | ✅ | ⚠️ | Needs withSql |
| history.ts | ⚠️ | ⚠️ | Partial |

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Some handlers need withSql | S |
| P2 | history.ts needs withStep | S |

**Status:** Mostly complete after recent refactoring. A few handlers need final touches.
