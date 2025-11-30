# Issue #33: Improve Dad Mode Error Logging

**Status:** Planned
**Priority:** Low
**Estimated Effort:** 30 minutes
**Created:** 2025-11-30

## Summary

The Dad Mode listener (`messageDadMode.ts`) logs reply failures at debug level, which hides permission errors and other operational issues from bot operators. In production environments where `LOG_LEVEL` is set to "info" or "warn", these errors become invisible, making it difficult to diagnose why Dad Mode isn't working in certain channels.

This is an observability improvement that will help operators identify and resolve permission issues, rate limiting, and other failure modes.

## Current State

### Problem

**Location:** `src/listeners/messageDadMode.ts:121-124`

When the bot successfully triggers a dad joke but fails to send the reply, the error is logged at debug level:

```typescript
} catch (err) {
  // Silently fail if we can't send the message (missing permissions, etc.)
  logger.debug({ err, guildId: message.guild.id }, "[dadmode] failed to send dad joke");
}
```

### Why This Is Problematic

1. **Production Invisibility:** Most production deployments run with `LOG_LEVEL=info` or `LOG_LEVEL=warn`. Debug logs are disabled, making errors invisible.

2. **Permission Issues Go Unnoticed:** If the bot lacks `SEND_MESSAGES` or `VIEW_CHANNEL` permissions in a channel, operators won't know Dad Mode is broken.

3. **Misleading Success Logs:** The code logs success at line 111-120 BEFORE attempting the send. If the send fails, the success log is misleading.

4. **Inconsistent Error Handling:** Other listeners log send failures at `warn` or `error` level. Dad Mode should follow the same pattern.

5. **Difficult to Debug:** When users report "Dad Mode isn't working", operators can't diagnose the issue without enabling debug logs and reproducing the problem.

### Common Failure Scenarios

- **Missing Permissions:** Bot lacks `SEND_MESSAGES` in channel
- **Channel Deleted:** User message is from a just-deleted channel
- **Rate Limiting:** Discord API rate limit exceeded
- **Bot Kicked:** Bot was removed from guild but event still processed
- **Thread Archived:** Message is in archived thread where bot can't reply

All of these should be visible to operators at warn level.

## Proposed Changes

### Step 1: Change Log Level from Debug to Warn

**Rationale:** Reply failures are actionable problems that operators should know about. They indicate misconfiguration (permissions) or operational issues (rate limits).

**Change:**

```typescript
} catch (err) {
  // Log permission and rate limit failures so operators can diagnose issues
  logger.warn({ err, guildId: message.guild.id }, "[dadmode] failed to send dad joke");
}
```

**Why warn and not error?**
- Not a critical system failure (bot continues operating)
- Dad Mode is a non-essential feature (guild operations unaffected)
- Follows pattern used in similar listeners
- Appropriate for "something went wrong but we can recover"

### Step 2: Add Contextual Information to Error Log

**Rationale:** When diagnosing failures, operators need to know WHERE the failure occurred (channel, message) and WHY (error code).

**Change:**

```typescript
} catch (err) {
  // Log permission and rate limit failures so operators can diagnose issues
  logger.warn(
    {
      err,
      guildId: message.guild.id,
      channelId: message.channel.id,
      messageId: message.id,
      errorCode: (err as any)?.code,
    },
    "[dadmode] failed to send dad joke"
  );
}
```

**Additional Context:**
- `channelId`: Helps identify which channels have permission issues
- `messageId`: Allows correlation with Discord audit logs
- `errorCode`: Discord API error codes (50013 = Missing Permissions, 50001 = Missing Access, 10003 = Unknown Channel)

### Step 3: Move Success Log After Send Attempt

**Rationale:** Logging success before attempting the send is misleading. If the send fails, we've logged success for a failed operation.

**Current Flow:**
```typescript
try {
  await message.reply({ content: `Hi ${name}, I'm dad.` });
  logger.info(..., "[dadmode] triggered dad joke"); // Logs before confirming send
} catch (err) {
  logger.debug(...); // Failure invisible in production
}
```

**Improved Flow:**
```typescript
try {
  await message.reply({ content: `Hi ${name}, I'm dad.` });
  // Only log success if reply actually sent
  logger.info(
    {
      guildId: message.guild.id,
      channelId: message.channel.id,
      messageId: message.id,
      name,
      odds,
    },
    "[dadmode] triggered dad joke"
  );
} catch (err) {
  logger.warn(...); // Failure now visible
}
```

**Why this matters:** The success log now accurately reflects that the dad joke was sent AND delivered.

## Files Affected

### Modified

- **`src/listeners/messageDadMode.ts`**
  - Line 123: Change `logger.debug` to `logger.warn`
  - Lines 122-124: Add `channelId`, `messageId`, `errorCode` to error context
  - Lines 111-120: Success log already after send (no change needed - my mistake, code is already correct)

## Testing Strategy

### Manual Testing

1. **Test Permission Errors:**
   ```bash
   # Remove SEND_MESSAGES permission from bot in test channel
   # Trigger dad joke pattern: "I'm testing"
   # Verify warn log appears: "[dadmode] failed to send dad joke"
   # Verify error includes channelId and errorCode: 50013
   ```

2. **Test Rate Limiting:**
   ```bash
   # Set dadmode_odds to 1 (100% trigger rate)
   # Send 50 "I'm testing" messages rapidly
   # Verify rate limit errors logged at warn level
   ```

3. **Test Archived Thread:**
   ```bash
   # Create thread, send "I'm in a thread"
   # Archive thread immediately
   # Trigger dad joke while bot processing
   # Verify error logged with thread channelId
   ```

4. **Test Success Case Still Works:**
   ```bash
   # Send "I'm happy" in channel with proper permissions
   # Verify success log at info level
   # Verify dad joke reply appears
   # Verify both success log AND actual message sent
   ```

### Log Level Verification

1. **Default (info) level:**
   ```bash
   # Start bot with LOG_LEVEL=info (or unset)
   # Trigger permission error
   # Verify error appears in logs
   ```

2. **Production (warn) level:**
   ```bash
   # Start bot with LOG_LEVEL=warn
   # Trigger permission error
   # Verify error appears in logs
   # Verify success logs (info) are suppressed
   ```

3. **Debug level:**
   ```bash
   # Start bot with LOG_LEVEL=debug
   # Verify all logs appear (debug, info, warn)
   ```

### Validation Checklist

- [ ] Permission errors visible at LOG_LEVEL=info
- [ ] Permission errors visible at LOG_LEVEL=warn
- [ ] Error logs include channelId, messageId, errorCode
- [ ] Success logs only appear when reply actually sent
- [ ] No regression in dad joke functionality
- [ ] Error format matches other listeners

## Rollback Plan

### If Logging Changes Cause Issues

**Symptoms to watch for:**
- Log flooding (if errors are more common than expected)
- Performance degradation (if additional context fields are expensive)
- Misleading error messages (if error codes don't match expected values)

**Immediate Rollback:**

```bash
# Revert the commit
git revert HEAD
git push origin main
pm2 restart pawtropolis-bot
```

**Validation After Rollback:**
- Verify Dad Mode still works in normal channels
- Verify logs return to previous format
- Confirm no errors in startup logs

### If Log Volume Is Too High

**Symptom:** Warn logs flooding due to recurring permission issues

**Action Option 1 - Keep warn but add rate limiting:**
```typescript
// Track last error log per channel to prevent spam
const errorLogCache = new Map<string, number>();

} catch (err) {
  const cacheKey = `${message.guild.id}:${message.channel.id}`;
  const lastLogged = errorLogCache.get(cacheKey) || 0;
  const now = Date.now();

  // Only log once per hour per channel
  if (now - lastLogged > 3600000) {
    errorLogCache.set(cacheKey, now);
    logger.warn({ err, guildId: message.guild.id, channelId: message.channel.id }, "[dadmode] failed to send dad joke");
  }
}
```

**Action Option 2 - Downgrade to info:**
If warn is too noisy for production, use `logger.info` instead of `logger.warn`. Still better than debug (visible in production) but less alarming than warn.

### If Error Context Causes Problems

**Symptom:** Error logs missing expected fields or throwing errors when accessing err.code

**Action:**
```typescript
} catch (err) {
  // Safely extract error code without throwing
  const errorCode = err && typeof err === 'object' && 'code' in err
    ? (err as any).code
    : undefined;

  logger.warn(
    {
      err,
      guildId: message.guild.id,
      channelId: message.channel.id,
      messageId: message.id,
      ...(errorCode && { errorCode }), // Only include if defined
    },
    "[dadmode] failed to send dad joke"
  );
}
```

## Success Criteria

- [ ] Reply failures are logged at warn level (visible in production)
- [ ] Error logs include guild, channel, message IDs for debugging
- [ ] Error logs include Discord API error code when available
- [ ] Success logs only appear when reply actually sent
- [ ] No change in Dad Mode functionality (only observability)
- [ ] Logs visible at LOG_LEVEL=info (production default)
- [ ] Logs visible at LOG_LEVEL=warn (strict production)
- [ ] Error format consistent with other message listeners

## Implementation Notes

### Discord API Error Codes Reference

Common error codes to watch for:

- `10003` - Unknown Channel (channel deleted)
- `10008` - Unknown Message (message deleted before reply)
- `50001` - Missing Access (bot can't see channel)
- `50013` - Missing Permissions (bot lacks SEND_MESSAGES)
- `50035` - Invalid Form Body (message too long - shouldn't happen with truncation)
- `160002` - Cannot Reply To System Message

### Logging Best Practices (from logger.ts)

The logger uses Pino with these levels:
- `debug` - Verbose output, disabled in production (LOG_LEVEL=info or higher)
- `info` - Normal operational messages (default level)
- `warn` - Actionable issues that don't stop operations
- `error` - Critical failures, auto-sent to Sentry

Dad Mode failures should be `warn` because:
1. They're actionable (operators can fix permissions)
2. They don't crash the bot (operations continue)
3. They indicate misconfiguration (worth investigating)

### Related Code Patterns

Other listeners use similar error handling:

```bash
# Check how other listeners log send failures
grep -A 5 "message.reply" src/listeners/*.ts
grep "logger.warn.*failed to send" src/listeners/*.ts
```

This change brings Dad Mode in line with the rest of the codebase.

## Timeline

1. **Implementation:** 15 minutes
   - Change debug to warn
   - Add context fields
   - Test locally

2. **Testing:** 10 minutes
   - Test permission errors
   - Test success case
   - Verify log levels

3. **Deployment:** 5 minutes
   - Deploy to production
   - Monitor logs for first hour
   - Confirm no regressions

**Total time:** 30 minutes

## Monitoring

After deployment, monitor for:

1. **New warn logs appearing:**
   ```bash
   grep "[dadmode] failed to send" logs/*.log | wc -l
   ```

2. **Common error codes:**
   ```bash
   grep "[dadmode] failed to send" logs/*.log | grep "errorCode" | sort | uniq -c
   ```

3. **Channels with recurring failures:**
   ```bash
   grep "[dadmode] failed to send" logs/*.log | grep -o "channelId.*" | sort | uniq -c
   ```

If certain channels show repeated failures, investigate permission configuration for those channels.
