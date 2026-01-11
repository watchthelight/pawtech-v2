# Command Audit: /send

> File: `src/commands/send.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Anonymous command for staff to post messages as the bot.
**WHY:** Allows moderation team to communicate anonymously without revealing identity.
**FLOWS:**
- Parse options → neutralize mass pings → validate length → send message → audit log

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` → `commands` array |
| Execute | `execute()` at line 219 |
| Button/Modal handlers | None |

## DB Touches

**None** - No database operations.

## External Services

| Service | Usage |
|---------|-------|
| Discord API | `channel.send()` - sends the anonymous message |
| Discord API | `messages.fetch()` - fetches reply target if specified |
| Audit channel | Custom audit embed sent to `LOGGING_CHANNEL` / `LOGGING_CHANNEL_ID` |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | Line 47 | `ManageMessages` permission required |
| Role check | Line 76-109 | `SEND_ALLOWED_ROLE_IDS` env var (optional) |
| Owner bypass | Line 78 | `isOwner()` |

**Gap:** None - appropriate multi-layer protection.

## Timing Model

| Phase | Method | Notes |
|-------|--------|-------|
| Defer | `deferReply()` ephemeral | Correct for potentially slow fetch |
| Send | `channel.send()` | Main operation |
| Reply | `editReply()` | Confirmation |
| Audit | Fire-and-forget `.catch()` | Non-blocking |

**Races:** `failIfNotExists: false` handles deleted reply targets gracefully.

## Logging Model

| Event | Level | Structured Fields |
|-------|-------|-------------------|
| Logging channel not accessible | WARN | `{ loggingChannelId, guildId }` |
| Logging channel wrong type | WARN | `{ loggingChannelId, channelType, guildId }` |
| Failed to fetch reply_to | WARN | `{ err, replyToId, channelId }` |
| Audit log failed | WARN | `{ err, guildId, userId, action }` |
| Failed to send | ERROR | `{ err, channelId, userId, guildId }` |

**Gaps:**
- No success log for successful send (acceptable for high-volume command)
- `action` field is plain "send" instead of `evt: "send_completed"`

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete WHAT/WHY/FLOWS/DOCS |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ❌ | **Missing** - no phase tracking |
| `withSql()` for DB | N/A | No DB operations |
| Switch-based routing | N/A | No subcommands |
| Error handling | ✅ | Per-operation try/catch |
| Permission helper | ⚠️ | Custom `checkRoleAccess()` instead of shared |

**Deviations:**
1. **No `withStep()` usage** - phases not tracked
2. Custom permission logic instead of `requireMinRole()`
3. Excellent code comments explaining edge cases

## Comparison: /send vs /poke

| Aspect | /send | /poke |
|--------|-------|-------|
| Permission | ManageMessages + optional role | Owner-only |
| withStep | ❌ Missing | ✅ Present |
| Defer | ✅ Ephemeral | ✅ Ephemeral |
| Audit log | ✅ Custom embed | N/A |

## Security Considerations

**GOOD:**
- Mass pings neutralized with zero-width space (defense in depth)
- `allowedMentions` API protection
- Audit log reveals invoker for accountability
- Constant-time comparison for role checks

**POTENTIAL ISSUE:**
- `SEND_ALLOWED_ROLE_IDS` env var is comma-separated - parsing could be cleaner

## Bugs / Dead Code

- **None identified**
- Well-documented, production-ready code
- `AUDIT_LOG_PREVIEW_LENGTH` could be a constant in lib/constants.js

## Tests

**Status:** No tests
**Critical paths needing coverage:**
1. Role access rejection
2. Mass ping neutralization
3. Message length validation
4. Reply threading
5. Audit log generation

**Proposed test:**
```typescript
describe('/send', () => {
  it('neutralizes @everyone and @here', () => {
    const result = neutralizeMassPings('@everyone test @here');
    expect(result).not.toContain('@everyone');
    expect(result).not.toContain('@here');
  });
});
```

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P1 | Missing withStep instrumentation | M |
| P2 | No success logging | S |

**Recommended commits:**
1. `refactor(send): add withStep instrumentation for tracing`
2. `chore(send): move AUDIT_LOG_PREVIEW_LENGTH to constants`
