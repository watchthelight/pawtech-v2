# Pawtropolis Tech Master TODO

> **Last Updated:** 2026-01-11
> **Audit Reference:** See `audit/` folder for detailed reports

---

## Critical Fixes (P1)

> Reference: [audit/00_EXEC_SUMMARY.md](audit/00_EXEC_SUMMARY.md)

### 1.1 Register Missing Command
- [ ] Add `/skullmode` to `src/commands/buildCommands.ts`
- [ ] Add to `commands.set()` in `src/index.ts`
- [ ] Run `npm run deploy:cmds`
> Reference: [audit/01_COMMAND_INDEX.md](audit/01_COMMAND_INDEX.md) - Critical Finding

### 1.2 Add Missing Rate Limit
- [ ] Add rate limit to `/send` command (DM spam risk)
  ```typescript
  const sendLimit = checkCooldown("send", interaction.user.id, 60 * 1000);
  ```
> Reference: [audit/05_SECURITY_AND_ABUSE_SURFACE.md](audit/05_SECURITY_AND_ABUSE_SURFACE.md) - P1 Critical

### 1.3 Fix Wrong ActionType
- [ ] Change `resetdata.ts` from `"modmail_close"` to proper `"metrics_reset"` ActionType
- [ ] Add `"metrics_reset"` to ActionType union in `src/logging/pretty.ts`
- [ ] Add meta config for the new action type
> Reference: [audit/02_DEAD_CODE_REPORT.md](audit/02_DEAD_CODE_REPORT.md) - Workarounds/Hacks

### 1.4 Deployment Validation
- [ ] Add `set -uo pipefail` to `deploy.sh` (line 2)
- [ ] Add post-deploy health check after PM2 restart
- [ ] Add remote tarball cleanup step
> Reference: [audit/04_DEPLOYMENT_AUDIT.md](audit/04_DEPLOYMENT_AUDIT.md) - P1 Immediate

---

## High Priority Fixes (P2)

### 2.1 Dead Code Cleanup
> Reference: [audit/02_DEAD_CODE_REPORT.md](audit/02_DEAD_CODE_REPORT.md)

Remove unused exports:
- [ ] `invalidateDraftsCache` - `src/commands/listopen.ts:285`
- [ ] `clearMetricsEpoch` - `src/features/metricsEpoch.ts:158`
- [ ] `APPLICANT_ACTIONS` - `src/features/modPerformance.ts:38`
- [ ] `getModeratorMetrics` - `src/features/modPerformance.ts:441`
- [ ] `getTopModerators` - `src/features/modPerformance.ts:458`
- [ ] `getConfiguredGuilds` - `src/features/notifyConfig.ts:186`
- [ ] `getAssignmentHistory` - `src/features/roleAutomation.ts:472`
- [ ] `getRecentAssignments` - `src/features/roleAutomation.ts:489`
- [ ] `getShortBuildId` - `src/lib/buildInfo.ts:394`
- [ ] `getBuildAge` - `src/lib/buildInfo.ts:416`
- [ ] `OAUTH_RATE_LIMIT_MAX_REQUESTS` - `src/lib/constants.ts:61`

Remove unused imports:
- [ ] `ensureDeferred` in `src/commands/movie.ts:24`
- [ ] `ensureDeferred` in `src/commands/unblock.ts:20`

### 2.2 Logging Gaps
> Reference: [audit/03_LOGGING_GAP_REPORT.md](audit/03_LOGGING_GAP_REPORT.md)

Add new ActionTypes:
- [ ] Add `flag_added`, `flag_removed` to ActionType union
- [ ] Add `message_purge` ActionType
- [ ] Add `dm_sent` ActionType
- [ ] Add `user_unblocked` ActionType
- [ ] Add meta configs for all new types

Add audit trail logging:
- [ ] Add `logActionPretty` to `/flag` command
- [ ] Add `logActionPretty` to `/purge` command
- [ ] Add `logActionPretty` to `/send` command

Add `evt` field to logger calls:
- [ ] `src/commands/unblock.ts` - add evt to all logger calls
- [ ] `src/commands/search.ts` - add evt to all logger calls
- [ ] `src/commands/stats/user.ts` - add evt field
- [ ] `src/commands/stats/export.ts` - add evt field

### 2.3 Security Fixes
> Reference: [audit/05_SECURITY_AND_ABUSE_SURFACE.md](audit/05_SECURITY_AND_ABUSE_SURFACE.md)

Add missing `setDMPermission(false)`:
- [ ] `src/commands/roles.ts`
- [ ] `src/commands/flag.ts`
- [ ] `src/commands/art.ts`
- [ ] `src/commands/artistqueue.ts`

Add rate limits:
- [ ] Add rate limit to `/poke` (60 seconds)
- [ ] Add rate limit to `/stats export` (5 minutes)

### 2.4 Deployment Improvements
> Reference: [audit/04_DEPLOYMENT_AUDIT.md](audit/04_DEPLOYMENT_AUDIT.md)

- [ ] Add SSH timeout options to all SSH commands
- [ ] Add deploy lock mechanism (prevent concurrent deploys)
- [ ] Move `REMOTE_HOST` to environment variable
- [ ] Add database backup before deploy (optional)
- [ ] Add rollback capability (keep `dist.backup`)

---

## Command Unification

> **Goal:** Standardize ~50 slash commands to consistent patterns for routing, signatures, instrumentation, and documentation.
> Reference: [.claude/plans/peaceful-stargazing-dijkstra.md](.claude/plans/peaceful-stargazing-dijkstra.md)

### Phase 1: Foundation
- [x] Create `src/commands/_template.ts.example` with golden standard pattern
- [x] Create `docs/reference/command-refactor-checklist.md`

### Phase 2: Priority Fixes
- [x] Fix stats/index.ts mixed signatures
- [x] Fix stats/leaderboard.ts - add withStep, withSql
- [x] Fix stats/user.ts - add withStep, withSql
- [x] Fix stats/export.ts - add withStep, withSql
- [x] Fix stats/reset.ts - add withStep
- [x] Convert config/index.ts if/else to switch
- [ ] Verify all stats commands work
- [ ] Verify all config subcommands work

### Phase 3: Tier 1 Commands (Simple)
- [x] sample.ts - add withStep
- [x] unblock.ts - add withStep, withSql
- [x] skullmode.ts - add withStep
- [x] movie.ts - add withStep, withSql
- [x] roles.ts - add withStep, withSql
- [ ] Verify all Tier 1 commands work

### Phase 4: Tier 2 Commands (Moderate)
- [x] listopen.ts - add withStep, withSql
- [x] search.ts - add withStep, withSql
- [ ] flag.ts - add withStep, withSql
- [ ] isitreal.ts - add withStep
- [ ] art.ts - add withStep to all 8 subcommands
- [ ] artistqueue.ts - add withStep, withSql
- [ ] Verify all Tier 2 commands work

### Phase 5-6: Config Handlers (11 files)
- [ ] config/setRoles.ts - add withStep, withSql
- [ ] config/setChannels.ts - add withStep, withSql
- [ ] config/setAdvanced.ts - add withStep, withSql
- [ ] config/setFeatures.ts - add withStep, withSql
- [ ] config/get.ts - add withStep, withSql
- [ ] config/artist.ts - add withStep, withSql
- [ ] config/movie.ts - add withStep, withSql
- [ ] config/game.ts - add withStep, withSql
- [ ] config/poke.ts - add withStep, withSql
- [ ] config/isitreal.ts - add withStep
- [ ] config/toggleapis.ts - add withStep

### Phase 7: Gate Commands (7 files)
- [ ] gate/gateMain.ts - add withStep, withSql
- [ ] gate/accept.ts - add withStep, withSql
- [ ] gate/reject.ts - add withStep, withSql
- [ ] gate/kick.ts - add withStep
- [ ] gate/unclaim.ts - add withStep, withSql
- [ ] gate/index.ts - verify exports
- [ ] gate/shared.ts - verify exports

### Phase 8: Event Commands
- [ ] event/index.ts - verify routing
- [ ] event/movie.ts - add withStep, withSql
- [ ] event/game.ts - add withStep, withSql

### Phase 9: Complex Commands
- [ ] audit.ts - add withStep throughout
- [ ] database.ts - verify withStep coverage
- [ ] send.ts - add withStep
- [ ] purge.ts - add withStep
- [ ] update.ts - verify patterns
- [ ] help/index.ts - verify patterns
- [ ] backfill.ts - add withStep, withSql
- [ ] resetdata.ts - add withStep, withSql
- [ ] panic.ts - add withStep

### Phase 10: Remaining Commands
- [ ] poke.ts - verify withStep
- [ ] redeemreward.ts - add withStep, withSql
- [ ] review/setNotifyConfig.ts - add withStep, withSql
- [ ] review/getNotifyConfig.ts - add withStep, withSql
- [ ] review-set-listopen-output.ts - add withStep, withSql

---

## Testing

> Reference: [audit/00_EXEC_SUMMARY.md](audit/00_EXEC_SUMMARY.md) - Test Coverage: 2/10

**Current State:** 0 of 37 commands have tests

### Critical Test Coverage Needed
- [ ] Add tests for permission helpers (`requireMinRole`, `requireGatekeeper`, etc.)
- [ ] Add tests for rate limiter (`checkCooldown`, `formatCooldown`)
- [ ] Add tests for gate flow (accept/reject/kick)
- [ ] Add tests for `secureCompare` function

### Command Tests
- [ ] `/health` - basic functionality
- [ ] `/flag` - add/remove flag flow
- [ ] `/search` - permission + rate limit
- [ ] `/gate` - claim/accept/reject flow
- [ ] `/stats reset` - password validation

---

## Documentation

### Update Changelog
- [ ] Add Command Architecture Unification section under `[Unreleased]`
- [ ] Document all standardization changes
- [ ] Document security fixes
- [ ] Document dead code removal

### Developer Reference
- [ ] Create `docs/reference/command-patterns.md`
- [ ] Link to template and checklist
- [ ] Document common patterns and gotchas

### Deprecation
- [ ] Document `/movie` deprecation timeline (use `/event movie` instead)
- [ ] Add deprecation notice to `/movie` command response

---

## Final Verification

### Pre-Deploy Checks
- [ ] Run `npm run check` (typecheck + lint + format + test)
- [ ] Fix any errors

### Manual Testing
- [ ] Test /stats (activity, leaderboard, user, export, reset)
- [ ] Test /config (view, set, get)
- [ ] Test /gate (claim, accept, reject, kick)
- [ ] Test /audit (security, members, nsfw)
- [ ] Test /help
- [ ] Test /flag and /search

### Error Card Verification
- [ ] Trigger an error intentionally
- [ ] Verify trace shows all withStep phases
- [ ] Verify SQL queries appear in trace

### Deploy
- [ ] Run `./deploy.sh --logs`
- [ ] Monitor for errors
- [ ] Verify production functionality

---

## Audit Reports Reference

| Report | Contents |
|--------|----------|
| [00_EXEC_SUMMARY.md](audit/00_EXEC_SUMMARY.md) | Executive overview, health scores, action plan |
| [01_COMMAND_INDEX.md](audit/01_COMMAND_INDEX.md) | All 37 commands, handlers, button/modal patterns |
| [02_DEAD_CODE_REPORT.md](audit/02_DEAD_CODE_REPORT.md) | 11 unused exports, deprecated code |
| [03_LOGGING_GAP_REPORT.md](audit/03_LOGGING_GAP_REPORT.md) | Missing audit trails, evt fields |
| [04_DEPLOYMENT_AUDIT.md](audit/04_DEPLOYMENT_AUDIT.md) | deploy.sh analysis, robustness improvements |
| [05_SECURITY_AND_ABUSE_SURFACE.md](audit/05_SECURITY_AND_ABUSE_SURFACE.md) | Permissions, rate limits, secrets |

### Per-Command Reports (37/37 complete)
See `audit/commands/` for detailed reports on all commands:
- Gate: accept, reject, kick, unclaim, gate
- Review: listopen, search, flag, sample
- Config: config, review-get-notify-config, review-set-notify-config, review-set-listopen-output
- Stats: stats, roles
- Events: event, movie (deprecated), poke
- Moderation: purge, send, panic, unblock, backfill, resetdata
- Art: art, artistqueue, redeemreward
- Utility: health, help, isitreal, audit, database, update, developer, skullmode, test, utility

---

## Recently Completed

### Full Repo Audit (2026-01-11)
- [x] Created `audit/00_EXEC_SUMMARY.md` - Executive summary with health scores
- [x] Created `audit/01_COMMAND_INDEX.md` - All 37 commands indexed
- [x] Created `audit/02_DEAD_CODE_REPORT.md` - 11 unused exports identified
- [x] Created `audit/03_LOGGING_GAP_REPORT.md` - Logging consistency analysis
- [x] Created `audit/04_DEPLOYMENT_AUDIT.md` - deploy.sh robustness improvements
- [x] Created `audit/05_SECURITY_AND_ABUSE_SURFACE.md` - Security analysis
- [x] Created 37 per-command audit reports in `audit/commands/`

### Build Identity & Response State (2026-01-11)
- [x] Created `src/lib/buildInfo.ts` - Central build identity module
- [x] Created `scripts/inject-build-info.ts` - Build-time script for `.env.build`
- [x] Updated `src/lib/wideEvent.ts` - Added ResponseState interface and build identity fields
- [x] Updated `src/lib/wideEventEmitter.ts` - Logs build_* and resp_* prefixes
- [x] Updated `src/lib/cmdWrap.ts` - Tracks error card delivery via setErrorCardSent()
- [x] Updated `src/lib/errorCardV2.ts` - New "Build Identity" and "Response State" embed sections
- [x] Updated `src/lib/sentry.ts` - Release format: `pawtropolis-tech@4.9.2+abc1234`
- [x] Updated `deploy.sh` - Fixed step numbering (7 steps), added build metadata injection
- [x] Updated `src/commands/health.ts` - Displays build info (version, SHA, age, deploy ID, env)

---

## Progress Summary

| Category | Status | Priority |
|----------|--------|----------|
| Full Repo Audit | Complete | Done |
| Critical Fixes (P1) | 0/4 | Immediate |
| Dead Code Cleanup | 0/13 | This Week |
| Logging Gaps | 0/12 | This Week |
| Security Fixes | 0/8 | This Week |
| Command Unification | ~30% | Ongoing |
| Testing | 0/37 | Ongoing |
| Documentation | 0/4 | After fixes |
| Build Identity | Complete | Done |

---

## Notes

- Commit after each logical change (not batched)
- Run `npm run check` frequently
- Test each command after refactoring
- Keep this TODO updated as work progresses
- Reference audit reports for detailed context
