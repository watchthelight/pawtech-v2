# Command Audit: /purge

> File: `src/commands/purge.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Admin command to bulk delete messages in a channel.
**WHY:** Allows quick cleanup of channels with password protection.
**FLOWS:**
- Validate password → check cooldowns → fetch messages → bulk delete (recent) → individual delete (old) → report results

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` → `commands` array |
| Execute | `execute()` at line 70 |
| Button/Modal handlers | None |

## DB Touches

**None** - No database operations (rate limiting is in-memory).

## External Services

| Service | Usage |
|---------|-------|
| Discord API | `messages.fetch()` - fetches messages to delete |
| Discord API | `bulkDelete()` - fast delete for recent messages |
| Discord API | `message.delete()` - individual delete for old messages |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | Line 60 | `ManageMessages` required |
| Password | Line 98-117 | `RESET_PASSWORD` env var |
| Bot perms | Line 144-154 | Checks `ManageMessages` + `ReadMessageHistory` |

**Gap:** No role check beyond Discord permissions - password is the gate.

## Timing Model

| Phase | Method | Notes |
|-------|--------|-------|
| Defer | `deferReply()` ephemeral | Correct for long operation |
| Bulk delete | Loop with batches | Handles 14-day Discord limit |
| Reply | `editReply()` | Final report |

**Rate Limit Handling:**
- `MESSAGE_DELETE_BATCH_DELAY_MS` between individual delete batches
- `BULK_DELETE_ITERATION_DELAY_MS` between fetch cycles
- 5-minute cooldown per user-guild

## Logging Model

| Event | Level | Structured Fields |
|-------|-------|-------------------|
| Password not configured | ERROR | None (just message) |
| Incorrect password | WARN | `{ userId, guildId }` |
| Starting delete | INFO | `{ userId, guildId, channelId, targetCount }` |
| Delete complete | INFO | `{ userId, guildId, channelId, totalDeleted, oldMessagesDeleted }` |
| Failed to delete old msg | WARN | `{ err, messageId }` |
| Error during delete | ERROR | `{ err, channelId, totalDeleted }` |

**Gaps:**
- Password not configured logs without structured fields
- Missing `evt` field for event type classification

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete WHAT/WHY/FLOWS/DOCS |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ❌ | **Missing** - no phase tracking |
| `withSql()` for DB | N/A | No DB operations |
| Switch-based routing | N/A | No subcommands |
| Error handling | ✅ | Try/catch with partial progress reporting |
| Permission helper | ⚠️ | Uses Discord perms + password, not role hierarchy |

**Deviations:**
1. **No `withStep()` usage** - phases not tracked
2. Password-based instead of role-based (acceptable for destructive command)
3. Excellent handling of Discord's 14-day bulk delete limit

## Security Considerations

**GOOD:**
- `secureCompare()` for password (timing-safe)
- Brute force cooldown (`PASSWORD_FAIL_MS`)
- Regular cooldown to prevent abuse

**POTENTIAL ISSUES:**
- Password in env var (no rotation mechanism)
- No audit log to Discord channel for accountability

## Comparison: /purge vs /resetdata

| Aspect | /purge | /resetdata |
|--------|--------|------------|
| Protection | Password + Discord perms | Unknown |
| Cooldown | 5 min + brute force | Unknown |
| withStep | ❌ Missing | Unknown |
| Audit log | ❌ None | Unknown |

## Bugs / Dead Code

- **MAX_ITERATIONS = 100** - safety valve good, but could log when hit
- **Line 229-231**: `if (recentMessages.size === 0 && oldMessages.size === 0)` is redundant - break already happens if `messages.size === 0` above

## Tests

**Status:** No tests
**Critical paths needing coverage:**
1. Password validation (correct/incorrect/missing)
2. Brute force cooldown enforcement
3. Bulk delete vs individual delete separation
4. Partial success reporting on error

**Proposed test:**
```typescript
describe('/purge', () => {
  it('rejects incorrect password', async () => {
    const ctx = mockContext();
    process.env.RESET_PASSWORD = 'correct';
    ctx.interaction.options.getString = () => 'wrong';
    await execute(ctx);
    expect(ctx.interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Incorrect password.' })
    );
  });
});
```

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P1 | Missing withStep instrumentation | M |
| P1 | No Discord audit log for accountability | M |
| P2 | Password not configured log lacks structure | S |
| P2 | Redundant break condition | S |

**Recommended commits:**
1. `refactor(purge): add withStep instrumentation for tracing`
2. `feat(purge): add Discord audit log for accountability`
3. `fix(purge): add structured fields to password-not-configured log`
4. `refactor(purge): remove redundant break condition`
