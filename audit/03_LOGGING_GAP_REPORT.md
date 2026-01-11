# Logging Gap Report

Generated: 2026-01-11

## Executive Summary

The codebase has **two logging systems**: structured pino logger for operational logs and `logActionPretty` for audit trail embeds. Coverage is uneven—some commands have excellent tracing while others log nothing actionable.

---

## 1. Logging Infrastructure

### Available Systems

| System | Location | Purpose | Output |
|--------|----------|---------|--------|
| `logger.*` (pino) | `src/lib/logger.ts` | Operational logs | stdout/pino |
| `logActionPretty` | `src/logging/pretty.ts` | Audit trail embeds | logging channel + DB |
| `logActionJSON` | `src/features/logger.ts` | Structured JSON logs | logging channel |
| `postAuditEmbed` | `src/ui/embeds.ts` | Custom audit embeds | logging channel |

### ActionType Coverage

Currently defined action types (35 total):
- Application flow: `app_submitted`, `claim`, `unclaim`, `approve`, `reject`, `need_info`, `perm_reject`, `kick`
- Modmail: `modmail_open`, `modmail_close`, `modmail_transcript_fail`
- Member events: `member_join`
- Database ops: `db_recover_list`, `db_recover_validate`, `db_recover_restore`
- Health: `ops_health_alert`, `ops_health_ack`, `ops_health_resolve`
- Listopen: `listopen_view`, `listopen_view_all`, `listopen_view_drafts`, `set_listopen_output`
- Forum: `forum_post_ping`, `forum_post_ping_fail`
- History: `modhistory_view`, `modhistory_export`, `modhistory_list`
- Roles: `role_grant`, `role_grant_skipped`, `role_grant_blocked`
- Panic: `panic_enabled`, `panic_disabled`
- Movie: `movie_tier_granted`, `movie_tier_progress`, `movie_manual_add`, `movie_credit`, `movie_bump`

---

## 2. Commands Without Audit Trail Logging

### Critical Gap: No `logActionPretty` or `postAuditEmbed`

These commands perform moderation actions but don't post to the audit log channel:

| Command | File | Action Performed | Risk |
|---------|------|------------------|------|
| `/flag` | `flag.ts` | Flags user for review | HIGH |
| `/search` | `search.ts` | Queries application history | MEDIUM |
| `/sample` | `sample.ts` | Preview only | LOW |
| `/art` | `art.ts` | Art submission management | MEDIUM |
| `/artistqueue` | `artistqueue.ts` | Queue management | MEDIUM |
| `/skullmode` | `skullmode.ts` | Enables skull avatar mode | LOW |
| `/help` | `help/index.ts` | Help display | LOW |
| `/developer` | `developer.ts` | Dev utilities | MEDIUM |

### Missing Action Types Needed

| Action | Command | Suggested Type |
|--------|---------|----------------|
| Flag added | `/flag add` | `flag_added` |
| Flag removed | `/flag remove` | `flag_removed` |
| Search performed | `/search` | `search_performed` |
| Art submission reviewed | `/art review` | `art_reviewed` |
| Artist queue modified | `/artistqueue` | `queue_modified` |
| User unblocked | `/unblock` | `user_unblocked` |

---

## 3. Commands With Partial Logging

### Has Logger But No Audit Embed

| Command | File | Logger Calls | Missing |
|---------|------|--------------|---------|
| `/purge` | `purge.ts` | 7 | Audit embed for message deletion |
| `/send` | `send.ts` | 7 | Audit embed for DM sends |
| `/backfill` | `backfill.ts` | 6 | Audit embed for retroactive updates |
| `/resetdata` | `resetdata.ts` | 7 | Audit embed (uses wrong action type) |

### Inconsistent `evt` Field Usage

The `evt` field provides structured event classification. Some commands use it consistently, others don't:

**Good (Uses `evt:`):**
- `roles.ts` - All tier operations
- `config/setRoles.ts` - All config changes
- `panic.ts` - Enable/disable events
- `event/movie.ts`, `event/game.ts` - Start/end events
- `gate/gateMain.ts` - Reset and seed operations

**Missing `evt:` field:**
- `unblock.ts` - Uses generic log messages
- `search.ts` - No structured event logging
- `listopen.ts` - Partially implemented
- `stats/user.ts` - Missing event classification
- `stats/export.ts` - Missing event classification

---

## 4. Logging Level Gaps

### Error Handling Without Logging

Some error paths don't log before returning:

| File | Location | Issue |
|------|----------|-------|
| `sample.ts` | entire file | No error logging at all |
| `skullmode.ts` | handleDisable | Silent failure possible |
| `art.ts` | multiple handlers | Catches errors but doesn't log |
| `help/index.ts` | execute | Relies on wrapper for error logging |

### Debug/Info Level Inconsistency

| Level | Used For | Notes |
|-------|----------|-------|
| DEBUG | User lookup failures, skipped operations | Inconsistent usage |
| INFO | Successful operations | Should always include `evt` |
| WARN | DM failures, non-critical issues | Generally good |
| ERROR | Critical failures | Should always include stack trace |

---

## 5. Recommended New ActionTypes

```typescript
// Add to src/logging/pretty.ts ActionType union:

// Flag system
| "flag_added"
| "flag_removed"
| "flag_threshold_triggered"

// Search/Audit
| "search_performed"
| "user_unblocked"

// Art system
| "art_submitted"
| "art_approved"
| "art_rejected"
| "art_queue_modified"

// Admin actions
| "message_purge"
| "dm_sent"
| "data_reset"
| "backfill_completed"

// Config changes (consolidate)
| "config_updated"
```

---

## 6. Recommended Fixes

### P1: Critical Audit Gaps

1. **Add audit logging to `/flag`**
   ```typescript
   // After flagging user
   await logActionPretty(interaction.guild!, {
     actorId: interaction.user.id,
     subjectId: targetUser.id,
     action: "flag_added",
     reason: flagReason,
     meta: { flagType, count: newFlagCount }
   });
   ```

2. **Add audit logging to `/unblock`**
   - Already has `postAuditEmbed` ✓
   - Add `logActionPretty` for DB trail

3. **Fix `/resetdata` action type**
   - Currently uses `"modmail_close"`
   - Should use `"data_reset"` or new `"metrics_reset"`

### P2: Consistency Fixes

1. **Add `evt` field to all logger calls**
   - Standardize: `logger.info({ evt: "operation_name", ...data }, "message")`

2. **Add audit embeds to `/purge`**
   ```typescript
   await logActionPretty(guild, {
     actorId: interaction.user.id,
     action: "message_purge",
     meta: { channelId, count: deleted, reason }
   });
   ```

3. **Add audit embeds to `/send`**
   - Log DM send attempts to mod channel
   - Include success/failure counts

### P3: Nice to Have

1. **Centralize config change logging**
   - All config commands should use consistent format
   - Consider single `"config_updated"` action with `meta.setting`

2. **Add search logging**
   - Track who searches what for privacy audit
   - Consider rate limiting visibility

---

## 7. Verification Commands

```bash
# Check for logger usage
rg "logger\.(info|warn|error|debug)" src/commands --type ts | wc -l

# Check for evt field usage
rg "evt:" src/commands --type ts | wc -l

# Check for logActionPretty usage
rg "logActionPretty" src/commands --type ts

# Check for postAuditEmbed usage
rg "postAuditEmbed" src/commands --type ts

# Find commands without any logging
for f in src/commands/*.ts; do
  if ! grep -q "logger\.\|logActionPretty\|postAuditEmbed" "$f"; then
    echo "No logging: $f"
  fi
done
```

---

## Summary

| Category | Status | Count |
|----------|--------|-------|
| Commands with audit logging | ✅ | 15 |
| Commands with logger only | ⚠️ | 25 |
| Commands with no logging | ❌ | 8 |
| Missing ActionTypes | ❌ | 12 |
| Missing `evt` field | ⚠️ | ~40 log calls |

**Recommended Commits:**

1. `feat(logging): add flag_added, flag_removed ActionTypes`
2. `feat(flag): add audit trail logging`
3. `fix(resetdata): use proper action type instead of modmail_close`
4. `refactor(logging): add evt field to all logger calls`
5. `feat(logging): add message_purge, dm_sent ActionTypes`
6. `feat(purge): add audit trail logging`
