# Error Handling & Logging Audit Plan

**Audit Date:** 2025-12-02
**Priority:** Medium
**Estimated Scope:** ~15 files modified

---

## Executive Summary

The codebase has excellent error handling infrastructure (cmdWrap, error classification, Sentry integration). However, there are specific issues around empty catch blocks, silent background failures, and inconsistent logging that need attention.

---

## Infrastructure Assessment: EXCELLENT

**Strengths (keep as-is):**

1. **Command Wrapper** (`src/lib/cmdWrap.ts`)
   - Auto-defers interactions
   - Error cards with trace IDs
   - Sentry integration with selective reporting

2. **Error Classification** (`src/lib/errors.ts`)
   - Discriminated union for error types
   - `isRecoverable()`, `shouldReportToSentry()` helpers
   - Filters noise (expired interactions, already acknowledged)

3. **Event Wrapper** (`src/lib/eventWrap.ts`)
   - Timeout protection (10s default)
   - Never crashes on event handler failure

4. **Sentry Integration** (`src/lib/sentry.ts`)
   - Token redaction
   - Transient error filtering

5. **Global Handlers** (`src/index.ts:53-72`)
   - `unhandledRejection` - logs and reports
   - `uncaughtException` - logs, reports, exits gracefully

---

## Issues to Fix

### 1. Empty Catch Blocks

**Severity:** HIGH
**Problem:** Errors swallowed without any logging.

**Locations:**

#### `src/commands/audit.ts:479`
```typescript
// CURRENT:
} catch {
  // Ignore errors updating progress
}

// FIX:
} catch (err) {
  logger.debug({ err, guildId: guild.id, totalScanned }, "[audit] Progress update failed (non-fatal)");
}
```

#### `src/commands/audit.ts:522`
```typescript
// CURRENT:
} catch {
  // Ignore - message may have been deleted
}

// FIX:
} catch (err) {
  logger.debug({ err, messageId }, "[audit] Message edit failed (may be deleted)");
}
```

#### `src/commands/audit.ts:543, 735-737, 778-780, 803-805`
```typescript
// CURRENT:
} catch {
  // Channel might not be accessible
}

// FIX:
} catch (err) {
  logger.debug({ err, channelId }, "[audit] Channel send failed (may be inaccessible)");
}
```

#### `src/commands/health.ts:152`
```typescript
// CURRENT:
}).catch(() => {});

// FIX:
}).catch((err) => {
  logger.debug({ err }, "[health] Timeout response failed (interaction may have expired)");
});
```

#### `src/commands/listopen.ts:758`
```typescript
// CURRENT:
}).catch(() => {});

// FIX:
}).catch((err) => {
  logger.debug({ err }, "[listopen] Pagination response failed");
});
```

**Files to modify:**
- `src/commands/audit.ts` (6 locations)
- `src/commands/health.ts` (1 location)
- `src/commands/listopen.ts` (1 location)

---

### 2. Background Audit Failure Notification

**Severity:** HIGH
**Problem:** Background audit crashes don't notify users.

**Location:** `src/commands/audit.ts:360-366`

**Current:**
```typescript
runNsfwAudit(...).catch((err) => {
  logger.error({ err, guildId: guild.id, scope }, "[audit:nsfw] Background audit failed");
});
```

**Fix:**
```typescript
runNsfwAudit(...).catch(async (err) => {
  logger.error({ err, guildId: guild.id, scope }, "[audit:nsfw] Background audit failed");

  // Notify user of catastrophic failure
  try {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Audit Failed")
          .setDescription("The audit encountered a critical error and could not complete. Check logs for details.")
          .setColor(0xE74C3C)
          .setTimestamp()
      ]
    });
  } catch (notifyErr) {
    logger.debug({ err: notifyErr }, "[audit] Failed to notify user of audit failure");
  }
});
```

**Apply same pattern to:**
- `runMembersAudit()` (line 364)

**Files to modify:**
- `src/commands/audit.ts`

---

### 3. Vision API Silent Failures

**Severity:** MEDIUM
**Problem:** Vision API failures return null without caller awareness.

**Location:** `src/features/googleVision.ts:195-198`

**Current:**
```typescript
} catch (err) {
  logger.warn({ err, imageUrl }, "[googleVision] Detection failed");
  return null;  // Caller doesn't know scan failed
}
```

**Fix - Add error classification:**
```typescript
import { classifyError, shouldReportToSentry, errorContext } from "../lib/errors.js";
import { captureException } from "../lib/sentry.js";

} catch (err) {
  const classified = classifyError(err);

  logger.warn({
    err,
    imageUrl: imageUrl.substring(0, 100), // Truncate for logs
    errorKind: classified.kind,
    ...errorContext(classified)
  }, "[googleVision] Detection failed");

  // Only report to Sentry if not a transient network error
  if (shouldReportToSentry(classified)) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      feature: "googleVision",
    });
  }

  return null;
}
```

**Also add logging at call sites when null is returned:**
```typescript
// In audit.ts or wherever detectNsfwVision is called:
const result = await detectNsfwVision(avatarUrl);
if (result === null) {
  logger.debug({ userId, avatarUrl: avatarUrl.substring(0, 50) }, "[audit] Vision scan returned null - skipping member");
  // Optionally track failed scans for later retry
}
```

**Files to modify:**
- `src/features/googleVision.ts`
- `src/commands/audit.ts` (call site logging)
- `src/features/avatarNsfwMonitor.ts` (call site logging)

---

### 4. Avatar Monitor Fallback Notification

**Severity:** MEDIUM
**Problem:** Alert sending failures have no fallback.

**Location:** `src/features/avatarNsfwMonitor.ts:151-153`

**Current:**
```typescript
} catch (err) {
  logger.error({ err, guildId, userId }, "[avatarNsfwMonitor] Failed to send alert");
}
```

**Fix:**
```typescript
} catch (err) {
  logger.error({ err, guildId, userId }, "[avatarNsfwMonitor] Failed to send alert");

  // Fallback: Try to DM guild owner about misconfiguration
  try {
    const owner = await newMember.guild.fetchOwner();
    await owner.send({
      content: `Warning: NSFW avatar detected in **${newMember.guild.name}** but failed to send alert to logging channel. Please check channel permissions and configuration.\n\nUser: <@${userId}>`,
    });
    logger.info({ guildId, ownerId: owner.id }, "[avatarNsfwMonitor] Sent fallback DM to owner");
  } catch (fallbackErr) {
    logger.debug({ err: fallbackErr, guildId }, "[avatarNsfwMonitor] Fallback DM to owner also failed");
    // At this point, just log - we've tried our best
  }
}
```

**Files to modify:**
- `src/features/avatarNsfwMonitor.ts`

---

### 5. Avatar Scan Queue Status Tracking

**Severity:** MEDIUM
**Problem:** Avatar scan errors in gate flow are logged but not visible to moderators.

**Location:** `src/features/gate.ts:459-550`

**Current:**
```typescript
setImmediate(() => {
  try {
    (async () => {
      // Avatar scan logic
    })().catch((err) => {
      logger.error({ ...baseLog, phase: "crash", err }, "[avatarScan] job crashed");
    });
  } catch (err) {
    logger.error({ ...baseLog, phase: "sync_error", err }, "[avatarScan] synchronous error");
  }
});
```

**Fix - Add scan status to review card:**
1. Add `scan_status` column to `avatar_scan` table:
   ```sql
   ALTER TABLE avatar_scan ADD COLUMN scan_status TEXT DEFAULT 'pending'
     CHECK (scan_status IN ('pending', 'complete', 'failed', 'skipped'));
   ```

2. Update scan status on completion/failure:
   ```typescript
   // On success:
   db.prepare(`UPDATE avatar_scan SET scan_status = 'complete' WHERE application_id = ?`)
     .run(applicationId);

   // On failure:
   db.prepare(`UPDATE avatar_scan SET scan_status = 'failed' WHERE application_id = ?`)
     .run(applicationId);
   ```

3. Show scan status in review card UI

**Files to modify:**
- Create migration for `scan_status` column
- `src/features/gate.ts` (update status on complete/fail)
- `src/ui/reviewCard.ts` (display scan status)

---

### 6. Modmail Routing Error Notification

**Severity:** MEDIUM
**Problem:** Modmail routing failures don't notify the user.

**Location:** `src/index.ts:1609-1612`

**Current:**
```typescript
} catch (err) {
  logger.error({ err, traceId, messageId: message.id }, "[modmail] message routing failed");
  captureException(err, { area: "modmail:messageCreate", traceId });
}
```

**Fix:**
```typescript
} catch (err) {
  logger.error({ err, traceId, messageId: message.id }, "[modmail] message routing failed");
  captureException(err, { area: "modmail:messageCreate", traceId });

  // Notify user their message wasn't delivered
  try {
    await message.reply({
      content: "Sorry, there was an issue delivering your message. Please try again or contact staff through another channel.",
    });
  } catch (replyErr) {
    logger.debug({ err: replyErr }, "[modmail] Failed to notify user of routing failure");
  }
}
```

**Files to modify:**
- `src/index.ts`

---

### 7. Store Function Error Handling Consistency

**Severity:** LOW
**Problem:** Inconsistent error handling - some return false, others throw.

**Current patterns:**
```typescript
// Pattern A: Returns false (nsfwFlagsStore.ts)
export function isNsfwFlagged(...): boolean {
  try {
    return row !== undefined;
  } catch (err) {
    logger.error({ err }, "...");
    return false;  // Silent failure
  }
}

// Pattern B: Re-throws (flagsStore.ts)
export function getExistingFlag(...): FlagRow | null {
  try {
    return row || null;
  } catch (err) {
    logger.error({ err }, "...");
    throw err;  // Propagates
  }
}
```

**Standardize:**
- **Reads (SELECT):** Return null on error (don't crash on read failure)
- **Writes (INSERT/UPDATE/DELETE):** Re-throw (caller needs to know write failed)

**Files to audit:**
- `src/store/flagsStore.ts`
- `src/store/nsfwFlagsStore.ts`
- `src/store/auditSessionStore.ts`
- All other store files

---

### 8. Direct Interaction Calls Outside Wrapper

**Severity:** LOW
**Problem:** Some files use raw `interaction.reply()` instead of `replyOrEdit()`.

**Example:** `src/commands/roles.ts`

**Risk:** Potential for 40060 (already acknowledged) errors.

**Fix:** Replace with `replyOrEdit()` from cmdWrap:
```typescript
// FROM:
await interaction.reply({ content: "...", ephemeral: true });

// TO:
await replyOrEdit(interaction, { content: "...", ephemeral: true });
```

**Files to audit:**
- Search for `interaction.reply(` and `interaction.editReply(`
- Replace with `replyOrEdit()` where inside command handlers

---

### 9. Missing ensureDeferred for Long Operations

**Severity:** LOW
**Problem:** Some commands may take >3s without deferring.

**Audit commands for:**
1. Multiple database queries
2. Discord API calls
3. External API calls (Vision, etc.)
4. Image generation

**Ensure each has `await interaction.deferReply()` at start.**

**Files to audit:**
- All command files
- Focus on: database.ts, audit.ts, modstats/*.ts

---

### 10. Overly Broad Catch Blocks

**Severity:** LOW
**Problem:** Some catch blocks don't distinguish error types.

**Location:** `src/features/gate.ts:474-476`

**Current:**
```typescript
} catch (err) {
  logger.warn({ ...baseLog, phase: "scan_failed", err }, "[avatarScan] scan threw");
}
```

**Fix - Use error classification:**
```typescript
} catch (err) {
  const classified = classifyError(err);

  if (classified.kind === 'network') {
    logger.warn({ ...baseLog, phase: "scan_failed", errorKind: 'network' },
      "[avatarScan] Network error during scan");
  } else if (classified.kind === 'discord_api') {
    logger.warn({ ...baseLog, phase: "scan_failed", errorKind: 'discord_api', code: classified.code },
      "[avatarScan] Discord API error during scan");
  } else {
    // Unexpected error - log at error level
    logger.error({ ...baseLog, phase: "scan_failed", err },
      "[avatarScan] Unexpected error during scan");

    if (shouldReportToSentry(classified)) {
      captureException(err);
    }
  }
}
```

**Files to audit:**
- `src/features/gate.ts`
- Other files with broad catch blocks

---

## Logging Improvements

### 11. Add Success Logging to Vision API

**Location:** `src/features/googleVision.ts`

**Add:**
```typescript
logger.debug({
  imageUrl: imageUrl.substring(0, 50),
  adult: result.adult,
  violence: result.violence,
  durationMs: performance.now() - start
}, "[googleVision] Detection completed");
```

---

### 12. Add Debug Logging to Stores

**Pattern to add in store functions:**
```typescript
export function getFlag(guildId: string, userId: string): FlagRow | null {
  const row = getFlagStmt.get(guildId, userId) as FlagRow | undefined;
  logger.debug({ guildId, userId, found: !!row }, "[flagsStore] getFlag");
  return row ?? null;
}
```

**Note:** Only for DEBUG level - won't appear in production unless debug enabled.

---

### 13. Add Performance Logging

**For operations > 1 second:**
```typescript
const start = performance.now();
// ... operation
const duration = performance.now() - start;

if (duration > 1000) {
  logger.warn({ durationMs: duration, operation: 'name' }, "[perf] Slow operation detected");
}
```

**Add to:**
- Vision API calls
- Database queries (in store files)
- Discord API bulk operations

---

## Standardize Error Messages

### 14. User-Facing Error Message Consistency

**Current inconsistencies:**
- "Guild only." vs "This command can only be used in a server."
- "Already acknowledged; avoid double reply." vs friendlier message

**Create standard messages:**
```typescript
// src/lib/userMessages.ts
export const USER_ERRORS = {
  GUILD_ONLY: "This command can only be used in a server.",
  DM_ONLY: "This command can only be used in DMs.",
  MISSING_PERMISSIONS: "You don't have permission to use this command.",
  ALREADY_HANDLED: "This interaction was already handled.",
  EXPIRED: "This interaction has expired. Please try again.",
  INTERNAL_ERROR: "Something went wrong. Please try again later.",
} as const;
```

**Files to create:**
- `src/lib/userMessages.ts`

**Files to modify:**
- All command files using hardcoded error strings

---

## Verification Steps

After each fix:

1. **Test the specific scenario:**
   - Trigger the error condition
   - Verify logging appears
   - Check Sentry (if applicable)

2. **Run tests:**
   ```bash
   npm run test
   ```

3. **Check log output:**
   ```bash
   npm run dev
   # Trigger scenarios, check console
   ```

---

## Estimated Impact

- **Files modified:** ~15
- **Lines changed:** ~300
- **New files:** 1 (`src/lib/userMessages.ts`)
- **Risk level:** Low (mostly adding logging, no logic changes)

---

## Summary of Changes

| Priority | Issue | Action |
|----------|-------|--------|
| HIGH | Empty catch blocks | Add debug logging |
| HIGH | Background audit failures | Notify user on crash |
| MEDIUM | Vision API silent failures | Add error classification |
| MEDIUM | Avatar monitor fallback | DM owner on failure |
| MEDIUM | Scan status tracking | Add status column + UI |
| MEDIUM | Modmail routing failures | Notify user |
| LOW | Store error consistency | Standardize patterns |
| LOW | Direct interaction calls | Use replyOrEdit() |
| LOW | Missing defers | Audit and add |
| LOW | Broad catch blocks | Use error classification |
