# Command Audit: /poke

> File: `src/commands/poke.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Owner-only command to ping a user across multiple category channels.
**WHY:** Allows owners to get attention from specific users across designated categories.
**FLOWS:**
- Verify owner → fetch channels from configured categories → send sequential poke messages → report results

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` → `commands` array |
| Execute | `execute()` at line 126 |
| Button/Modal handlers | None |

## DB Touches

**Indirect only:**
- `getConfig(guildId)` - reads `poke_category_ids_json` and `poke_excluded_channel_ids_json` from guild config

## External Services

| Service | Usage |
|---------|-------|
| Discord API | `guild.channels.fetch()` - fetches all guild channels |
| Discord API | `channel.send()` - sends poke messages (sequential) |

**Rate limit consideration:** Sequential sending is intentional to avoid rate limit hammering. Good pattern.

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | Discoverable to all |
| Owner check | Line 130 | `isOwner(interaction.user.id)` |

**Gap:** None - owner-only is appropriate for mass-mention command.

## Timing Model

| Phase | Method | Notes |
|-------|--------|-------|
| Defer | `deferReply()` with ephemeral | Correct for long operation |
| Send pokes | Sequential loop | Good for rate limits |
| Reply | `editReply()` with embed | Correct pattern |

**Races:** None - sequential by design.

## Logging Model

| Event | Level | Structured Fields |
|-------|-------|-------------------|
| Poke sent | INFO | `{ evt, channelId, targetUserId, executorId }` |
| Poke failed | ERROR | `{ err, channelId, targetUserId, executorId }` |
| Config parse warning | WARN | `{ guildId, value }` |

**Gaps:**
- No completion log summarizing total sent/failed
- `evt` field used inconsistently (only on success)

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | WHAT/WHY/FLOWS present |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ✅ | Wraps defer, send_pokes, reply |
| `withSql()` for DB | N/A | No direct DB (config access is abstracted) |
| Switch-based routing | N/A | No subcommands |
| Error handling | ✅ | Per-channel errors caught, summarized |
| Permission helper | ⚠️ | Uses `isOwner()` directly, not `requireMinRole()` |

**Deviations:**
- Uses `isOwner()` instead of shared permission helper (fine for owner-only)
- Hardcoded fallback category IDs - could move to constants file

## Comparison: /poke vs /send vs /purge

| Aspect | /poke | /send | /purge |
|--------|-------|-------|--------|
| Permission | Owner-only | Unknown | Unknown |
| Defer | ✅ Ephemeral | Unknown | Unknown |
| withStep | ✅ All phases | Unknown | Unknown |
| Error handling | Per-channel | Unknown | Unknown |

## Bugs / Dead Code

- **Hardcoded fallbacks:** `FALLBACK_CATEGORY_IDS` and `FALLBACK_EXCLUDED_CHANNEL_ID` - should be documented or moved to constants
- **Silent failures:** If category is deleted, no warning (acceptable behavior per docs)

## Tests

**Status:** No tests
**Critical paths needing coverage:**
1. Owner check rejection
2. Successful poke to multiple channels
3. Mixed success/failure reporting
4. Config fallback behavior

**Proposed test:**
```typescript
describe('/poke', () => {
  it('rejects non-owners', async () => {
    const ctx = mockContext({ userId: 'not-owner' });
    await execute(ctx);
    expect(ctx.interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('only available to bot owners') })
    );
  });
});
```

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | No completion summary log | S |
| P2 | Inconsistent `evt` field usage | S |

**Recommended commits:**
1. `fix(poke): add completion summary log with total sent/failed`
2. `refactor(poke): add evt field to error logs for consistency`
