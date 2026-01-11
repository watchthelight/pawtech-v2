# Command Unification TODO

> **Goal:** Standardize ~50 slash commands to consistent patterns for routing, signatures, instrumentation, and documentation.

---

## Phase 1: Foundation

### 1.1 Create Command Template
- [ ] Create `src/commands/_template.ts.example` with golden standard pattern
- [ ] Include all required imports (discord.js, cmdWrap, config)
- [ ] Show proper file header format (WHAT/WHY/FLOWS/DOCS)
- [ ] Demonstrate switch-based subcommand routing
- [ ] Show withStep usage for all phases
- [ ] Show withSql usage for DB operations
- [ ] Show ensureDeferred/replyOrEdit patterns

### 1.2 Create Refactoring Checklist
- [ ] Create `docs/reference/command-refactor-checklist.md`
- [ ] Include file header checklist items
- [ ] Include execute function structure items
- [ ] Include handler function requirements
- [ ] Include withStep phase requirements
- [ ] Include withSql coverage requirements
- [ ] Include verification steps

---

## Phase 2: Priority Fixes

### 2.1 Fix stats/index.ts Mixed Signatures
- [ ] Read `src/commands/stats/index.ts` current state
- [ ] Update switch to pass `ctx` to all handlers
- [ ] Add `break` statements if missing

### 2.2 Fix stats/leaderboard.ts
- [ ] Update file header (WHAT/WHY/FLOWS)
- [ ] Change signature: `handleLeaderboard(ctx: CommandContext<ChatInputCommandInteraction>)`
- [ ] Extract interaction: `const { interaction } = ctx;`
- [ ] Add withStep for permission check phase
- [ ] Add withStep for data fetch phase
- [ ] Add withStep for reply phase
- [ ] Add withSql for all DB queries
- [ ] Verify command works

### 2.3 Fix stats/user.ts
- [ ] Update file header (WHAT/WHY/FLOWS)
- [ ] Change signature: `handleUser(ctx: CommandContext<ChatInputCommandInteraction>)`
- [ ] Extract interaction: `const { interaction } = ctx;`
- [ ] Add withStep for permission check phase
- [ ] Add withStep for data fetch phase
- [ ] Add withStep for reply phase
- [ ] Add withSql for all DB queries
- [ ] Verify command works

### 2.4 Fix stats/export.ts
- [ ] Update file header (WHAT/WHY/FLOWS)
- [ ] Change signature: `handleExport(ctx: CommandContext<ChatInputCommandInteraction>)`
- [ ] Extract interaction: `const { interaction } = ctx;`
- [ ] Add withStep for permission check phase
- [ ] Add withStep for data fetch phase
- [ ] Add withStep for file generation phase
- [ ] Add withStep for reply phase
- [ ] Add withSql for all DB queries
- [ ] Verify command works

### 2.5 Fix stats/reset.ts
- [ ] Update file header (WHAT/WHY/FLOWS)
- [ ] Change signature: `handleReset(ctx: CommandContext<ChatInputCommandInteraction>)`
- [ ] Extract interaction: `const { interaction } = ctx;`
- [ ] Add withStep for permission check phase
- [ ] Add withStep for reset operation phase
- [ ] Add withStep for reply phase
- [ ] Add withSql for all DB queries
- [ ] Verify command works

### 2.6 Convert config/index.ts If/Else to Switch
- [ ] Read `src/commands/config/index.ts` current state
- [ ] Create routeKey pattern: `${subcommandGroup}:${subcommand}`
- [ ] Convert all `set:*` branches to switch cases
- [ ] Convert all `set-advanced:*` branches to switch cases
- [ ] Convert all `get:*` branches to switch cases
- [ ] Convert all `poke:*` branches to switch cases
- [ ] Convert top-level subcommands (view, isitreal, toggleapis)
- [ ] Add default case with error message
- [ ] Add section comments for each group
- [ ] Verify all subcommands still work

---

## Phase 3: Tier 1 Commands (Simple, Low Risk)

### 3.1 sample.ts
- [ ] Verify/update file header
- [ ] Add withStep for permission check
- [ ] Add withStep for sample generation
- [ ] Add withStep for reply
- [ ] Verify command works

### 3.2 unblock.ts
- [ ] Verify/update file header
- [ ] Add withStep for permission check
- [ ] Add withStep for unblock operation
- [ ] Add withStep for reply
- [ ] Add withSql if DB operations exist
- [ ] Verify command works

### 3.3 skullmode.ts
- [ ] Verify/update file header
- [ ] Add withStep for permission check
- [ ] Add withStep for toggle operation
- [ ] Add withStep for reply
- [ ] Verify command works

### 3.4 movie.ts
- [ ] Verify/update file header
- [ ] Add withStep for permission check
- [ ] Add withStep for movie lookup
- [ ] Add withStep for reply
- [ ] Add withSql if DB operations exist
- [ ] Verify command works

### 3.5 roles.ts
- [ ] Verify/update file header
- [ ] Add withStep for data collection
- [ ] Add withStep for reply
- [ ] Verify command works

---

## Phase 4: Tier 2 Commands (Moderate)

### 4.1 listopen.ts
- [ ] Verify/update file header
- [ ] Add withStep for permission check
- [ ] Add withStep for query phase
- [ ] Add withStep for reply
- [ ] Add withSql for all DB queries
- [ ] Verify command works

### 4.2 search.ts
- [ ] Verify/update file header
- [ ] Add withStep for permission check
- [ ] Add withStep for parse options
- [ ] Add withStep for search phase
- [ ] Add withStep for reply
- [ ] Add withSql for all DB queries
- [ ] Verify command works

### 4.3 flag.ts
- [ ] Verify/update file header
- [ ] Add withStep for permission check
- [ ] Add withStep for rate limit check
- [ ] Add withStep for flag operation
- [ ] Add withStep for notification
- [ ] Add withStep for reply
- [ ] Add withSql for all DB queries
- [ ] Verify command works

### 4.4 isitreal.ts
- [ ] Verify/update file header
- [ ] Add withStep for permission check
- [ ] Add withStep for image extraction
- [ ] Add withStep for API call
- [ ] Add withStep for reply
- [ ] Verify command works

### 4.5 art.ts
- [ ] Verify/update file header
- [ ] Verify switch-based routing
- [ ] Add withStep to handleJobs
- [ ] Add withStep to handleBump
- [ ] Add withStep to handleFinish
- [ ] Add withStep to handleView
- [ ] Add withStep to handleLeaderboard
- [ ] Add withStep to handleAll
- [ ] Add withStep to handleAssign
- [ ] Add withStep to handleGetstatus
- [ ] Add withSql for all DB queries in handlers
- [ ] Verify all subcommands work

### 4.6 artistqueue.ts
- [ ] Verify/update file header
- [ ] Add withStep for permission check
- [ ] Add withStep for queue operation
- [ ] Add withStep for reply
- [ ] Add withSql for all DB queries
- [ ] Verify command works

---

## Phase 5: Tier 3 - Stats Handlers (After index.ts fix)

### 5.1 stats/activity.ts
- [ ] Verify file header
- [ ] Verify withStep coverage (already good)
- [ ] Add withSql for any DB queries
- [ ] Verify command works

### 5.2 stats/approvalRate.ts
- [ ] Verify/update file header
- [ ] Verify ctx signature
- [ ] Add withStep if missing phases
- [ ] Add withSql for all DB queries
- [ ] Verify command works

### 5.3 stats/history.ts
- [ ] Verify/update file header
- [ ] Verify ctx signature
- [ ] Add withStep if missing phases
- [ ] Add withSql for all DB queries
- [ ] Verify command works

---

## Phase 6: Tier 4 - Config Handlers

### 6.1 config/setRoles.ts
- [ ] Verify/update file header
- [ ] Verify all handlers receive ctx
- [ ] Add withStep to executeSetModRoles
- [ ] Add withStep to executeSetGatekeeper
- [ ] Add withStep to executeSetReviewerRole
- [ ] Add withStep to executeSetLeadershipRole
- [ ] Add withStep to executeSetBotDevRole
- [ ] Add withStep to executeSetNotifyRole
- [ ] Add withSql for all DB operations
- [ ] Verify all handlers work

### 6.2 config/setChannels.ts
- [ ] Verify/update file header
- [ ] Verify all handlers receive ctx
- [ ] Add withStep to all channel setters
- [ ] Add withSql for all DB operations
- [ ] Verify all handlers work

### 6.3 config/setAdvanced.ts
- [ ] Verify/update file header
- [ ] Verify all handlers receive ctx
- [ ] Add withStep to all advanced setters
- [ ] Add withSql for all DB operations
- [ ] Verify all handlers work

### 6.4 config/setFeatures.ts
- [ ] Verify/update file header
- [ ] Verify all handlers receive ctx
- [ ] Add withStep to all feature toggles
- [ ] Add withSql for all DB operations
- [ ] Verify all handlers work

### 6.5 config/get.ts
- [ ] Verify/update file header
- [ ] Verify all handlers receive ctx
- [ ] Add withStep to executeGetLogging
- [ ] Add withStep to executeGetFlags
- [ ] Add withStep to executeView
- [ ] Add withSql for all DB queries
- [ ] Verify all handlers work

### 6.6 config/artist.ts
- [ ] Verify/update file header
- [ ] Verify all handlers receive ctx
- [ ] Add withStep to all handlers
- [ ] Add withSql for all DB operations
- [ ] Verify all handlers work

### 6.7 config/movie.ts
- [ ] Verify/update file header
- [ ] Verify all handlers receive ctx
- [ ] Add withStep to all handlers
- [ ] Add withSql for all DB operations
- [ ] Verify all handlers work

### 6.8 config/game.ts
- [ ] Verify/update file header
- [ ] Verify all handlers receive ctx
- [ ] Add withStep to all handlers
- [ ] Add withSql for all DB operations
- [ ] Verify all handlers work

### 6.9 config/poke.ts
- [ ] Verify/update file header
- [ ] Verify all handlers receive ctx
- [ ] Add withStep to all poke handlers
- [ ] Add withSql for all DB operations
- [ ] Verify all handlers work

### 6.10 config/isitreal.ts
- [ ] Verify/update file header
- [ ] Verify handler receives ctx
- [ ] Add withStep phases
- [ ] Verify handler works

### 6.11 config/toggleapis.ts
- [ ] Verify/update file header
- [ ] Verify handler receives ctx
- [ ] Add withStep phases
- [ ] Verify handler works

---

## Phase 7: Tier 5 - Gate Commands (Critical Path)

### 7.1 gate/index.ts
- [ ] Verify file header
- [ ] Verify barrel exports are correct

### 7.2 gate/gateMain.ts
- [ ] Verify/update file header
- [ ] Verify switch-based routing
- [ ] Ensure all handlers receive ctx
- [ ] Add withStep to all handlers
- [ ] Add withSql for all DB operations
- [ ] Verify all subcommands work

### 7.3 gate/accept.ts
- [ ] Verify/update file header
- [ ] Ensure handler receives ctx
- [ ] Add withStep for permission check
- [ ] Add withStep for member validation
- [ ] Add withStep for role assignment
- [ ] Add withStep for notification
- [ ] Add withStep for reply
- [ ] Add withSql for all DB operations
- [ ] Verify command works

### 7.4 gate/reject.ts
- [ ] Verify/update file header
- [ ] Ensure handler receives ctx
- [ ] Add withStep for permission check
- [ ] Add withStep for member validation
- [ ] Add withStep for rejection action
- [ ] Add withStep for logging
- [ ] Add withStep for reply
- [ ] Add withSql for all DB operations
- [ ] Verify command works

### 7.5 gate/kick.ts
- [ ] Verify/update file header
- [ ] Ensure handler receives ctx
- [ ] Add withStep for permission check
- [ ] Add withStep for kick operation
- [ ] Add withStep for logging
- [ ] Add withStep for reply
- [ ] Add withSql for all DB operations
- [ ] Verify command works

### 7.6 gate/unclaim.ts
- [ ] Verify/update file header
- [ ] Ensure handler receives ctx
- [ ] Add withStep for permission check
- [ ] Add withStep for unclaim operation
- [ ] Add withStep for reply
- [ ] Add withSql for all DB operations
- [ ] Verify command works

### 7.7 gate/shared.ts
- [ ] Verify/update file header
- [ ] Verify exports are complete

---

## Phase 8: Tier 6 - Event Commands

### 8.1 event/index.ts
- [ ] Verify/update file header
- [ ] Verify switch-based routing
- [ ] Ensure all handlers receive ctx
- [ ] Verify routing works

### 8.2 event/movie.ts
- [ ] Verify/update file header
- [ ] Ensure all handlers receive ctx
- [ ] Add withStep to all handlers
- [ ] Add withSql for all DB operations
- [ ] Verify all subcommands work

### 8.3 event/game.ts
- [ ] Verify/update file header
- [ ] Ensure all handlers receive ctx
- [ ] Add withStep to all handlers
- [ ] Add withSql for all DB operations
- [ ] Verify all subcommands work

### 8.4 event/data.ts
- [ ] Verify/update file header

---

## Phase 9: Tier 7 - Complex Commands (Highest Risk)

### 9.1 audit.ts
- [ ] Verify/update file header
- [ ] Map all execution paths
- [ ] Add withStep to members audit flow
- [ ] Add withStep to nsfw audit flow
- [ ] Add withStep to security audit flow
- [ ] Add withStep to acknowledge flow
- [ ] Add withStep to unacknowledge flow
- [ ] Add withSql for all DB operations
- [ ] Verify all subcommands work
- [ ] Verify button handlers work

### 9.2 database.ts
- [ ] Verify file header
- [ ] Verify withStep coverage (already good)
- [ ] Add withSql for any missing DB operations
- [ ] Verify command works

### 9.3 send.ts
- [ ] Verify/update file header
- [ ] Add withStep for permission check
- [ ] Add withStep for message parsing
- [ ] Add withStep for send operation
- [ ] Add withStep for audit logging
- [ ] Add withStep for reply
- [ ] Verify command works

### 9.4 purge.ts
- [ ] Verify/update file header
- [ ] Add withStep for permission check
- [ ] Add withStep for password validation
- [ ] Add withStep for bulk delete
- [ ] Add withStep for reply
- [ ] Verify command works

### 9.5 update.ts
- [ ] Verify file header
- [ ] Verify withStep coverage (already good)
- [ ] Add withSql for any DB operations
- [ ] Verify all subcommands work

### 9.6 help/index.ts
- [ ] Verify file header
- [ ] Verify withStep coverage (already good)
- [ ] Verify button/select handlers have proper patterns
- [ ] Verify command works

### 9.7 backfill.ts
- [ ] Verify/update file header
- [ ] Add withStep for permission check
- [ ] Add withStep for backfill operation
- [ ] Add withStep for reply
- [ ] Add withSql for all DB operations
- [ ] Verify command works

### 9.8 resetdata.ts
- [ ] Verify/update file header
- [ ] Add withStep for permission check
- [ ] Add withStep for data reset
- [ ] Add withStep for reply
- [ ] Add withSql for all DB operations
- [ ] Verify command works

### 9.9 panic.ts
- [ ] Verify/update file header
- [ ] Add withStep for permission check
- [ ] Add withStep for panic operation
- [ ] Add withStep for reply
- [ ] Verify command works

---

## Phase 10: Remaining Commands

### 10.1 poke.ts
- [ ] Verify file header (already good)
- [ ] Verify withStep coverage
- [ ] Add withSql if DB operations exist
- [ ] Verify command works

### 10.2 redeemreward.ts
- [ ] Verify/update file header
- [ ] Add withStep for all phases
- [ ] Add withSql for all DB operations
- [ ] Verify command works

### 10.3 review/setNotifyConfig.ts
- [ ] Verify/update file header
- [ ] Add withStep for all phases
- [ ] Add withSql for all DB operations
- [ ] Verify command works

### 10.4 review/getNotifyConfig.ts
- [ ] Verify/update file header
- [ ] Add withStep for all phases
- [ ] Add withSql for all DB operations
- [ ] Verify command works

### 10.5 review-set-listopen-output.ts
- [ ] Verify/update file header
- [ ] Add withStep for all phases
- [ ] Add withSql for all DB operations
- [ ] Verify command works

---

## Phase 11: Help Subsystem

### 11.1 help/components.ts
- [ ] Verify/update file header

### 11.2 help/data.ts
- [ ] Verify/update file header

### 11.3 help/autocomplete.ts
- [ ] Verify/update file header

### 11.4 help/embeds.ts
- [ ] Verify/update file header

### 11.5 help/cache.ts
- [ ] Verify/update file header

### 11.6 help/registry.ts
- [ ] Verify/update file header

### 11.7 help/metadata.ts
- [ ] Verify/update file header

---

## Phase 12: Shared Files & Utilities

### 12.1 config/shared.ts
- [ ] Verify/update file header
- [ ] Verify all needed exports are present

### 12.2 stats/shared.ts
- [ ] Verify/update file header
- [ ] Verify all needed exports are present

### 12.3 stats/data.ts
- [ ] Verify/update file header

### 12.4 config/data.ts
- [ ] Verify/update file header

### 12.5 event/data.ts
- [ ] Verify/update file header

---

## Phase 13: Infrastructure Files (Reference Only)

### 13.1 registry.ts
- [ ] Verify/update file header

### 13.2 sync.ts
- [ ] Verify/update file header

### 13.3 buildCommands.ts
- [ ] Verify file header (already good)

---

## Phase 14: Documentation

### 14.1 Update CHANGELOG.md
- [ ] Add Command Architecture Unification section under [Unreleased]
- [ ] List all standardization changes
- [ ] List all commands updated

### 14.2 Create Developer Reference
- [ ] Create `docs/reference/command-patterns.md`
- [ ] Link to template file
- [ ] Link to checklist
- [ ] Document common patterns
- [ ] Document gotchas and solutions

### 14.3 Update Existing Docs (if needed)
- [ ] Review BOT-HANDBOOK.md for any needed updates
- [ ] Review docs/MOD-HANDBOOK.md for any needed updates

---

## Phase 15: Final Verification

### 15.1 Full Test Suite
- [ ] Run `npm run check` (typecheck + lint + format + test)
- [ ] Fix any errors

### 15.2 Manual Testing
- [ ] Test /stats activity
- [ ] Test /stats leaderboard
- [ ] Test /stats user
- [ ] Test /stats export
- [ ] Test /stats reset
- [ ] Test /stats history
- [ ] Test /config view
- [ ] Test /config set mod_roles
- [ ] Test /config get logging
- [ ] Test /gate claim
- [ ] Test /accept
- [ ] Test /reject
- [ ] Test /audit security
- [ ] Test /help
- [ ] Test /flag
- [ ] Test /search

### 15.3 Error Card Verification
- [ ] Trigger an error intentionally
- [ ] Verify trace shows all phases
- [ ] Verify phase names are meaningful

### 15.4 Deploy
- [ ] Run `./deploy.sh --logs`
- [ ] Monitor for errors
- [ ] Verify production functionality

---

## Progress Tracking

| Phase | Status | Commands | Completed |
|-------|--------|----------|-----------|
| 1. Foundation | Not Started | 2 files | 0/2 |
| 2. Priority Fixes | Not Started | 6 files | 0/6 |
| 3. Tier 1 | Not Started | 5 commands | 0/5 |
| 4. Tier 2 | Not Started | 6 commands | 0/6 |
| 5. Tier 3 | Not Started | 3 handlers | 0/3 |
| 6. Tier 4 | Not Started | 11 handlers | 0/11 |
| 7. Tier 5 | Not Started | 7 files | 0/7 |
| 8. Tier 6 | Not Started | 4 files | 0/4 |
| 9. Tier 7 | Not Started | 9 commands | 0/9 |
| 10. Remaining | Not Started | 5 commands | 0/5 |
| 11. Help | Not Started | 7 files | 0/7 |
| 12. Shared | Not Started | 5 files | 0/5 |
| 13. Infrastructure | Not Started | 3 files | 0/3 |
| 14. Documentation | Not Started | 3 tasks | 0/3 |
| 15. Verification | Not Started | 4 tasks | 0/4 |

**Total: ~80 files / ~250 checkboxes**

---

## Notes

- Commit after each command refactor (not batched)
- Run `npm run check` frequently
- Test each command after refactoring
- Keep this TODO updated as work progresses
