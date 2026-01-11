# Command Audit: /skullmode

> File: `src/commands/skullmode.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Configure skull emoji reaction odds.
**WHY:** Sets the chance (1-1000) for random skull reactions on messages.
**FLOWS:**
- Permission check → update config → reply with status

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` → `commands` array |
| Execute | `execute()` at line 32 |
| Button/Modal handlers | None |

## DB Touches

| Operation | Table | Function | Location |
|-----------|-------|----------|----------|
| Read | `guild_config` | `getConfig()` | Line 56 |
| Write | `guild_config` | `upsertConfig()` | Line 58 |

## External Services

**None**

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | Discoverable to all |
| Role check | Line 44 | `requireMinRole(ROLE_IDS.SENIOR_MOD)` |
| Guild check | Line 35 | Guild-only enforcement |

**Gap:** None - Senior Mod+ is appropriate for fun feature config.

## Timing Model

| Phase | Method | Notes |
|-------|--------|-------|
| Reply | `reply()` ephemeral | Fast operation, no defer needed |

## Logging Model

| Event | Level | Structured Fields |
|-------|-------|-------------------|
| Odds updated | INFO | `{ guildId, odds, enabled, moderatorId }` |

**Gaps:**
- Missing `evt` field for event classification
- Logging happens inside reply step (should be separate)

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete WHAT/WHY/FLOWS/DOCS |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ✅ | All phases wrapped |
| `withSql()` for DB | ❌ | **Missing** - getConfig/upsertConfig not wrapped |
| Switch-based routing | N/A | No subcommands |
| Error handling | ⚠️ | No try/catch for config operations |
| Permission helper | ✅ | Uses `requireMinRole()` |

**Deviations:**
1. **No `withSql()` for DB operations** - config store calls not tracked
2. No error handling around config operations

## Comparison: /skullmode vs /panic

| Aspect | /skullmode | /panic |
|--------|------------|--------|
| Permission | Senior Mod | Senior Admin |
| withStep | ✅ All phases | ❌ Missing |
| withSql | ❌ Missing | ❌ Missing |
| Subcommands | None | on/off/status |
| Complexity | Low | Low |

## Bugs / Dead Code

- **None identified**
- Clean, minimal implementation

## Tests

**Status:** No tests
**Critical paths needing coverage:**
1. Permission rejection
2. Config update
3. Status message (enabled vs disabled)

**Proposed test:**
```typescript
describe('/skullmode', () => {
  it('updates odds in config', async () => {
    const ctx = mockContext();
    ctx.interaction.options.getInteger = () => 50;
    await execute(ctx);
    expect(upsertConfig).toHaveBeenCalledWith(
      expect.any(String),
      { skullmode_odds: 50 }
    );
  });
});
```

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Missing withSql for DB tracking | S |
| P2 | Missing evt field in log | S |

**Recommended commits:**
1. `refactor(skullmode): wrap config calls in withSql`
2. `refactor(skullmode): add evt field to log`
