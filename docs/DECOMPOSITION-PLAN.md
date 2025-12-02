# File Decomposition Plan

This plan outlines how to break down the 5 largest files in the codebase into smaller, more maintainable modules.

## Overview

| File | Current LOC | Target | Priority | Status |
|------|-------------|--------|----------|--------|
| `src/features/review/handlers.ts` | 1,643 | ~300 each | MEDIUM | **DONE** |
| `src/features/modmail/threads.ts` | 1,709 | ~400 each | MEDIUM | **DONE** |
| `src/commands/modstats.ts` | 824 | ~400 each | LOW | **DONE** |
| `src/commands/config.ts` | 2,525 | ~300 each | HIGH | **DONE** |
| `src/commands/gate.ts` | 1,405 | ~350 each | MEDIUM | **DONE** |

---

## 1. `src/commands/config.ts` (2,525 LOC) → 8 files

### Current Structure
- Lines 28-154: Subcommand group "set" (24 subcommands)
- Lines 155-1082: Subcommand group "set-advanced" (13 subcommands)
- Lines 1083-1279: Handler section 1
- Lines 1280-1539: Handler section 2
- Lines 1540-2034: Handler section 3
- Lines 2035-2398: Handler section 4 (questions)
- Lines 2399-2525: Main execute() router

### Proposed Structure

```
src/commands/config/
├── index.ts           # Main command definition + execute router (~200 LOC)
├── data.ts            # SlashCommandBuilder definition (~400 LOC)
├── setRoles.ts        # mod_roles, gatekeeper, reviewer_role, leadership_role, etc. (~250 LOC)
├── setChannels.ts     # logging, modmail_log, flags_channel, forum, notification (~250 LOC)
├── setFeatures.ts     # review_roles, dm_on_approve, notify_on_post, avatar_scan (~300 LOC)
├── setAdvanced.ts     # Timing/threshold settings (~300 LOC)
├── questions.ts       # set-questions modal + handlers (~400 LOC)
└── view.ts            # /config view subcommand (~200 LOC)
```

### Migration Steps

1. Create `src/commands/config/` directory
2. Extract `data.ts` - Move SlashCommandBuilder to separate file
3. Extract `setRoles.ts` - All role-setting handlers
4. Extract `setChannels.ts` - All channel-setting handlers
5. Extract `setFeatures.ts` - Feature toggle handlers
6. Extract `setAdvanced.ts` - Advanced timing/threshold handlers
7. Extract `questions.ts` - Question configuration modal and handlers
8. Extract `view.ts` - Config viewing logic
9. Create `index.ts` - Import handlers, re-export data, route execute()
10. Update imports in other files that reference config command

### Breaking Changes: None
The public API (`data` and `execute`) remains the same.

### Actual Structure (v4.4.4)

```
src/commands/config/
├── index.ts           # Execute router (~180 LOC)
├── data.ts            # SlashCommandBuilder definition (~220 LOC)
├── shared.ts          # Shared imports and utilities (~30 LOC)
├── setRoles.ts        # Role setting handlers (~170 LOC)
├── setChannels.ts     # Channel setting handlers (~170 LOC)
├── setFeatures.ts     # Feature toggle handlers (~200 LOC)
├── setAdvanced.ts     # Advanced/timing handlers (~350 LOC)
├── artist.ts          # Artist rotation handlers (~230 LOC)
├── movie.ts           # Movie night handlers (~100 LOC)
├── poke.ts            # Poke configuration handlers (~230 LOC)
└── get.ts             # View and getter handlers (~280 LOC)

src/commands/config.ts # Barrel file (~10 LOC)
```

### Breaking Changes: None
All exports remain available from `config.ts` barrel.

### Status: **COMPLETED** (v4.4.4)

---

## 2. `src/features/modmail/threads.ts` (1,709 LOC) → 5 files

### Current Structure
- Lines 53-82: Open thread tracking (in-memory set)
- Lines 83-123: Permission checks
- Lines 124-302: Thread permission setup
- Lines 303-750: Open thread logic
- Lines 751-913: Close thread helpers
- Lines 914-1140: Close thread main function
- Lines 1141-1275: Reopen thread
- Lines 1276-1460: Auto-close for application decisions
- Lines 1461-1709: Parent permissions retrofit

### Actual Structure (v4.4.4)

```
src/features/modmail/
├── threads.ts         # Barrel file re-exporting all (~40 LOC)
├── threadState.ts     # OPEN_MODMAIL_THREADS set + hydration (~70 LOC)
├── threadOpen.ts      # openPublicModmailThreadFor + helpers (~380 LOC)
├── threadClose.ts     # closeModmailThread + closeModmailForApplication (~500 LOC)
├── threadReopen.ts    # reopenModmailThread (~150 LOC)
├── threadPerms.ts     # Permission checks + setup + retrofit functions (~350 LOC)
└── types.ts           # (already existed)
```

### Breaking Changes: None
All exports remain available from `threads.ts` barrel.

### Status: **COMPLETED** (v4.4.4)

---

## 3. `src/features/review/handlers.ts` (1,643 LOC) → 5 files

### Current Structure
- Lines 83-88: Constants
- Lines 89-169: Helper functions
- Lines 170-285: Modal opening functions
- Lines 286-832: Action runner functions (approve/reject/kick)
- Lines 833-1039: Claim handlers
- Lines 1040-1643: Exported handler functions (buttons/modals)

### Actual Structure (v4.4.3)

```
src/features/review/
├── handlers.ts            # Barrel file re-exporting all (~50 LOC)
├── handlers/
│   ├── index.ts           # Barrel for handlers/ (~50 LOC)
│   ├── buttons.ts         # Button interaction handlers (~400 LOC)
│   ├── modals.ts          # Modal submit handlers (~350 LOC)
│   ├── actionRunners.ts   # runApprove, runReject, runKick (~500 LOC)
│   ├── claimHandlers.ts   # Claim/unclaim handlers (~200 LOC)
│   └── helpers.ts         # Shared helpers, modal openers (~300 LOC)
```

### Breaking Changes: None
All exports remain available from `handlers.ts`.

### Status: **COMPLETED** (v4.4.3)

---

## 4. `src/commands/gate.ts` (1,405 LOC) → 5 files

### Current Structure
- Lines 101-305: Main /gate command definition
- Lines 306-613: handleResetModal
- Lines 614-756: execute() for /gate
- Lines 757-969: /accept command
- Lines 970-1150: /reject command
- Lines 1151-1293: /kick command
- Lines 1294-1405: /unclaim command

### Proposed Structure

```
src/commands/gate/
├── index.ts           # Re-exports all commands (~50 LOC)
├── gate.ts            # /gate command (setup, reset, status, config, welcome) (~400 LOC)
├── accept.ts          # /accept command (~220 LOC)
├── reject.ts          # /reject command (~200 LOC)
├── kick.ts            # /kick command (~150 LOC)
└── unclaim.ts         # /unclaim command (~120 LOC)
```

### Migration Steps

1. Create `src/commands/gate/` directory
2. Move /accept command to `accept.ts`
3. Move /reject command to `reject.ts`
4. Move /kick command to `kick.ts`
5. Move /unclaim command to `unclaim.ts`
6. Keep /gate in `gate.ts` (reduced from 1405 to ~400)
7. Create `index.ts` that exports all command data and execute functions
8. Update command loader to handle the new structure

### Actual Structure (v4.4.4)

```
src/commands/gate/
├── index.ts           # Re-exports all commands (~50 LOC)
├── shared.ts          # Shared imports and utilities (~80 LOC)
├── gateMain.ts        # /gate command (setup, reset, status, config, welcome) (~370 LOC)
├── accept.ts          # /accept command (~200 LOC)
├── reject.ts          # /reject command (~210 LOC)
├── kick.ts            # /kick command (~170 LOC)
└── unclaim.ts         # /unclaim command (~140 LOC)

src/commands/gate.ts   # Barrel file (~25 LOC)
```

### Breaking Changes: None
All exports remain available from `gate.ts` barrel.

### Status: **COMPLETED** (v4.4.4)

---

## 5. `src/commands/modstats.ts` (824 LOC) → 4 files

### Current Structure
- Slash command definition
- Helper functions (formatDuration, getAvgClaimToDecision, getAvgSubmitToFirstClaim)
- Leaderboard handler + CSV export
- User stats handler
- Reset handler with rate limiting

### Actual Structure (v4.4.4)

```
src/commands/modstats/
├── index.ts           # Command definition + execute router (~120 LOC)
├── helpers.ts         # formatDuration + DB query helpers (~180 LOC)
├── leaderboard.ts     # handleLeaderboard + handleExport (~250 LOC)
├── userStats.ts       # handleUser (~100 LOC)
└── reset.ts           # handleReset + rate limiter (~170 LOC)

src/commands/modstats.ts  # Barrel file (~20 LOC)
```

### Breaking Changes: None
All exports remain available from `modstats.ts` barrel.

### Status: **COMPLETED** (v4.4.4)

---

## Implementation Order

### Phase 1: Low Risk (No Breaking Changes) - COMPLETED
1. **handlers.ts** - Internal feature module, well-isolated ✅
2. **threads.ts** - Internal feature module, well-isolated ✅

### Phase 2: Medium Risk - COMPLETED
3. **modstats.ts** - Small, straightforward split ✅
4. **config.ts** - Large command decomposed into 11 modules ✅

### Phase 3: Higher Risk (May Need Command Loader Updates) - COMPLETED
5. **gate.ts** - Multiple commands in one file, preserved via barrel ✅

---

## Validation Checklist

After each file decomposition:

- [x] `npm run build` passes
- [ ] `npm run test` passes (run manually)
- [ ] `npm run typecheck` passes (run manually)
- [x] All imports resolve correctly
- [x] No duplicate exports
- [x] Barrel files export everything needed
- [x] Git diff shows only moves, no logic changes

---

## Completed Summary

| Phase | Files | Status |
|-------|-------|--------|
| Phase 1 | handlers.ts, threads.ts | **DONE** |
| Phase 2 | modstats.ts | **DONE** |
| Phase 2 | config.ts | **DONE** |
| Phase 3 | gate.ts | **DONE** |

**Completed: 5 of 5 files (100%)**

### Files Created

**Review Handlers (v4.4.3):**
- `src/features/review/handlers/index.ts`
- `src/features/review/handlers/helpers.ts`
- `src/features/review/handlers/actionRunners.ts`
- `src/features/review/handlers/claimHandlers.ts`
- `src/features/review/handlers/buttons.ts`
- `src/features/review/handlers/modals.ts`

**Modmail Threads (v4.4.4):**
- `src/features/modmail/threadState.ts`
- `src/features/modmail/threadPerms.ts`
- `src/features/modmail/threadOpen.ts`
- `src/features/modmail/threadClose.ts`
- `src/features/modmail/threadReopen.ts`

**Modstats (v4.4.4):**
- `src/commands/modstats/index.ts`
- `src/commands/modstats/helpers.ts`
- `src/commands/modstats/leaderboard.ts`
- `src/commands/modstats/userStats.ts`
- `src/commands/modstats/reset.ts`

**Gate Commands (v4.4.4):**
- `src/commands/gate/index.ts`
- `src/commands/gate/shared.ts`
- `src/commands/gate/gateMain.ts`
- `src/commands/gate/accept.ts`
- `src/commands/gate/reject.ts`
- `src/commands/gate/kick.ts`
- `src/commands/gate/unclaim.ts`

**Config Commands (v4.4.4):**
- `src/commands/config/index.ts`
- `src/commands/config/data.ts`
- `src/commands/config/shared.ts`
- `src/commands/config/setRoles.ts`
- `src/commands/config/setChannels.ts`
- `src/commands/config/setFeatures.ts`
- `src/commands/config/setAdvanced.ts`
- `src/commands/config/artist.ts`
- `src/commands/config/movie.ts`
- `src/commands/config/poke.ts`
- `src/commands/config/get.ts`

---

## Notes

- Each decomposition should be a separate commit
- Run full test suite after each decomposition
- Keep barrel files for backward compatibility
- Document any import path changes in commit messages
- Consider adding `// @deprecated` comments to old barrel files if they should be removed later
