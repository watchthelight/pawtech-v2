# Security Fixes Implementation Plan - Round 2

**Date:** 2025-12-14
**Status:** COMPLETED
**Priority:** Critical security hardening (second audit round)

---

## Overview

This plan addresses security issues identified in the second round of security audits.

---

## Phase 1: Rate Limiting Gaps

### 1.1 Add /search Command Cooldown
**File:** `src/commands/search.ts`

**Problem:** The /search command has API call throttling (50ms delays) but no per-user cooldown on the command itself. Users can repeatedly invoke the command to trigger many Discord API calls.

**Solution:**
- Add 30-second per-user cooldown
- Use existing `checkCooldown()` from rateLimiter

**Implementation:**
```typescript
import { checkCooldown, formatCooldown, COOLDOWNS } from "../lib/rateLimiter.js";

// Add to COOLDOWNS in rateLimiter.ts:
SEARCH_MS: 30 * 1000, // 30 seconds per user

// In execute(), after permission check:
const cooldownResult = checkCooldown("search", interaction.user.id, COOLDOWNS.SEARCH_MS);
if (!cooldownResult.allowed) {
  await interaction.reply({
    content: `This command is on cooldown. Try again in ${formatCooldown(cooldownResult.remainingMs!)}.`,
    ephemeral: true,
  });
  return;
}
```

### 1.2 Add /artistqueue sync Cooldown
**File:** `src/commands/artistqueue.ts`

**Problem:** The sync subcommand fetches ALL guild members (`guild.members.fetch()`) with no cooldown. This is expensive and can be abused.

**Solution:**
- Add 5-minute per-guild cooldown for sync
- Use existing rate limiter

**Implementation:**
```typescript
import { checkCooldown, formatCooldown, COOLDOWNS } from "../lib/rateLimiter.js";

// Add to COOLDOWNS in rateLimiter.ts:
ARTISTQUEUE_SYNC_MS: 5 * 60 * 1000, // 5 minutes per guild

// In handleSync(), before deferReply:
const cooldownResult = checkCooldown("artistqueue:sync", guild.id, COOLDOWNS.ARTISTQUEUE_SYNC_MS);
if (!cooldownResult.allowed) {
  await interaction.reply({
    content: `Queue sync is on cooldown. Try again in ${formatCooldown(cooldownResult.remainingMs!)}.`,
    ephemeral: true,
  });
  return;
}
```

---

## Phase 2: Shell Command Safety

### 2.1 Validate PM2 Process Name
**File:** `src/features/dbRecovery.ts`

**Problem:** Lines 470 and 571 interpolate `env.PM2_PROCESS_NAME` directly into shell commands:
```typescript
await execAsync(`pm2 stop ${env.PM2_PROCESS_NAME}`);
await execAsync(`pm2 start ${env.PM2_PROCESS_NAME}`);
```

If PM2_PROCESS_NAME contains shell metacharacters, this could lead to command injection.

**Solution:**
- Validate PM2_PROCESS_NAME format before use
- Only allow alphanumeric, underscore, and hyphen characters

**Implementation:**
```typescript
// Add validation helper
function validateProcessName(name: string | undefined): string {
  if (!name) {
    throw new Error("PM2_PROCESS_NAME not configured");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error("Invalid PM2_PROCESS_NAME format - only alphanumeric, underscore, and hyphen allowed");
  }
  return name;
}

// Before shell calls:
const processName = validateProcessName(env.PM2_PROCESS_NAME);
await execAsync(`pm2 stop ${processName}`);
```

### 2.2 Validate Remote SSH Parameters
**File:** `src/commands/database.ts`

**Problem:** Lines 239 and 255 interpolate `remoteAlias` and `remotePath` into SSH commands:
```typescript
const remoteCmd = `ssh ... ${remoteAlias} "bash -c 'cd ${remotePath} && ...'"`;
```

**Solution:**
- Validate remoteAlias format (alphanumeric, underscore, hyphen only)
- Validate remotePath format (absolute path with limited characters)

**Implementation:**
```typescript
// Add validation helpers
function validateRemoteAlias(alias: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
    throw new Error("Invalid remote alias format");
  }
  return alias;
}

function validateRemotePath(path: string): string {
  if (!/^\/[\w\/-]+$/.test(path)) {
    throw new Error("Invalid remote path format");
  }
  return path;
}
```

---

## Phase 3: Error Message Sanitization

### 3.1 Make OAuth Error Messages Generic
**File:** `src/web/linkedRoles.ts`

**Problem:** Line 475 displays raw error messages to users:
```typescript
<p>${escapeHtml(err instanceof Error ? err.message : "Unknown error")}</p>
```

API error messages could contain sensitive information (API keys, internal URLs, etc.).

**Solution:**
- Display generic error message to user
- Log detailed error server-side only

**Implementation:**
```typescript
} catch (err) {
  logger.error({ err }, "[linkedRoles] Callback error");
  // Generic message - don't expose internal error details to users
  sendHtml(res, 500, `
    <html>
      <head><title>Error</title></head>
      <body style="font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #c00;">Authorization Failed</h1>
        <p>Something went wrong during authorization. Please try again.</p>
        <p>If this problem persists, please contact the server administrator.</p>
        <p><a href="/linked-roles">Try again</a></p>
      </body>
    </html>
  `);
}
```

---

## Testing Plan

1. **/search cooldown:** Run /search twice quickly, verify second is rate limited
2. **/artistqueue sync cooldown:** Run sync twice, verify second is blocked
3. **PM2 validation:** Set invalid PM2_PROCESS_NAME, verify error thrown
4. **SSH validation:** Set invalid REMOTE_ALIAS, verify error thrown
5. **OAuth errors:** Trigger OAuth error, verify generic message shown

---

## Rollout Plan

1. Implement all fixes
2. Update CHANGELOG.md
3. Run build to verify no TypeScript errors
4. Deploy to production
