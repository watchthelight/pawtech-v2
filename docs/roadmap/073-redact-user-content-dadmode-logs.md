# Issue #73: Redact User Content in Dadmode Logs

**Status:** Completed
**Priority:** Critical
**Type:** Security / Privacy
**Estimated Effort:** 15 minutes

---

## Summary

Full user message content is logged at INFO level without redaction in `src/listeners/messageDadMode.ts`, potentially exposing sensitive data like tokens, passwords, or PII.

## Current State

```typescript
// Line 75
logger.info({ guildId: message.guild.id, content }, "[dadmode] dice roll HIT! Checking pattern...");

// Line 80
logger.info({ guildId: message.guild.id, content }, "[dadmode] pattern did not match");
```

## Impact

- Could log tokens, passwords, API keys, personal information
- INFO level means this appears in production logs
- User messages may contain sensitive data
- Potential GDPR/privacy compliance issues

## Proposed Changes

1. Change to DEBUG level (not needed in production)
2. Truncate and redact content:

```typescript
// Line 75
logger.debug({
  guildId: message.guild.id,
  contentLength: content.length,
  contentPreview: content.slice(0, 30).replace(/\S{20,}/g, '[REDACTED]')
}, "[dadmode] dice roll HIT! Checking pattern...");

// Line 80
logger.debug({
  guildId: message.guild.id,
  contentLength: content.length
}, "[dadmode] pattern did not match");
```

3. Also fix line 64 which logs every message check at INFO:

```typescript
// Change from INFO to DEBUG
logger.debug({ guildId: message.guild.id, contentLength: content.length, odds: cfg.dadmode_odds }, "[dadmode] checking message");
```

## Files Affected

- `src/listeners/messageDadMode.ts:64,75,80`

## Testing Strategy

1. Test dadmode still works
2. Verify logs don't contain full message content
3. Verify DEBUG level in production doesn't clutter logs
