# Command Audit: /backfill

> File: `src/commands/backfill.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Backfill message activity data for heatmap.
**WHY:** Allows staff to populate historical data and get notified when complete.
**FLOWS:**
- Validate permissions → spawn background script → monitor output → notify on completion

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` → `commands` array |
| Execute | `execute()` at line 60 |
| Button/Modal handlers | None |

## DB Touches

**Indirect only:**
- `getConfig()` reads `backfill_notification_channel_id`
- Child process writes to `message_activity` table

## External Services

| Service | Usage |
|---------|-------|
| Child process | `spawn()` runs `scripts/backfill-message-activity.ts` |
| Discord API | Sends completion notification to configured channel |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | Discoverable to all |
| Role check | Line 73 | `requireMinRole(ROLE_IDS.COMMUNITY_MANAGER)` |
| Guild check | Line 64 | Guild-only enforcement |

**Gap:** None - appropriate for resource-intensive command.

## Timing Model

| Phase | Method | Notes |
|-------|--------|-------|
| Reply | `reply()` immediate | Non-blocking acknowledgment |
| Background | `spawn()` child process | Runs 15-20 minutes |
| Notify | Fire-and-forget in `close` handler | Sends when done |

**30-minute cooldown** per guild to prevent resource exhaustion.

## Logging Model

| Event | Level | Structured Fields |
|-------|-------|-------------------|
| Starting backfill | INFO | `{ guildId, weeks, dryRun }` |
| Backfill completed | INFO | `{ guildId, weeks, success, totalMessages, channelsProcessed, insertedMessages }` |
| Notification channel not found | WARN | `{ channelId }` |
| Failed to send notification | ERROR | `{ err, guildId }` |
| Failed to spawn process | ERROR | `{ err, guildId }` |

**Gaps:**
- Missing `evt` field for event classification
- No logging during script execution (only start/end)

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete WHAT/WHY/FLOWS |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ❌ | **Missing** - no phase tracking |
| `withSql()` for DB | N/A | No direct DB access |
| Switch-based routing | N/A | No subcommands |
| Error handling | ✅ | Process errors caught |
| Permission helper | ✅ | Uses `requireMinRole()` |

**Deviations:**
1. **No `withStep()` usage** - phases not tracked
2. Uses child process spawn (appropriate for long-running task)
3. Fragile stdout parsing for progress tracking

## Comparison: /backfill vs /resetdata vs /database

| Aspect | /backfill | /resetdata | /database |
|--------|-----------|------------|-----------|
| Permission | Community Manager | Unknown | Unknown |
| withStep | ❌ Missing | Unknown | Unknown |
| Cooldown | 30 min per guild | Unknown | Unknown |
| Execution | Background process | Unknown | Unknown |

## Security Considerations

**GOOD:**
- Role check prevents abuse
- Long cooldown prevents resource exhaustion
- Dry run option for testing

**POTENTIAL ISSUES:**
- stdout parsing could break if script format changes
- No signal handling for cancelled processes

## Bugs / Dead Code

- **Line 92-98**: Date validation is unnecessary - weeks clamped to 1-8 at option level
- **FALLBACK_NOTIFICATION_CHANNEL_ID**: Hardcoded fallback - should be documented
- **Line 213**: TypeScript narrowing check redundant after `isTextBased()` check

## Tests

**Status:** No tests
**Critical paths needing coverage:**
1. Permission rejection
2. Cooldown enforcement
3. Process spawn success/failure
4. Notification channel handling

**Proposed test:**
```typescript
describe('/backfill', () => {
  it('rejects non-Community Manager', async () => {
    const ctx = mockContext({ roles: ['MOD'] });
    await execute(ctx);
    expect(requireMinRole).toHaveBeenCalledWith(
      expect.anything(),
      ROLE_IDS.COMMUNITY_MANAGER,
      expect.anything()
    );
  });
});
```

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P1 | Missing withStep instrumentation | M |
| P2 | Fragile stdout parsing | M |
| P2 | Unnecessary date validation | S |
| P2 | Hardcoded fallback channel | S |

**Recommended commits:**
1. `refactor(backfill): add withStep instrumentation for tracing`
2. `fix(backfill): remove redundant date validation`
3. `chore(backfill): document fallback notification channel`
