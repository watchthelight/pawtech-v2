# Command Audit: /panic

> File: `src/commands/panic.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Emergency shutoff for role automation system.
**WHY:** Safety valve during testing - instantly stops all automatic role grants.
**FLOWS:**
- `/panic on` → enable panic mode (stops all auto-grants)
- `/panic off` → disable panic mode (resume normal operation)
- `/panic status` → check current state

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` → `commands` array |
| Execute | `execute()` at line 73 |
| Subcommands | on, off, status (switch-based at line 94) |
| Button/Modal handlers | None |

## DB Touches

| Operation | Table | Function | Location |
|-----------|-------|----------|----------|
| Write | `panic_state` | `setPanicMode()` | Lines 102, 134 |
| Read | `panic_state` | `getPanicDetails()` | Line 162 |

## External Services

| Service | Usage |
|---------|-------|
| Discord API | `logActionPretty()` sends to audit channel |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | Discoverable to all |
| Role check | Line 85 | `requireMinRole(ROLE_IDS.SENIOR_ADMIN)` |
| Guild check | Line 76 | Guild-only enforcement |

**Gap:** None - Senior Admin+ is appropriate for emergency control.

## Timing Model

| Phase | Method | Notes |
|-------|--------|-------|
| on/off | `reply()` direct | Fast path, no defer needed |
| status | `reply()` ephemeral | Fast read operation |
| Audit log | Fire-and-forget `.catch()` | Non-blocking, good pattern |

**Races:** None - simple read/write operations.

## Logging Model

| Event | Level | Structured Fields |
|-------|-------|-------------------|
| Panic enabled | WARN | `{ evt, guildId, userId, action }` |
| Panic disabled | INFO | `{ evt, guildId, userId, action }` |
| Audit log failure | WARN | `{ err, guildId, action }` |

**Gaps:**
- Status check has no logging (acceptable - read-only)
- Good pattern: WARN for enable (exceptional), INFO for disable

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | WHAT/WHY/FLOWS present |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ❌ | **Missing** - direct reply without wrapping |
| `withSql()` for DB | ❌ | **Missing** - setPanicMode/getPanicDetails not wrapped |
| Switch-based routing | ✅ | Clean switch for subcommands |
| Error handling | ⚠️ | Audit log failure caught, but DB errors not |
| Permission helper | ✅ | Uses `requireMinRole()` |

**Deviations:**
1. **No `withStep()` usage** - should wrap permission check, subcommand execution
2. **No `withSql()` usage** - DB calls should be tracked
3. Uses `const interaction = ctx.interaction` instead of destructuring (minor)

## Comparison: /panic vs /skullmode vs /resetdata

| Aspect | /panic | /skullmode | /resetdata |
|--------|--------|------------|------------|
| Permission | Senior Admin | Unknown | Unknown |
| withStep | ❌ Missing | Unknown | Unknown |
| withSql | ❌ Missing | Unknown | Unknown |
| Subcommands | on/off/status | Unknown | Unknown |
| Audit trail | ✅ Discord + Logger | Unknown | Unknown |

## Bugs / Dead Code

- **No `withStep/withSql` instrumentation** - phases not tracked in traces
- Code is otherwise clean and well-documented

## Tests

**Status:** No tests
**Critical paths needing coverage:**
1. Permission rejection for non-Senior Admin
2. Panic on/off toggle behavior
3. Status display with/without panic enabled
4. Audit log failure handling

**Proposed test:**
```typescript
describe('/panic', () => {
  it('requires Senior Admin role', async () => {
    const ctx = mockContext({ roles: ['MOD'] });
    await execute(ctx);
    expect(requireMinRole).toHaveBeenCalledWith(
      expect.anything(),
      ROLE_IDS.SENIOR_ADMIN,
      expect.anything()
    );
  });
});
```

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P1 | Missing withStep instrumentation | M |
| P1 | Missing withSql for DB tracking | M |
| P2 | DB errors not explicitly caught | S |

**Recommended commits:**
1. `refactor(panic): add withStep instrumentation for tracing`
2. `refactor(panic): wrap DB calls in withSql for tracking`
3. `fix(panic): add explicit DB error handling`
