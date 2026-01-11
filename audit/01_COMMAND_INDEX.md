# Command Index

> Generated: 2026-01-11 | Auditor: Claude | Status: Complete

## Overview

The Pawtropolis Tech Discord bot has **37 registered slash commands** plus **1 context menu command**. All commands use the `wrapCommand()` instrumentation wrapper for telemetry and error handling.

## Registration Architecture

- **Registration:** `src/commands/buildCommands.ts` - exports array for Discord API sync
- **Routing:** `src/index.ts` - `commands` Collection maps name → wrapped executor
- **Wrapper:** `src/lib/cmdWrap.ts` - provides `CommandContext` with phase tracking, SQL tracking, and wide events

## Command Table

| # | Command | File | Created | Author | Complexity | Has Tests |
|---|---------|------|---------|--------|------------|-----------|
| 1 | `/accept` | `src/commands/gate/accept.ts` | 2025-11-25 | watchthelight | Medium | No |
| 2 | `/art` | `src/commands/art.ts` | 2025-12-01 | watchthelight | High | No |
| 3 | `/artistqueue` | `src/commands/artistqueue.ts` | 2025-11-29 | watchthelight | Medium | No |
| 4 | `/audit` | `src/commands/audit.ts` | 2025-12-02 | watchthelight | High | No |
| 5 | `/backfill` | `src/commands/backfill.ts` | 2025-11-25 | watchthelight | Medium | No |
| 6 | `/config` | `src/commands/config/index.ts` | 2025-12-02 | watchthelight | Very High | No |
| 7 | `/database` | `src/commands/database.ts` | 2025-11-25 | watchthelight | High | No |
| 8 | `/developer` | `src/commands/developer.ts` | 2026-01-11 | watchthelight | Medium | No |
| 9 | `/event` | `src/commands/event/index.ts` | 2026-01-04 | watchthelight | High | No |
| 10 | `/flag` | `src/commands/flag.ts` | 2025-11-25 | watchthelight | Medium | No |
| 11 | `/gate` | `src/commands/gate/gateMain.ts` | 2025-11-25 | watchthelight | High | No |
| 12 | `/health` | `src/commands/health.ts` | 2025-11-25 | watchthelight | Low | No |
| 13 | `/help` | `src/commands/help/index.ts` | 2025-12-03 | watchthelight | High | No |
| 14 | `/isitreal` | `src/commands/isitreal.ts` | 2025-12-03 | watchthelight | Medium | No |
| 15 | `/kick` | `src/commands/gate/kick.ts` | 2025-11-25 | watchthelight | Medium | No |
| 16 | `/listopen` | `src/commands/listopen.ts` | 2025-11-25 | watchthelight | Medium | No |
| 17 | `/modmail` | `src/features/modmail.ts` | 2025-11-25 | watchthelight | High | No |
| 18 | `/movie` | `src/commands/movie.ts` | 2025-11-25 | watchthelight | High | No |
| 19 | `/panic` | `src/commands/panic.ts` | 2025-11-25 | watchthelight | Medium | No |
| 20 | `/poke` | `src/commands/poke.ts` | 2025-11-25 | watchthelight | Low | No |
| 21 | `/purge` | `src/commands/purge.ts` | 2025-11-25 | watchthelight | Medium | No |
| 22 | `/redeemreward` | `src/commands/redeemreward.ts` | 2025-11-29 | watchthelight | Medium | No |
| 23 | `/reject` | `src/commands/gate/reject.ts` | 2025-11-25 | watchthelight | Medium | No |
| 24 | `/resetdata` | `src/commands/resetdata.ts` | 2025-11-25 | watchthelight | High | No |
| 25 | `/review-get-notify-config` | `src/commands/review/getNotifyConfig.ts` | 2025-11-25 | watchthelight | Low | No |
| 26 | `/review-set-listopen-output` | `src/commands/review-set-listopen-output.ts` | 2025-11-25 | watchthelight | Low | No |
| 27 | `/review-set-notify-config` | `src/commands/review/setNotifyConfig.ts` | 2025-11-25 | watchthelight | Medium | No |
| 28 | `/roles` | `src/commands/roles.ts` | 2025-11-25 | watchthelight | Low | No |
| 29 | `/sample` | `src/commands/sample.ts` | 2025-11-25 | watchthelight | Medium | No |
| 30 | `/search` | `src/commands/search.ts` | 2025-11-28 | watchthelight | High | No |
| 31 | `/send` | `src/commands/send.ts` | 2025-11-25 | watchthelight | Medium | No |
| 32 | `/stats` | `src/commands/stats/index.ts` | 2026-01-04 | watchthelight | High | No |
| 33 | `/test` | `src/commands/test.ts` | 2026-01-11 | watchthelight | Low | No |
| 34 | `/unclaim` | `src/commands/gate/unclaim.ts` | 2025-11-25 | watchthelight | Low | No |
| 35 | `/unblock` | `src/commands/unblock.ts` | 2025-11-25 | watchthelight | Medium | No |
| 36 | `/update` | `src/commands/update.ts` | 2025-11-25 | watchthelight | Medium | No |
| 37 | `/utility` | `src/commands/utility.ts` | 2026-01-11 | watchthelight | Low | No |

### Context Menu Commands

| # | Command | File | Type |
|---|---------|------|------|
| 1 | "Is It Real?" | `src/commands/isitreal.ts` | Message Context Menu |

## Complexity Ratings

- **Low**: Single action, no subcommands, minimal DB operations
- **Medium**: 1-3 subcommands, moderate DB operations, some external calls
- **High**: Multiple subcommands, complex DB queries, external APIs, button/modal handlers
- **Very High**: 10+ subcommands, complex routing, multiple handler files

## Critical Finding: Unregistered Command

**ISSUE**: `/skullmode` command file exists but is NOT registered.

- **File**: `src/commands/skullmode.ts` (created 2025-12-08)
- **Status**: Has `data` export and `execute` function
- **Problem**: Not imported in `buildCommands.ts`, not in `commands` Collection
- **Impact**: Command will not appear in Discord, users cannot use it
- **Fix Required**:
  1. Add import to `buildCommands.ts`
  2. Add to `commands.set()` in `index.ts`
  3. Run `npm run deploy:cmds`

## Button/Modal Handler Coverage

### Button Patterns (18 total)

| Pattern | Handler | File |
|---------|---------|------|
| `v1:decide:*` | `handleReviewButton` | `src/features/review/handlers/buttons.ts` |
| `v1:modmail:open:*` | `handleModmailButton` | `src/features/review/handlers/buttons.ts` |
| `v1:decide:permreject:*` | `handlePermRejectButton` | `src/features/review/handlers/buttons.ts` |
| `v1:decide:copyuid:*` | `handleCopyUidButton` | `src/features/review/handlers/buttons.ts` |
| `v1:ping:*` | `handlePingInUnverified` | `src/features/review/handlers/buttons.ts` |
| `v1:ping:delete:*` | `handleDeletePing` | `src/features/review/handlers/buttons.ts` |
| `v1:dbrecover:*` | `handleDbRecoveryButton` | `src/features/dbRecoveryButtons.ts` |
| `audit:members:*` | `handleAuditButton` | `src/commands/audit.ts` |
| `audit:nsfw:*` | `handleAuditButton` | `src/commands/audit.ts` |
| `v1:done` | `handleDoneButton` | `src/features/gate.ts` |
| `v1:start:*` | `handleStartButton` | `src/features/gate.ts` |
| `listopen:*:prev:*` | `handleListOpenPagination` | `src/commands/listopen.ts` |
| `listopen:*:next:*` | `handleListOpenPagination` | `src/commands/listopen.ts` |
| `v1:modmail:close:*` | `handleModmailCloseButton` | `src/features/modmail.ts` |
| `isitreal_*` | `routeIsitRealInteraction` | `src/commands/config/isitreal.ts` |
| `toggleapi_*` | `handleToggleApiButton` | `src/commands/config/toggleapis.ts` |
| `redeemreward:*` | `handleRedeemRewardButton` | `src/features/artistRotation/index.ts` |
| `help:*` | `handleHelpButton` | `src/commands/help/index.ts` |

### Modal Patterns (9 total)

| Pattern | Handler | File |
|---------|---------|------|
| `v1:modal:{appId}:p{page}` | `handleGateModalSubmit` | `src/features/gate.ts` |
| `v1:modal:reject:*` | `handleRejectModal` | `src/features/review/handlers/modals.ts` |
| `v1:modal:accept:*` | `handleAcceptModal` | `src/features/review/handlers/modals.ts` |
| `v1:modal:permreject:*` | `handlePermRejectModal` | `src/features/review/handlers/modals.ts` |
| `v1:modal:kick:*` | `handleKickModal` | `src/features/review/handlers/modals.ts` |
| `v1:modal:unclaim:*` | `handleUnclaimModal` | `src/features/review/handlers/modals.ts` |
| `v1:modal:18:*` | (age confirmation) | `src/features/gate.ts` |
| `v1:gate:reset:*` | `handleResetModal` | `src/commands/gate/gateMain.ts` |
| `help:modal:search` | `handleHelpModal` | `src/commands/help/index.ts` |

## Per-Command Reports

Detailed reports for each command are available in the `audit/commands/` directory (37 total):

| Command | Report | Status |
|---------|--------|--------|
| `/accept` | [accept.md](./commands/accept.md) | Audited |
| `/art` | [art.md](./commands/art.md) | Audited |
| `/artistqueue` | [artistqueue.md](./commands/artistqueue.md) | Audited |
| `/audit` | [audit.md](./commands/audit.md) | Audited |
| `/backfill` | [backfill.md](./commands/backfill.md) | Audited |
| `/config` | [config.md](./commands/config.md) | Audited |
| `/database` | [database.md](./commands/database.md) | Audited |
| `/developer` | [developer.md](./commands/developer.md) | Audited |
| `/event` | [event.md](./commands/event.md) | Audited |
| `/flag` | [flag.md](./commands/flag.md) | Audited |
| `/gate` | [gate.md](./commands/gate.md) | Audited |
| `/health` | [health.md](./commands/health.md) | Audited |
| `/help` | [help.md](./commands/help.md) | Audited |
| `/isitreal` | [isitreal.md](./commands/isitreal.md) | Audited |
| `/kick` | [kick.md](./commands/kick.md) | Audited |
| `/listopen` | [listopen.md](./commands/listopen.md) | Audited |
| `/movie` | [movie.md](./commands/movie.md) | Deprecated |
| `/panic` | [panic.md](./commands/panic.md) | Audited |
| `/poke` | [poke.md](./commands/poke.md) | Audited |
| `/purge` | [purge.md](./commands/purge.md) | Audited |
| `/redeemreward` | [redeemreward.md](./commands/redeemreward.md) | Audited |
| `/reject` | [reject.md](./commands/reject.md) | Audited |
| `/resetdata` | [resetdata.md](./commands/resetdata.md) | Audited |
| `/review-get-notify-config` | [review-get-notify-config.md](./commands/review-get-notify-config.md) | Audited |
| `/review-set-listopen-output` | [review-set-listopen-output.md](./commands/review-set-listopen-output.md) | Audited |
| `/review-set-notify-config` | [review-set-notify-config.md](./commands/review-set-notify-config.md) | Audited |
| `/roles` | [roles.md](./commands/roles.md) | Audited |
| `/sample` | [sample.md](./commands/sample.md) | Audited |
| `/search` | [search.md](./commands/search.md) | Audited |
| `/send` | [send.md](./commands/send.md) | Audited |
| `/skullmode` | [skullmode.md](./commands/skullmode.md) | **UNREGISTERED** |
| `/stats` | [stats.md](./commands/stats.md) | Audited |
| `/test` | [test.md](./commands/test.md) | Audited |
| `/unclaim` | [unclaim.md](./commands/unclaim.md) | Audited |
| `/unblock` | [unblock.md](./commands/unblock.md) | Audited |
| `/update` | [update.md](./commands/update.md) | Audited |
| `/utility` | [utility.md](./commands/utility.md) | Temporary |

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total Registered Commands | 37 |
| Context Menu Commands | 1 |
| Unregistered Commands | 1 (skullmode) |
| Button Patterns | 18 |
| Modal Patterns | 9 |
| Commands with Subcommands | 12 |
| Commands with Tests | 0 |
| Commands Audited | 37/37 |
| Commands Following Gold Standard | ~60% |
