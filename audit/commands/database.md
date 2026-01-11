# Command Audit: /database

> File: `src/commands/database.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Database health check and recovery commands.
**WHY:** Allows staff to verify database integrity and recover from backups.
**FLOWS:**
- `/database check` - Runs integrity checks, shows stats, sync status
- `/database recover` - Interactive backup recovery assistant

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` → `commands` array |
| Execute | `execute()` at line 638 |
| Handlers | `executeCheck()`, `executeRecover()` |
| Button handlers | Yes - recovery buttons with nonce validation |

## DB Touches

| Operation | Table | Function | Location |
|-----------|-------|----------|----------|
| Read | Multiple | `checkDatabaseHealth()` | Line 233 |
| Read | Backups | `listCandidates()` | Line 604 |
| Write | Recovery | `restoreCandidate()` | (via buttons) |

## External Services

| Service | Usage |
|---------|-------|
| SSH | Remote database health check |
| Shell | `execAsync()` for remote commands |
| File system | Local backup analysis |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Owner only | Line 648 | `requireOwnerOnly()` |
| Password | Line 567 | `RESET_PASSWORD` for recover |
| Cooldown | Line 209 | Rate limit on check |

**Gap:** None - Owner-only + password is appropriate for dangerous operations.

## Timing Model

| Subcommand | Defer | Notes |
|------------|-------|-------|
| check | `deferReply()` | SSH operations take time |
| recover | `deferReply()` ephemeral | Contains system info |

## Logging Model

| Event | Level | Structured Fields |
|-------|-------|-------------------|
| Running health check | INFO | `{ guildId }` |
| Could not stat file | DEBUG/WARN | `{ err, file }` |
| Remote check failed | DEBUG | `{ err }` |
| Health check completed | INFO | `{ guildId, localHealthy, remoteHealthy, moderatorId }` |
| Recovery denied | WARN | `{ evt, guildId, userId }` |
| Recovery authorized | INFO | `{ evt, guildId, userId }` |
| Listed candidates | INFO | `{ candidateCount }` |
| Recovery assistant invoked | INFO | `{ guildId, userId }` |
| Recovery assistant sent | INFO | `{ guildId, userId, candidateCount }` |
| Recovery failed | ERROR | `{ err, guildId, userId }` |

**Good:** Uses `evt` field for some events (recovery).

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete WHAT/WHY/HOW/DOCS |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ⚠️ | Uses `ctx.step()` directly, not wrapped |
| `withSql()` for DB | ❌ | **Missing** - DB health check not wrapped |
| Switch-based routing | ⚠️ | Uses if/else chain |
| Error handling | ✅ | Try/catch for SSH and recovery |
| Permission helper | ✅ | Uses `requireOwnerOnly()` |

**Deviations:**
1. Uses `ctx.step()` directly instead of `withStep()` wrapper
2. If/else routing instead of switch
3. Very complex - 662 lines for 2 subcommands

## Security Considerations

**GOOD:**
- `validateRemoteAlias()` and `validateRemotePath()` prevent shell injection
- `secureCompare()` for password (timing-safe)
- Nonce in recovery buttons prevents replay attacks
- Owner-only + password double-gate

**NOTES:**
- SSH with `StrictHostKeyChecking=no` is risky but acceptable for internal use
- Remote paths validated against regex

## Comparison: /database vs /resetdata

| Aspect | /database | /resetdata |
|--------|-----------|------------|
| Permission | Owner-only | ManageGuild + password |
| withStep | ⚠️ ctx.step() | ✅ withStep() |
| Complexity | High (662 lines) | Low (180 lines) |
| SSH | Yes | No |

## Bugs / Dead Code

- **Line 20**: `wrapCommand` imported but not used (already wrapped by caller)
- **Line 183**: `isRunningOnRemote()` heuristics are fragile
- **Lines 224, 261, 270, 359, 527, 554, 599, 619, 646**: Uses `ctx.step()` instead of `withStep()`

## Tests

**Status:** No tests
**Critical paths needing coverage:**
1. Owner-only permission check
2. Rate limiting
3. Password validation for recover
4. SSH parameter validation
5. Recovery button handling

**Proposed test:**
```typescript
describe('/database check', () => {
  it('rate limits database checks', async () => {
    const ctx = mockContext();
    await executeCheck(ctx);
    // Second call should be blocked
    await executeCheck(ctx);
    expect(ctx.interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('cooldown') })
    );
  });
});
```

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P1 | Uses ctx.step() instead of withStep() | M |
| P1 | Unused wrapCommand import | S |
| P2 | If/else routing instead of switch | S |
| P2 | Fragile isRunningOnRemote() heuristics | M |

**Recommended commits:**
1. `refactor(database): use withStep instead of ctx.step`
2. `chore(database): remove unused wrapCommand import`
3. `refactor(database): convert if/else routing to switch`
