# Command Audit: /flag

> File: `src/commands/flag.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Manual flagging for suspicious users.
**WHY:** Complements auto-flagger by letting mods flag based on gut instinct or behavior patterns.
**FLOWS:**
- Permission check → rate limit → duplicate check → create flag → send alert to channel

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` → `commands` array |
| Execute | `execute()` at line 85 |
| Button/Modal handlers | None |

## DB Touches

| Operation | Table | Function | Location |
|-----------|-------|----------|----------|
| Read | `flagged_users` | `isAlreadyFlagged()` | Line 140 |
| Read | `flagged_users` | `getExistingFlag()` | Line 144 |
| Write | `flagged_users` | `upsertManualFlag()` | Line 185 |

## External Services

| Service | Usage |
|---------|-------|
| Discord API | `guild.members.fetch()` - gets join timestamp |
| Discord API | `channel.send()` - sends alert embed |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | Discoverable to all |
| Role check | Line 97 | `requireMinRole(ROLE_IDS.JUNIOR_MOD)` |
| Guild check | Line 88 | Guild-only enforcement |

**Gap:** None - Junior Mod+ is appropriate for flagging.

## Timing Model

| Phase | Method | Notes |
|-------|--------|-------|
| Defer | `deferReply()` ephemeral | Correct for DB + API operations |
| Reply | `editReply()` | Confirmation |
| Alert | Fire-and-forget try/catch | Non-blocking |

**15-second rate limit** per moderator per guild.

## Logging Model

| Event | Level | Structured Fields |
|-------|-------|-------------------|
| User manually flagged | INFO | `{ guildId, userId, moderatorId, reason }` |
| Could not fetch member | DEBUG | `{ err, userId }` |
| Missing permissions | WARN | `{ channelId, guildId }` |
| Failed to send alert | WARN | `{ err, channelId }` |
| Failed to flag user | ERROR | `{ err, guildId, userId }` |
| Cooldown cleanup | DEBUG | `{ cleaned, remaining }` |

**Gaps:**
- Missing `evt` field for event classification

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ⚠️ | Missing WHAT/WHY/FLOWS format |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ✅ | All phases wrapped |
| `withSql()` for DB | ✅ | DB calls wrapped |
| Switch-based routing | N/A | No subcommands |
| Error handling | ✅ | Try/catch with user feedback |
| Permission helper | ✅ | Uses `requireMinRole()` |

**Deviations:**
1. File header missing standard format
2. In-memory rate limiter instead of shared utility (acceptable)
3. Excellent idempotency handling

## Comparison: /flag vs /unblock

| Aspect | /flag | /unblock |
|--------|-------|----------|
| Permission | Junior Mod | Unknown |
| withStep | ✅ All phases | ✅ All phases |
| withSql | ✅ Wrapped | ✅ Wrapped |
| Rate limit | 15s custom | Unknown |

## Security Considerations

**GOOD:**
- Idempotent - reflagging is a no-op
- Rate limiting prevents spam
- Cleanup interval prevents memory leaks
- `cleanupFlagCooldowns()` exported for graceful shutdown

**POTENTIAL ISSUES:**
- `FLAGGED_REPORT_CHANNEL_ID` env var - no validation

## Bugs / Dead Code

- **Line 39**: `flagCooldownInterval` typed as `NodeJS.Timeout | null` but immediately assigned
- **Line 67-73**: `cleanupFlagCooldowns()` exported but not called anywhere (should be in shutdown handler)

## Tests

**Status:** No tests
**Critical paths needing coverage:**
1. Permission rejection
2. Rate limit enforcement
3. Duplicate flag detection
4. Successful flag creation
5. Alert embed generation

**Proposed test:**
```typescript
describe('/flag', () => {
  it('prevents duplicate flags', async () => {
    const ctx = mockContext();
    mockIsAlreadyFlagged.mockReturnValue(true);
    await execute(ctx);
    expect(ctx.interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Already flagged') })
    );
  });
});
```

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | File header missing standard format | S |
| P2 | cleanupFlagCooldowns not called on shutdown | S |
| P2 | Missing evt field in logs | S |

**Recommended commits:**
1. `docs(flag): add standard WHAT/WHY/FLOWS header`
2. `fix(flag): call cleanupFlagCooldowns on shutdown`
3. `refactor(flag): add evt field to log events`
