# Command Audit: /resetdata

> File: `src/commands/resetdata.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Admin command to reset metrics from current timestamp forward.
**WHY:** Allows starting fresh metrics analysis without deleting historical logs.
**FLOWS:**
- Validate password → check permissions → set epoch → clear caches → clear DB → log action

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` → `commands` array |
| Execute | `execute()` at line 47 |
| Button/Modal handlers | None |

## DB Touches

| Operation | Table | Function | Location |
|-----------|-------|----------|----------|
| Write | `metrics_epoch` | `setMetricsEpoch()` | Line 130 |
| Delete | `mod_metrics` | `db.prepare().run()` | Line 143 |

## External Services

| Service | Usage |
|---------|-------|
| Discord API | `logActionPretty()` - audit trail |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | Line 37 | `ManageGuild` required |
| Password | Line 74-92 | `RESET_PASSWORD` env var |
| Role check | Line 98-123 | `ADMIN_ROLE_ID` env var (optional) |

**Double-layer auth:** Password + (ManageGuild OR admin role).

## Timing Model

| Phase | Method | Notes |
|-------|--------|-------|
| Defer | `deferReply()` ephemeral | Immediate (line 51) |
| Operations | Sequential | Set epoch, clear caches, clear DB |
| Reply | `editReply()` | Final confirmation |

**Brute force protection:** Cooldown on failed password attempts.

## Logging Model

| Event | Level | Structured Fields |
|-------|-------|-------------------|
| Password not configured | ERROR | None (just message) |
| Incorrect password | WARN | `{ userId, guildId }` |
| Unauthorized attempt | WARN | `{ userId, guildId }` |
| Reset successful | INFO | `{ userId, guildId, epoch }` |

**Gaps:**
- Password not configured log lacks structured fields
- Missing `evt` field for event classification
- **Line 154**: Uses wrong action type `modmail_close` - should be `metrics_reset`

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete WHAT/WHY/FLOWS/DOCS |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ✅ | All phases wrapped |
| `withSql()` for DB | ❌ | **Missing** - db.prepare() not wrapped |
| Switch-based routing | N/A | No subcommands |
| Error handling | ⚠️ | No try/catch around operations |
| Permission helper | ⚠️ | Custom permission logic instead of `requireMinRole()` |

**Deviations:**
1. **No `withSql()` for DB operations** - DELETE query not tracked
2. Custom permission logic (lines 97-123) instead of shared helper
3. Uses `modmail_close` action type instead of proper `metrics_reset`
4. No error handling for epoch/cache/DB operations

## Security Considerations

**GOOD:**
- `secureCompare()` for password (timing-safe)
- Brute force cooldown
- Two-layer authentication
- Audit logging

**POTENTIAL ISSUES:**
- `ADMIN_ROLE_ID` parsing assumes comma-separated format
- No validation of role IDs format

## Comparison: /resetdata vs /purge

| Aspect | /resetdata | /purge |
|--------|------------|--------|
| Password | ✅ Required | ✅ Required |
| Cooldown | Brute force only | 5 min + brute force |
| withStep | ✅ Present | ❌ Missing |
| withSql | ❌ Missing | N/A (no DB) |
| Audit log | ✅ Present | ❌ Missing |

## Bugs / Dead Code

- **Line 154**: Action type `modmail_close` is wrong - should add `metrics_reset` to ActionType enum
- **Line 21**: Imports `__test__clearModMetricsCache` - test helper used in prod (naming suggests test-only)
- **Line 143**: Raw db.prepare() without withSql wrapper

## Tests

**Status:** No tests
**Critical paths needing coverage:**
1. Password validation
2. Permission checks (ManageGuild + admin role)
3. Epoch setting
4. Cache clearing
5. Audit logging

**Proposed test:**
```typescript
describe('/resetdata', () => {
  it('rejects incorrect password', async () => {
    const ctx = mockContext();
    process.env.RESET_PASSWORD = 'correct';
    ctx.interaction.options.getString = () => 'wrong';
    await execute(ctx);
    expect(ctx.interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Incorrect password') })
    );
  });
});
```

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P1 | Wrong action type (modmail_close vs metrics_reset) | S |
| P1 | Missing withSql for DB tracking | S |
| P1 | No error handling for operations | M |
| P2 | Test helper imported in prod (__test__ prefix) | S |
| P2 | Custom permission logic instead of shared | M |

**Recommended commits:**
1. `feat(logging): add metrics_reset action type to ActionType`
2. `fix(resetdata): use metrics_reset action type`
3. `refactor(resetdata): wrap DB DELETE in withSql`
4. `fix(resetdata): add try/catch for operations`
5. `refactor(resetdata): export clearModMetricsCache without __test__ prefix`
