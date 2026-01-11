# Command Audit: /update

> File: `src/commands/update.ts` | Created: 2025-11-25 | Author: watchthelight

## Overview

**WHAT:** Centralized control over bot appearance and presence.
**WHY:** Allows staff to update activity, status, banner, and avatar.
**FLOWS:**
- `/update activity` - Sets Playing/Watching/etc. activity
- `/update status` - Sets custom status (green text)
- `/update banner` - Updates profile banner, gate message, welcome message
- `/update avatar` - Updates profile picture (supports animated GIFs)

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` → `commands` array |
| Execute | `execute()` at line 177 |
| Handlers | `handleActivityUpdate()`, `handleStatusUpdate()`, `handleBannerUpdate()`, `handleAvatarUpdate()` |
| Button/Modal handlers | None |

## DB Touches

| Operation | Table | Function | Location |
|-----------|-------|----------|----------|
| Read | `status` | `getStatus("global")` | Lines 241, 261, 298, 319 |
| Write | `status` | `upsertStatus()` | Lines 263, 321 |

## External Services

| Service | Usage |
|---------|-------|
| Discord API | `user.setPresence()` - updates activity/status |
| Discord API | `user.setBanner()` - updates profile banner |
| Discord API | `user.setAvatar()` - updates profile picture |
| GitHub API | `git push` via `execSync` - pushes assets |
| sharp | Image processing for banner/avatar |
| Dynamic import | `ensureGateEntry()` - refreshes gate message |

## Permissions Model

| Subcommand | Role Required | Location |
|------------|---------------|----------|
| activity | Senior Mod | Line 187 |
| status | Senior Mod | Line 187 |
| banner | Community Manager | Line 193 |
| avatar | Community Manager | Line 193 |

**Gap:** None - appropriate role hierarchy.

## Timing Model

| Subcommand | Defer | Notes |
|------------|-------|-------|
| activity | Direct reply | Fast operation |
| status | Direct reply | Fast operation |
| banner | `deferReply()` | Image download + processing |
| avatar | `deferReply()` | Image download + processing |

## Logging Model

| Event | Level | Structured Fields |
|-------|-------|-------------------|
| Banner files saved | INFO | `{ pngSize, webpSize }` |
| Bot profile banner updated | INFO | None |
| Avatar processed | INFO | `{ originalSize, pngSize }` |
| Avatar file saved | INFO | `{ size, filename }` |
| Bot avatar updated | INFO | `{ size, isGif }` |
| Assets pushed to GitHub | INFO | `{ assetType, commitHash }` |
| Gate message refreshed | INFO | `{ guildId, messageId, created, edited }` |
| Failed to refresh gate | WARN | `{ err, guildId }` |
| Failed to push to GitHub | WARN | `{ err, assetType }` |

**Gaps:**
- Missing `evt` field for event classification

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete WHAT/WHY/FLOWS/DOCS |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ✅ | All phases wrapped |
| `withSql()` for DB | ❌ | **Missing** - getStatus/upsertStatus not wrapped |
| Switch-based routing | ⚠️ | Uses if/else chain instead |
| Error handling | ⚠️ | Mixed - some try/catch, some throw |
| Permission helper | ✅ | Uses `requireMinRole()` |

**Deviations:**
1. **No `withSql()` for DB operations** - status store calls not tracked
2. Uses if/else routing instead of switch
3. Uses `ctx.step()` directly at line 185 (should be `withStep()`)
4. `commitAndPushAssets()` uses shell execution

## Security Considerations

**GOOD:**
- Role-based permissions appropriate for asset control
- GitHub token handled in env var
- Token not exposed in remote URL after push

**CRITICAL ISSUES:**
- **Line 71**: `execSync` with string interpolation - potential command injection if commit message contains quotes
- **Line 77-78**: GitHub token exposed in git remote URL during push
- **Lines 59-60, 91**: `execSync` for git config with hardcoded values - should be constants
- **Line 36-102**: Shell execution without proper escaping

## Comparison: /update vs /config

| Aspect | /update | /config |
|--------|---------|---------|
| Scope | Bot appearance | Guild settings |
| withStep | ✅ Mostly | Unknown |
| withSql | ❌ Missing | Unknown |
| Subcommands | 4 | Many |

## Bugs / Dead Code

- **Line 185**: Uses `ctx.step()` instead of `withStep()` - inconsistent with rest of file
- **Line 154**: "modmail_close" action type hack - should add proper action type
- **Line 249**: ActivityType.Custom with `name` field should be `state`

## Tests

**Status:** No tests
**Critical paths needing coverage:**
1. Permission checks per subcommand
2. Image validation (size, type)
3. Presence update and persistence
4. GitHub push success/failure handling

**Proposed test:**
```typescript
describe('/update activity', () => {
  it('requires Senior Mod role', async () => {
    const ctx = mockContext({ subcommand: 'activity', roles: ['MOD'] });
    await execute(ctx);
    expect(requireMinRole).toHaveBeenCalledWith(
      expect.anything(),
      ROLE_IDS.SENIOR_MOD,
      expect.anything()
    );
  });
});
```

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P0 | Shell command injection risk in commitAndPushAssets | M |
| P1 | Missing withSql for DB tracking | M |
| P1 | ctx.step() instead of withStep() on line 185 | S |
| P2 | Should use switch instead of if/else | S |
| P2 | "modmail_close" action type hack | S |

**Recommended commits:**
1. `security(update): escape shell commands in commitAndPushAssets`
2. `refactor(update): add withSql for status store operations`
3. `fix(update): use withStep instead of ctx.step`
4. `refactor(update): convert if/else routing to switch`
5. `feat(logging): add metrics_reset action type`
