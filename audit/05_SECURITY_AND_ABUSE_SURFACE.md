# Security and Abuse Surface Audit

Generated: 2026-01-11

## Executive Summary

The codebase demonstrates **security-conscious design** with constant-time comparisons, rate limiting, and input validation. However, several gaps exist in permission enforcement consistency and potential abuse vectors.

---

## 1. Authentication & Authorization

### Permission Systems

| System | Location | Usage |
|--------|----------|-------|
| Discord Permissions | `setDefaultMemberPermissions()` | UI visibility |
| Role-based checks | `requireMinRole()`, `requireGatekeeper()` | Runtime enforcement |
| Owner-only | `requireOwnerOnly()` | Critical operations |
| Custom checks | `canRunAllCommands`, `hasManageGuild` | Flexible OR logic |

### Permission Gaps

| Command | Discord Perm | Runtime Check | Risk |
|---------|--------------|---------------|------|
| `/search` | `null` (all) | `requireStaff` | OK - dual layer |
| `/listopen` | `null` (all) | `requireStaff` | OK - dual layer |
| `/sample` | none | Custom OR check | LOW - preview only |
| `/help` | `null` (all) | None | OK - public info |
| `/isitreal` | none | `requireMinRole` | OK |
| `/roles` | none | Manual check | ⚠️ Check at line 148 |
| `/gate reset` | `SendMessages` | `requireOwnerOnly` | OK - good dual layer |

### Inconsistencies Found

1. **Missing `setDMPermission(false)`:**
   - `roles.ts` - Can be invoked in DMs but will fail at guild check
   - `flag.ts` - Same issue
   - `art.ts` - Same issue
   - **Fix:** Add `.setDMPermission(false)` to all guild-only commands

2. **Permission check location varies:**
   - Some commands check in `execute()` before routing
   - Some commands check inside individual handlers
   - **Recommendation:** Always check at top of `execute()` before routing

---

## 2. Input Validation

### SQL Injection Analysis

**Safe Patterns Used:**
```typescript
// Parameterized queries - GOOD
db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
db.prepare("INSERT INTO table (a, b) VALUES (?, ?)").run(val1, val2);
```

**Dynamic SQL Concerns:**
| File | Line | Code | Risk |
|------|------|------|------|
| `db/db.ts` | 195 | `ALTER TABLE ${table}` | LOW - internal only |
| `db/ensure.ts` | 496 | `PRAGMA table_info(${table})` | LOW - hardcoded tables |
| `features/artJobs/store.ts` | 291 | `UPDATE ... SET ${updates}` | MEDIUM - verify source |
| `lib/dbHealthCheck.ts` | 82 | `SELECT COUNT(*) FROM ${table}` | LOW - internal only |
| `lib/config.ts` | 320,357,392,644 | Dynamic ALTER/UPDATE | LOW - internal only |

**Verdict:** Dynamic SQL uses internally-controlled values (table names, column lists). No direct user input flows into SQL structure. ✅

### Command Injection Analysis

**Protected:**
```typescript
// src/lib/env.ts
const SAFE_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const SAFE_PATH_REGEX = /^[a-zA-Z0-9_\-/.]+$/;
```

**Shell Commands Found:**
| File | Usage | Protection |
|------|-------|------------|
| `deploy.sh` | SSH/SCP commands | Hardcoded values |
| `database.ts` | None - pure DB ops | N/A |
| `update.ts` | Spawn processes | Uses fixed commands |

**Verdict:** No shell injection vectors identified. ✅

### User Input Handling

Discord's slash command options are typed and validated by Discord before reaching the bot. Additional validation:

| Input Type | Validation | Example |
|------------|------------|---------|
| User IDs | Discord validated | `interaction.options.getUser()` |
| Channel IDs | Discord validated | `interaction.options.getChannel()` |
| Strings | Length limits only | Reason fields |
| Numbers | Type coercion | Count limits |

**Gap:** No sanitization of reason/note fields before database storage or embed display. Could allow markdown injection in embeds (low risk - only visible to mods).

---

## 3. Rate Limiting

### Implementation

Located in `src/lib/rateLimiter.ts`:

| Constant | Value | Scope | Command |
|----------|-------|-------|---------|
| `AUDIT_NSFW_MS` | 1 hour | Guild | `/audit nsfw` |
| `AUDIT_MEMBERS_MS` | 1 hour | Guild | `/audit members` |
| `DATABASE_CHECK_MS` | 5 min | User | `/database check` |
| `SYNC_MS` | 10 min | Guild | `/sync` |
| `AVATAR_SCAN_MS` | 1 hour | User | Avatar change |
| `BACKFILL_MS` | 30 min | Guild | `/backfill` |
| `PURGE_MS` | 5 min | User-Guild | `/purge` |
| `FLAG_MS` | 15 sec | User | `/flag` |
| `PASSWORD_FAIL_MS` | 30 sec | User | Password attempts |
| `SEARCH_MS` | 30 sec | User | `/search` |
| `ARTISTQUEUE_SYNC_MS` | 5 min | Guild | `/artistqueue sync` |

### Rate Limiting Gaps

| Command | Has Limit | Risk | Recommendation |
|---------|-----------|------|----------------|
| `/listopen` | ❌ | MEDIUM | Add guild limit |
| `/stats leaderboard` | ❌ | LOW | Add guild limit |
| `/stats export` | ❌ | MEDIUM | Add user limit (generates files) |
| `/send` | ❌ | HIGH | Add user limit (DM spam) |
| `/poke` | ❌ | MEDIUM | Add user-guild limit |
| `/config *` | ❌ | LOW | Config changes are rare |

### Known Weakness

```typescript
// src/lib/rateLimiter.ts:16-17
// GOTCHA: This is module-level state - hot-reloads in dev will reset all cooldowns.
// Users will absolutely notice and exploit this if they figure it out.
```

**Impact:** Development reloads clear all rate limits. Production is unaffected (no hot reloads).

---

## 4. Secret Management

### Good Practices

1. **Constant-time comparison:** `src/lib/secureCompare.ts`
   - Uses `crypto.timingSafeEqual` after SHA-256 hashing
   - Prevents timing attacks on password verification

2. **Environment validation:** `src/lib/env.ts`
   - Zod schema validates all secrets at startup
   - Fails fast on missing required values

3. **No secrets in code:** All sensitive values from environment

### Secrets Used

| Variable | Purpose | Rotation |
|----------|---------|----------|
| `DISCORD_TOKEN` | Bot authentication | Manual |
| `RESET_PASSWORD` | `/resetdata` auth | Manual |
| `GOOGLE_API_KEY` | Vision API | Manual |
| `SENTRY_DSN` | Error tracking | N/A |
| `SIGHTENGINE_*` | AI detection | Manual |
| `OPTIC_API_KEY` | AI detection | Manual |
| `HIVE_API_KEY` | AI detection | Manual |
| `RAPIDAPI_KEY` | AI detection | Manual |

### Concerns

1. **Hardcoded host in deploy.sh:**
   ```bash
   REMOTE_HOST="pawtech"
   ```
   Should be environment variable.

2. **No secret rotation mechanism:** Manual process only.

---

## 5. Abuse Surface Analysis

### High-Risk Commands

| Command | Abuse Vector | Mitigation | Gap |
|---------|--------------|------------|-----|
| `/send` | DM spam | Staff-only permission | No rate limit |
| `/purge` | Mass delete | ManageMessages perm + rate limit | None |
| `/resetdata` | Data destruction | Password + owner-only | Good ✅ |
| `/database restore` | DB corruption | Password + owner-only | Good ✅ |
| `/gate reset` | Wipe gate data | Owner-only | Good ✅ |
| `/panic` | Server lockdown | Admin permission | Good ✅ |

### Medium-Risk Commands

| Command | Abuse Vector | Current Mitigation |
|---------|--------------|-------------------|
| `/flag` | False flagging | Rate limited (15s) |
| `/search` | Privacy concern | Rate limited (30s) + staff-only |
| `/audit nsfw` | API cost abuse | Rate limited (1hr) |
| `/poke` | Ping spam | Staff permission |
| `/artistqueue sync` | API abuse | Rate limited (5min) |

### Low-Risk Commands

| Command | Notes |
|---------|-------|
| `/sample` | Preview only, no side effects |
| `/help` | Read-only |
| `/health` | Read-only |
| `/isitreal` | Read-only |
| `/stats *` | Read-only (except reset) |

---

## 6. Discord-Specific Security

### Webhook/Bot Token Exposure

- ✅ Token only in environment, never logged
- ✅ Sentry filters sensitive data
- ✅ No token echoing in error messages

### Embed Injection

- ⚠️ User-provided reasons displayed in embeds
- ⚠️ No HTML but markdown possible
- **Risk:** Low - only visible to staff

### Intent Permissions

Bot requests:
- `GuildMembers` - Required for member scanning
- `MessageContent` - Not used (slash commands only)
- `GuildPresences` - Not used

### Rate Limit Handling

- ✅ Discord.js handles API rate limits automatically
- ✅ Additional app-level limits for expensive operations
- ⚠️ No retry backoff for external APIs (Vision, SightEngine)

---

## 7. Recommended Fixes

### P1: Critical

1. **Add rate limit to `/send`:**
   ```typescript
   const sendLimit = checkCooldown("send", interaction.user.id, 60 * 1000);
   if (!sendLimit.allowed) {
     return interaction.reply({
       content: `Please wait ${formatCooldown(sendLimit.remainingMs!)} before sending another DM.`,
       flags: MessageFlags.Ephemeral,
     });
   }
   ```

2. **Add `setDMPermission(false)` to all guild-only commands:**
   - `roles.ts`, `flag.ts`, `art.ts`, `artistqueue.ts`, etc.

### P2: Important

3. **Add rate limit to `/poke`:**
   ```typescript
   const POKE_COOLDOWN_MS = 60 * 1000; // 1 minute
   ```

4. **Add rate limit to `/stats export`:**
   ```typescript
   const EXPORT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
   ```

5. **Move deploy.sh secrets to environment:**
   ```bash
   REMOTE_HOST="${DEPLOY_HOST:-pawtech}"
   REMOTE_USER="${DEPLOY_USER:-ubuntu}"
   ```

### P3: Nice to Have

6. **Add retry backoff for external APIs:**
   - Vision API
   - SightEngine
   - Hive/Optic

7. **Sanitize reason fields for markdown:**
   ```typescript
   function escapeMarkdown(text: string): string {
     return text.replace(/[*_`~|]/g, '\\$&');
   }
   ```

---

## 8. Compliance Checklist

| Requirement | Status | Notes |
|-------------|--------|-------|
| No hardcoded secrets | ✅ | All from env |
| Constant-time password compare | ✅ | secureCompare.ts |
| Parameterized SQL | ✅ | All queries |
| Rate limiting | ⚠️ | Most commands |
| Input validation | ✅ | Discord validates |
| Permission checks | ⚠️ | Inconsistent location |
| Error handling | ✅ | Try/catch + Sentry |
| Audit logging | ⚠️ | Partial coverage |

---

## Summary

| Category | Status | Priority Actions |
|----------|--------|------------------|
| Authentication | ⚠️ | Standardize permission location |
| Authorization | ✅ | Good role-based system |
| Input Validation | ✅ | Discord + Zod |
| SQL Injection | ✅ | Parameterized queries |
| Rate Limiting | ⚠️ | Add to `/send`, `/poke` |
| Secrets | ⚠️ | Move deploy.sh to env |
| Abuse Prevention | ⚠️ | Add missing rate limits |

**Overall Risk Level:** LOW-MEDIUM

The codebase follows security best practices in most areas. Primary gaps are:
1. Missing rate limits on a few commands
2. Inconsistent permission check placement
3. Hardcoded values in deployment script
