# Command Audit: /health

> File: `src/commands/health.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Simple health check showing uptime, WS ping, and scheduler status.
**WHY:** Quick smoke test for bot responsiveness without touching DB.
**FLOWS:**
- Collect metrics (uptime, ws.ping) → display scheduler health → reply with embed

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` → `commands` array |
| Execute | `execute()` at line 93 |
| Button/Modal handlers | None |

## DB Touches

**None** - Intentionally DB-free for true health check.

## External Services

**None** - Only reads local process state.

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None | Public command, anyone can run |
| Role checks | None | No sensitive data exposed |
| Owner checks | None | N/A |

**Gap:** None - appropriate for health check.

## Timing Model

| Phase | Method | Notes |
|-------|--------|-------|
| Response | `interaction.reply()` | Direct reply, no defer needed |
| Timeout | `Promise.race()` with 5s timeout | Good pattern |

**Races:** Timeout path has `.catch()` for expired interaction - good.

## Logging Model

| Event | Level | Structured Fields |
|-------|-------|-------------------|
| Timeout response failure | DEBUG | `{ err }` |

**Gaps:**
- No success log for completed health check (fine for simple command)
- Timeout logs to debug - should be INFO since it's noteworthy

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | WHAT/WHY/FLOWS present |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ✅ | Wraps collect_metrics and reply |
| `withSql()` for DB | N/A | No DB operations |
| Switch-based routing | N/A | No subcommands |
| Error handling | ✅ | Timeout handled, wrapper catches rest |
| Permission helper | N/A | Public command |

**Deviations:** None significant.

## Comparison: /health vs /developer vs /utility

| Aspect | /health | /developer | /utility |
|--------|---------|------------|----------|
| Header | ✅ Complete | Likely incomplete | Likely incomplete |
| withStep | ✅ Yes | Unknown | Unknown |
| Permissions | None | Owner-only | Unknown |
| Complexity | Low | Low | Low |

## Bugs / Dead Code

- **None identified**
- Clean, minimal implementation
- `formatRelativeTime()` could be exported for reuse elsewhere

## Tests

**Status:** No tests
**Critical paths needing coverage:**
1. Happy path - returns embed with uptime/ping
2. Timeout path - returns ephemeral warning
3. Scheduler health display

**Proposed test:**
```typescript
describe('/health', () => {
  it('returns uptime and ws ping in embed', async () => {
    const ctx = mockContext();
    await execute(ctx);
    expect(ctx.interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });
});
```

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Timeout logs at DEBUG instead of INFO | S |

**Recommended commit:** `chore(health): log timeout at INFO level`
