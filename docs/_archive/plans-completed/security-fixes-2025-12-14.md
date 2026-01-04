# Security Fixes Implementation Plan

**Date:** 2025-12-14
**Status:** ✅ COMPLETED
**Priority:** Critical security hardening based on comprehensive audit

---

## Implementation Summary

All security fixes from this plan have been implemented and deployed. See CHANGELOG.md for the complete list of changes under the `[Unreleased]` → `### Security` section.

---

## Phase 1: Critical Rate Limiting (Immediate)

### 1.1 Avatar NSFW Monitor Rate Limiting
**File:** `src/features/avatarNsfwMonitor.ts`

**Problem:** Google Vision API calls on every avatar change with no throttling. Attackers can rapidly change avatars to exhaust API quota and incur costs.

**Solution:**
- Add per-user cooldown Map (1 hour between scans per user)
- Add global throttle (max 10 scans per minute across all users)
- Skip scan if user was scanned recently

**Implementation:**
```typescript
const AVATAR_SCAN_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour per user
const avatarScanCooldowns = new Map<string, number>();

// Before calling detectNsfwVision():
const cooldownKey = `${guildId}:${userId}`;
const lastScan = avatarScanCooldowns.get(cooldownKey);
if (lastScan && Date.now() - lastScan < AVATAR_SCAN_COOLDOWN_MS) {
  logger.debug({ userId, guildId }, "[avatarScan] rate limited");
  return;
}
avatarScanCooldowns.set(cooldownKey, Date.now());
```

### 1.2 /search Username Lookup Throttling
**File:** `src/commands/search.ts`

**Problem:** Up to 100 Discord API calls in rapid succession when searching by username.

**Solution:**
- Reduce LIMIT from 100 to 25 candidates
- Add 50ms delay between API calls
- Consider caching username lookups

**Implementation:**
```typescript
// Change LIMIT from 100 to 25
const candidateUserIds = getCandidateUserIds(guildId, trimmedQuery, 25);

// Add delay helper
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// In the loop:
for (const { user_id } of candidateUserIds) {
  await delay(50); // 50ms between API calls
  const user = await interaction.client.users.fetch(user_id);
  // ...
}
```

---

## Phase 2: High Priority Fixes

### 2.1 /backfill Cooldown
**File:** `src/commands/backfill.ts`

**Problem:** Expensive background process with no cooldown. Multiple concurrent runs exhaust resources.

**Solution:**
- Add 30-minute per-guild cooldown using existing rateLimiter

**Implementation:**
```typescript
import { checkCooldown, formatCooldown, COOLDOWNS } from "../lib/rateLimiter.js";

// Add to COOLDOWNS in rateLimiter.ts:
BACKFILL_MS: 30 * 60 * 1000, // 30 minutes

// In execute():
const cooldownResult = checkCooldown("backfill", guildId, COOLDOWNS.BACKFILL_MS);
if (!cooldownResult.allowed) {
  await interaction.reply({
    content: `Backfill on cooldown. Try again in ${formatCooldown(cooldownResult.remainingMs!)}.`,
    ephemeral: true,
  });
  return;
}
```

### 2.2 /purge Cooldown
**File:** `src/commands/purge.ts`

**Problem:** Password-protected but no rate limit. Attacker with password can spam.

**Solution:**
- Add 5-minute per-user-per-guild cooldown

**Implementation:**
```typescript
// After password validation:
const cooldownKey = `${guildId}:${interaction.user.id}`;
const cooldownResult = checkCooldown("purge", cooldownKey, 5 * 60 * 1000);
if (!cooldownResult.allowed) {
  await interaction.editReply({
    content: `Purge on cooldown. Wait ${formatCooldown(cooldownResult.remainingMs!)}.`,
  });
  return;
}
```

### 2.3 Environment Variable Validation for Shell Commands
**Files:** `src/commands/database.ts`, `src/features/dbRecovery.ts`

**Problem:** PM2_PROCESS_NAME, REMOTE_ALIAS, REMOTE_PATH used in shell commands without validation.

**Solution:**
- Add validation regex before any shell interpolation
- Create shared validation helper

**Implementation:**
```typescript
// src/lib/shellSafety.ts (new file)
export function validateProcessName(name: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid process name format: ${name}`);
  }
}

export function validateRemoteAlias(alias: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
    throw new Error(`Invalid remote alias format: ${alias}`);
  }
}

export function validateRemotePath(path: string): void {
  if (!/^\/[\w\/-]+$/.test(path)) {
    throw new Error(`Invalid remote path format: ${path}`);
  }
}
```

### 2.4 Brute Force Protection for Password Commands
**Files:** `src/commands/resetdata.ts`, `src/commands/purge.ts`, `src/commands/gate/gateMain.ts`

**Problem:** No rate limiting on password attempts.

**Solution:**
- Track failed attempts per user
- Lock out after 5 failures for 1 hour

**Implementation:**
```typescript
// src/lib/passwordAttempts.ts (new file)
const failedAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60 * 60 * 1000; // 1 hour

export function checkPasswordAttempts(userId: string): { allowed: boolean; remainingMs?: number } {
  const record = failedAttempts.get(userId);
  if (!record) return { allowed: true };

  const timeSinceLastAttempt = Date.now() - record.lastAttempt;
  if (timeSinceLastAttempt > LOCKOUT_MS) {
    failedAttempts.delete(userId);
    return { allowed: true };
  }

  if (record.count >= MAX_ATTEMPTS) {
    return { allowed: false, remainingMs: LOCKOUT_MS - timeSinceLastAttempt };
  }

  return { allowed: true };
}

export function recordFailedAttempt(userId: string): void {
  const record = failedAttempts.get(userId) || { count: 0, lastAttempt: 0 };
  record.count++;
  record.lastAttempt = Date.now();
  failedAttempts.set(userId, record);
}

export function clearFailedAttempts(userId: string): void {
  failedAttempts.delete(userId);
}
```

### 2.5 Migrate /audit to Centralized ROLE_IDS
**File:** `src/commands/audit.ts`

**Problem:** Hardcoded role IDs duplicate those in roles.ts.

**Solution:**
- Import ROLE_IDS from roles.ts
- Use requireExactRoles() for permission check

**Implementation:**
```typescript
import { ROLE_IDS, shouldBypass } from "../lib/roles.js";
import { requireExactRoles } from "../lib/config.js";

const ALLOWED_ROLES = [
  ROLE_IDS.COMMUNITY_MANAGER,
  ROLE_IDS.SERVER_DEV,
];

// Replace manual permission check with:
if (!requireExactRoles(interaction, ALLOWED_ROLES, {
  command: `audit ${subcommand}`,
  description: subcommand === "members"
    ? "Scans server for suspicious bot-like accounts."
    : "Scans member avatars for NSFW content.",
  requirements: [{ type: "roles", roleIds: ALLOWED_ROLES }],
})) return;
```

---

## Phase 3: Medium Priority Fixes

### 3.1 Sanitize API Error Responses
**Files:** `src/features/googleVision.ts`, `src/features/aiDetection/*.ts`

**Problem:** API error text may contain credentials.

**Solution:**
- Sanitize error text before logging
- Truncate to reasonable length

**Implementation:**
```typescript
function sanitizeApiError(errorText: string): string {
  return errorText
    .replace(/api[_-]?key[=:]\s*[\w-]+/gi, 'api_key=[REDACTED]')
    .replace(/secret[=:]\s*[\w-]+/gi, 'secret=[REDACTED]')
    .replace(/token[=:]\s*[\w-]+/gi, 'token=[REDACTED]')
    .slice(0, 500);
}
```

### 3.2 SightEngine URL Logging Filter
**File:** `src/lib/logger.ts`

**Problem:** SightEngine API secret in URL query params gets logged.

**Solution:**
- Add pino redaction for URLs containing api_secret

**Implementation:**
```typescript
// In logger configuration:
redact: {
  paths: ['url', 'imageUrl', 'req.url'],
  censor: (value) => {
    if (typeof value === 'string' && value.includes('api_secret=')) {
      return value.replace(/api_secret=[^&]+/, 'api_secret=[REDACTED]');
    }
    return value;
  }
}
```

### 3.3 Increase /flag Cooldown
**File:** `src/commands/flag.ts`

**Problem:** 2-second cooldown too permissive.

**Solution:**
- Increase to 15 seconds

**Implementation:**
```typescript
// Change line 34:
const FLAG_RATE_LIMIT_MS = 15 * 1000; // 15 seconds
```

### 3.4 Add /sync Cooldown
**File:** `src/commands/sync.ts`

**Problem:** No cooldown on expensive command registration.

**Solution:**
- Add 10-minute global cooldown

**Implementation:**
```typescript
import { checkCooldown, formatCooldown } from "../lib/rateLimiter.js";

// In execute():
const cooldownResult = checkCooldown("sync", "global", 10 * 60 * 1000);
if (!cooldownResult.allowed) {
  await interaction.reply({
    content: `Sync on cooldown. Wait ${formatCooldown(cooldownResult.remainingMs!)}.`,
    ephemeral: true,
  });
  return;
}
```

### 3.5 Fix Modmail Map Hard Cap
**File:** `src/features/modmail/routing.ts`

**Problem:** Hard cap not enforced before insertion.

**Solution:**
- Check size before adding, not just after

**Implementation:**
```typescript
export function markForwarded(messageId: string) {
  // Enforce hard cap BEFORE insertion
  if (forwardedMessages.size >= FORWARDED_MAX_SIZE) {
    evictOldestEntries(FORWARDED_EVICTION_SIZE);
  }

  forwardedMessages.set(messageId, Date.now());

  // Regular eviction
  if (forwardedMessages.size > FORWARDED_EVICTION_SIZE) {
    evictOldestEntries(FORWARDED_EVICTION_SIZE / 2);
  }
}
```

---

## Phase 4: Low Priority Fixes

### 4.1 Add LIMIT to Flagged User Queries
**File:** `src/store/flagsStore.ts`

**Problem:** Unbounded query can load thousands of user IDs.

**Solution:**
- Add LIMIT 1000 to getFlaggedUserIds query

---

## Testing Plan

1. **Avatar rate limiting:** Change avatar rapidly, verify only first scan runs
2. **Search throttling:** Search common username, verify delays between API calls
3. **Backfill cooldown:** Run twice in succession, verify second is rejected
4. **Password brute force:** Fail 5 times, verify lockout
5. **Audit permissions:** Test with non-CM user, verify denial message

---

## Rollout Plan

1. Deploy to staging environment
2. Run test suite
3. Manual testing of each fix
4. Deploy to production
5. Monitor logs for issues

