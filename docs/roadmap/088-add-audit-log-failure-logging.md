# Issue #88: Add Logging for Audit Trail Failures

**Status:** Completed
**Priority:** High
**Type:** Observability / Compliance
**Estimated Effort:** 30 minutes

---

## Summary

Audit log operations use fire-and-forget patterns with empty `.catch(() => {})`, making audit trail gaps completely silent.

## Current State

```typescript
// src/commands/send.ts:286
sendAuditLog(interaction, sanitizedMessage, useEmbed, silent).catch(() => {});
//                                                              ^^^^^^^^^^^^^^^^
// Empty catch - audit trail gaps are completely silent

// src/features/levelRewards.ts - multiple locations
await logActionPretty(guild, { ... }).catch((err) => {
  logger.warn({ err, guildId: guild.id, userId: member.id },
    "[levelRewards] Failed to log action - audit trail incomplete");
});
// At least this one logs, but others don't
```

## Impact

- Audit trail is critical for compliance and investigation
- Silent failures mean missing audit entries with no alert
- Cannot detect patterns of logging failures
- Compliance risk if audit trail has gaps

## Proposed Changes

1. Add logging to all audit failures:

```typescript
// src/commands/send.ts:286
sendAuditLog(interaction, sanitizedMessage, useEmbed, silent).catch((err) => {
  logger.warn({
    err,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    action: 'send',
  }, "[send] Audit log failed - audit trail incomplete");
});
```

2. Create audit log wrapper for consistency:

```typescript
// src/lib/auditHelper.ts
export async function safeAuditLog(
  action: string,
  context: { guildId?: string; userId?: string },
  logFn: () => Promise<void>
): Promise<boolean> {
  try {
    await logFn();
    return true;
  } catch (err) {
    logger.warn({
      err,
      action,
      ...context,
    }, "[audit] Failed to write audit log");
    return false;
  }
}
```

3. Apply to all audit logging locations:
- `src/commands/send.ts`
- `src/features/levelRewards.ts`
- `src/features/review/handlers.ts`
- Any other audit log calls

4. Consider adding retry logic for transient failures:

```typescript
export async function safeAuditLogWithRetry(
  action: string,
  context: { guildId?: string; userId?: string },
  logFn: () => Promise<void>,
  maxRetries = 2
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await logFn();
      return true;
    } catch (err) {
      if (attempt === maxRetries) {
        logger.warn({
          err,
          action,
          attempts: attempt,
          ...context,
        }, "[audit] Failed to write audit log after retries");
        return false;
      }
      await new Promise(r => setTimeout(r, 100 * attempt)); // Backoff
    }
  }
  return false;
}
```

## Files Affected

- `src/lib/auditHelper.ts` (new)
- `src/commands/send.ts`
- `src/features/levelRewards.ts`
- `src/features/review/handlers.ts`
- Other files with audit logging

## Testing Strategy

1. Mock audit log to fail
2. Verify warning is logged
3. Test retry logic
4. Monitor for audit failure patterns
