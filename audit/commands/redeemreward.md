# Command Audit: /redeemreward

> File: `src/commands/redeemreward.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Assign art rewards to users from artist rotation queue.
**WHY:** Staff can assign the next artist from rotation queue and manage ticket roles.
**FLOWS:**
- Staff runs command → shows confirmation with ticket roles → staff confirms → removes role, assigns artist

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` → `commands` array |
| Execute | `execute()` at line 116 |
| Button handlers | Yes - `redeemreward:*` buttons with confirmId |

## DB Touches

| Operation | Table | Function | Location |
|-----------|-------|----------|----------|
| Read | `ticket_roles` | `getTicketRoles()` | Line 145 |
| Read | `artist_rotation` | `getNextArtist()` | Line 178 |
| Read | `artist_rotation` | `getArtist()` | Line 174 |
| Read | `artist_role` | `getArtistRoleId()` | Line 161 |

## External Services

| Service | Usage |
|---------|-------|
| Discord API | `guild.members.fetch()` - fetch target member |
| Discord API | Button interaction for confirmation |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | Line 48 | `ManageRoles` required |
| Guild check | Line 119 | Guild-only enforcement |

**Gap:** No role hierarchy check - relies only on Discord permission.

## Timing Model

| Phase | Method | Notes |
|-------|--------|-------|
| Reply | `reply()` direct | Shows confirmation embed |
| Confirm | Button handler | Executes assignment |

No defer needed - fast operation.

## Logging Model

| Event | Level | Structured Fields |
|-------|-------|-------------------|
| Confirmation shown | INFO | `{ guildId, recipientId, artType, artistId, isOverride, hasTicketRole, confirmId }` |

**Gaps:**
- Missing `evt` field for event classification
- No logging for button confirmation (likely in button handler)

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete WHAT/WHY/FLOWS |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ⚠️ | Uses `ctx.step()` directly |
| `withSql()` for DB | ❌ | **Missing** - DB reads not wrapped |
| Switch-based routing | N/A | No subcommands |
| Error handling | ✅ | Try/catch for member fetch |
| Permission helper | ⚠️ | Uses Discord perms only, no `requireMinRole()` |

**Deviations:**
1. Uses `ctx.step()` directly instead of `withStep()` wrapper
2. No `withSql()` for database operations
3. Uses Discord permission instead of role hierarchy
4. Button handler not in same file (separate event handler)

## Comparison: /redeemreward vs /flag

| Aspect | /redeemreward | /flag |
|--------|---------------|-------|
| Permission | ManageRoles | Junior Mod |
| withStep | ⚠️ ctx.step() | ✅ withStep() |
| withSql | ❌ Missing | ✅ Wrapped |
| Confirmation | ✅ Two-step buttons | None |

## Security Considerations

**GOOD:**
- Two-step confirmation prevents accidents
- confirmId prevents replay/reuse
- Override artist validated against Server Artist role

**POTENTIAL ISSUES:**
- Button customId encodes all state - could be parsed/faked if nonce not validated

## Bugs / Dead Code

- **Lines 128, 142, 150, 190**: Uses `ctx.step()` instead of `withStep()`
- **Line 195**: `randomUUID().slice(0, 8)` - 8 hex chars = 32 bits, reasonable for short-lived token

## Tests

**Status:** No tests
**Critical paths needing coverage:**
1. Member not found handling
2. Ticket role inspection
3. Queue rotation vs override
4. Button confirmation flow

**Proposed test:**
```typescript
describe('/redeemreward', () => {
  it('shows confirmation with ticket role status', async () => {
    const ctx = mockContext();
    ctx.interaction.options.getUser = () => mockUser;
    ctx.interaction.options.getString = () => 'headshot';
    await execute(ctx);
    expect(ctx.interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array)
      })
    );
  });
});
```

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P1 | Uses ctx.step() instead of withStep() | M |
| P1 | Missing withSql for DB tracking | M |
| P2 | No role hierarchy check | S |
| P2 | Missing evt field in log | S |

**Recommended commits:**
1. `refactor(redeemreward): use withStep instead of ctx.step`
2. `refactor(redeemreward): wrap DB calls in withSql`
3. `fix(redeemreward): add requireMinRole for consistency`
