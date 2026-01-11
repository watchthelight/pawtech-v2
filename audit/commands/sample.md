# Command Audit: /sample

> File: `src/commands/sample.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Preview review cards and other UI components.
**WHY:** Allows mods to see review cards without real applications. Useful for training and UI debugging.
**FLOWS:**
- `/sample reviewcard [status] [applicant] [claimed_by] [long]` → Shows sample review card

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` → `commands` array |
| Execute | `execute()` at line 70 |
| Handlers | `handleReviewPreview()` |
| Button/Modal handlers | None (buttons are non-functional preview) |

## DB Touches

**None** - Uses hardcoded sample data.

## External Services

**None** - Pure UI preview.

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | Discoverable to all |
| Multi-layer | Lines 93-98 | `canRunAllCommands` OR `hasManageGuild` OR `isReviewer` |
| Guild check | Line 37 | `setDMPermission(false)` |

**Gap:** None - appropriate for training command.

## Timing Model

| Phase | Method | Notes |
|-------|--------|-------|
| Reply | `reply()` ephemeral | Fast operation, no defer needed |

## Logging Model

**None** - Preview-only command, no audit needed.

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete WHAT/WHY/FLOWS |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ✅ | All phases wrapped |
| `withSql()` for DB | N/A | No DB operations |
| Switch-based routing | ✅ | Clean switch for subcommands |
| Error handling | ⚠️ | No try/catch (relies on wrapper) |
| Permission helper | ⚠️ | Custom multi-layer check, not `requireMinRole()` |

**Deviations:**
1. Custom permission check instead of `requireMinRole()` (acceptable for OR logic)
2. No error handling (relies on command wrapper)

## Comparison: /sample vs /health

| Aspect | /sample | /health |
|--------|---------|---------|
| Permission | Reviewer OR ManageGuild | None |
| withStep | ✅ All phases | ✅ All phases |
| DB | None | None |
| Complexity | Medium | Low |

## Bugs / Dead Code

- **None identified**
- Clean implementation
- Good use of sample data from constants file

## Tests

**Status:** No tests
**Critical paths needing coverage:**
1. Permission check (all three paths)
2. Sample data generation
3. UI component building

**Proposed test:**
```typescript
describe('/sample reviewcard', () => {
  it('shows sample review card for reviewers', async () => {
    const ctx = mockContext({ isReviewer: true });
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
| P2 | Custom permission logic instead of shared | S |

**Recommended commits:**
1. `docs(sample): add inline comments for permission logic`
