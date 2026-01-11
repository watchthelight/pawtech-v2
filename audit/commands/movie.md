# Command Audit: /movie

> File: `src/commands/movie.ts` | Created: 2025-11-25 | Author: watchthelight
> **Note:** Deprecated in favor of `/event movie`

## Overview

**WHAT:** Movie night attendance tracking commands.
**WHY:** Track VC participation and assign tier roles.
**FLOWS:**
- `/movie start <channel>` → Start tracking attendance
- `/movie end` → Finalize attendance, assign tier roles
- `/movie attendance [@user]` → View stats
- `/movie add` → Manually add minutes
- `/movie credit` → Credit historical attendance
- `/movie bump` → Give full credit (compensation)
- `/movie resume` → Check recovery status after restart

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` → `commands` array |
| Execute | `execute()` at line 190 |
| Handlers | 7 handlers: `handleStart`, `handleEnd`, `handleAttendance`, `handleAdd`, `handleCredit`, `handleBump`, `handleResume` |
| Button/Modal handlers | None |

## DB Touches

| Operation | Table | Function | Location |
|-----------|-------|----------|----------|
| Read | `movie_attendance` | `db.prepare().all()` | Multiple |
| Read | `movie_event` | `getActiveMovieEvent()` | Multiple |
| Write | `movie_event` | `startMovieEvent()` | Line 263 |
| Write | `movie_attendance` | `finalizeMovieAttendance()` | Line 331 |
| Write | `movie_attendance` | `addManualAttendance()` | Line 559 |
| Write | `movie_attendance` | `creditHistoricalAttendance()` | Line 637 |
| Write | `movie_attendance` | `bumpAttendance()` | Line 707 |

## External Services

| Service | Usage |
|---------|-------|
| Discord API | `guild.members.fetch()` - for role updates |
| Discord API | Role management for tier roles |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | Discoverable to all |
| Role check | Line 202 | `requireMinRole(ROLE_IDS.MODERATOR)` |
| Guild check | Line 193 | Guild-only enforcement |

**Gap:** None - Moderator+ is appropriate for event management.

## Timing Model

| Subcommand | Defer | Notes |
|------------|-------|-------|
| start | `deferReply()` | Initializing members takes time |
| end | `deferReply()` | Finalizing + role updates take time |
| attendance | `deferReply()` | DB queries |
| add | Direct reply | Fast operation |
| credit | `deferReply()` ephemeral | DB operations |
| bump | `deferReply()` ephemeral | DB operations |
| resume | Direct reply ephemeral | Fast read |

## Logging Model

| Event | Level | Structured Fields |
|-------|-------|-------------------|
| Movie start command | INFO | `{ evt, guildId, channelId, eventDate, retroactiveCount, invokedBy }` |
| Movie end command | INFO | `{ evt, guildId, eventDate, invokedBy }` |

**Good:** Uses `evt` field for event classification.

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete with deprecation note |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ✅ | All phases wrapped |
| `withSql()` for DB | ✅ | DB queries wrapped |
| Switch-based routing | ✅ | Clean switch for subcommands |
| Error handling | ⚠️ | Mixed - some handlers lack try/catch |
| Permission helper | ✅ | Uses `requireMinRole()` |

**Deviations:**
- **None significant** - exemplary command structure
- Very comprehensive (792 lines, 7 subcommands)

## Comparison: /movie vs /event

| Aspect | /movie | /event |
|--------|--------|--------|
| Status | Deprecated | Current |
| withStep | ✅ All phases | Unknown |
| withSql | ✅ Wrapped | Unknown |
| Subcommands | 7 | Unknown |

## Bugs / Dead Code

- **Line 24**: `ensureDeferred` imported but not used
- **Deprecation**: Entire command is deprecated but still functional

## Tests

**Status:** No tests
**Critical paths needing coverage:**
1. Start event (with existing users in VC)
2. End event (role assignment)
3. Attendance tracking
4. Manual adjustments (add, credit, bump)
5. Recovery after restart

**Proposed test:**
```typescript
describe('/movie start', () => {
  it('starts tracking attendance', async () => {
    const ctx = mockContext();
    ctx.interaction.options.getChannel = () => mockVoiceChannel;
    await execute(ctx);
    expect(startMovieEvent).toHaveBeenCalledWith(
      expect.anything(),
      mockVoiceChannel.id,
      expect.any(String)
    );
  });
});
```

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Unused ensureDeferred import | S |
| P2 | Deprecated but still active | Info only |
| P2 | Some handlers lack try/catch | M |

**Recommended commits:**
1. `chore(movie): remove unused ensureDeferred import`
2. `fix(movie): add try/catch to remaining handlers`
