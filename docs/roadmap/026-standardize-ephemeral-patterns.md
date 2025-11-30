# Issue #26: Inconsistent Ephemeral Reply Patterns

**Status:** Planned
**Priority:** Medium (UX Consistency)
**Estimated Effort:** 2-3 hours
**Created:** 2025-11-30

## Summary

Commands throughout the codebase use inconsistent `ephemeral` reply patterns. Some use ephemeral for errors but public for success, others do the opposite, and some mix both without clear reasoning. This creates user confusion about which messages are private vs public and makes the bot's behavior unpredictable. This issue proposes establishing and documenting a consistent pattern to improve UX consistency.

## Current State

### Problem

Analysis of 30+ commands reveals three major inconsistencies:

**1. Error Message Patterns**
- **Ephemeral errors** (most common): `flag.ts`, `suggestion.ts`, `panic.ts`, `send.ts`, `health.ts`
  ```typescript
  // Lines like flag.ts:44, suggestion.ts:114, panic.ts:79
  await interaction.reply({
    content: "This command can only be used in a server.",
    ephemeral: true,
  });
  ```

- **Public errors** (rare): Some commands fail without ephemeral flag
  ```typescript
  // No explicit ephemeral flag - defaults to public
  await interaction.reply({ content: "Error occurred" });
  ```

**2. Success Message Patterns**
- **Public success** (moderation actions): `panic.ts:94-96` (on/off), `unblock.ts:133`, `backfill.ts:92`
  ```typescript
  // panic.ts:94 - Public announcement
  await interaction.reply({
    content: "🚨 **PANIC MODE ENABLED**\n\nAll automatic role grants are now **stopped**.",
    ephemeral: false,  // Explicit public
  });
  ```

- **Ephemeral success** (user-facing): `send.ts:281`, `flag.ts:128`, `suggestion.ts:189`
  ```typescript
  // send.ts:281 - Ephemeral confirmation
  await interaction.editReply({
    content: "Sent ✅",
  });  // Deferred with ephemeral: true
  ```

- **Public success** (informational): `activity.ts:66`, `modstats.ts:295`, `listopen.ts:544`
  ```typescript
  // activity.ts:66 - Public so whole team can see
  await interaction.deferReply({ ephemeral: false });
  ```

**3. Status/Query Patterns**
- **Ephemeral status** (most common): `panic.ts:168-171`, `modhistory.ts:134`
  ```typescript
  // panic.ts status - Ephemeral for info queries
  await interaction.reply({
    content: statusMsg,
    ephemeral: true,
  });
  ```

- **Public status**: `artistqueue.ts` - all replies are public
  ```typescript
  // artistqueue.ts:142 - Even errors are public
  await interaction.reply({ content: "Unknown subcommand.", ephemeral: false });
  ```

### Current Comments Reveal Confusion

Several files include explanatory comments acknowledging the inconsistency:

- `unblock.ts:131-132`: "Public reply (ephemeral: false) because unblocking is a moderation action that should be visible to the team"
- `activity.ts:64-65`: "ephemeral: false so the whole team can see the heatmap without someone re-running the command"
- `panic.ts:151-153`: "Status is ephemeral because it's informational only - no need to broadcast to the channel"
- `send.ts:279`: "Acknowledge to invoker ephemerally (never reveals identity in public)"
- `lib/errorCard.ts:161-162`: "Ephemeral so only the actor sees it; avoids channel spam"

These comments show developers are *thinking* about the choice, but there's no unified guideline.

### Documentation Gap

`docs/reference/slash-commands.md:203-207` shows both patterns but provides no guidance on **when** to use each:

```typescript
// Ephemeral
await interaction.reply({ content: "Done!", ephemeral: true });

// Public
await interaction.reply({ content: "Server maintenance at 3 PM." });
```

The section at line 313 only mentions errors should be ephemeral, but doesn't cover success/status patterns.

## Proposed Changes

### Step 1: Establish Clear Guidelines

Create a decision matrix for reply visibility based on message type and audience impact.

**Proposed Pattern:**

| Message Type | Visibility | Reasoning |
|--------------|-----------|-----------|
| **Validation Errors** (missing perms, invalid input, guild-only) | Ephemeral | User-specific error, no value to team |
| **Operation Errors** (DB failure, API timeout, unexpected) | Ephemeral | Avoids channel clutter, user can retry |
| **Moderation Actions** (ban, unblock, panic mode, purge) | Public | Team needs visibility for accountability |
| **User Confirmations** (suggestion submitted, flag recorded) | Ephemeral | Personal acknowledgment, no team value |
| **Team Reports** (stats, analytics, activity heatmaps) | Public | Informational for whole team |
| **Status Queries** (panic status, config values) | Ephemeral | Info-only, user can share if needed |
| **Anonymous Actions** (/send confirmation) | Ephemeral | Must never reveal actor identity |

**Special Cases:**
- `/health` - Public by default (quick status check), ephemeral only on timeout
- `/listopen` - Public (removed ephemeral toggle per line 544 comment)
- `/backfill` - Public (long-running job notification for team)

### Step 2: Document Pattern in Reference Guide

**File:** `docs/reference/slash-commands.md`

Add new section after line 208:

```markdown
### When to Use Ephemeral vs Public Replies

**Use Ephemeral (`ephemeral: true`) for:**
- **Errors** - Validation failures, permission denials, invalid input
  - Keeps channel clean and avoids distracting the team
  - Example: "This command can only be used in a server."

- **User Confirmations** - Personal acknowledgments with no team value
  - Example: "Suggestion submitted ✅" (after /suggest)

- **Status Queries** - Read-only information requests
  - Example: "Panic mode is OFF" (after /panic status)

- **Privacy-Critical** - Commands that must hide the actor
  - Example: "Sent ✅" (after /send)

**Use Public (`ephemeral: false`) for:**
- **Moderation Actions** - Team needs audit trail and visibility
  - Example: "User X has been unblocked" (after /unblock)
  - Example: "🚨 PANIC MODE ENABLED" (after /panic on)

- **Team Reports** - Analytics, stats, heatmaps for shared review
  - Example: Activity heatmap embed (after /activity)
  - Example: Moderator leaderboard (after /modstats)

- **Long-Running Jobs** - Notifications about background tasks
  - Example: "Starting backfill... you'll be pinged when complete" (after /backfill)

**Default Behavior:**
- `ephemeral` defaults to `false` if omitted
- **Always be explicit** - don't rely on defaults for clarity
- Deferred replies inherit ephemeral state from `deferReply()`

**Example Pattern:**
```typescript
// Validation error - ephemeral
if (!interaction.guild) {
  await interaction.reply({
    content: "This command can only be used in a server.",
    ephemeral: true,
  });
  return;
}

// Moderation action - public
await interaction.deferReply({ ephemeral: false });
await performUnblock(userId);
await interaction.editReply({
  content: `✅ User <@${userId}> has been unblocked.`,
});

// Status query - ephemeral
const status = getPanicStatus(guildId);
await interaction.reply({
  content: status.enabled ? "🚨 Panic mode is ACTIVE" : "✅ Panic mode is OFF",
  ephemeral: true,
});
```
```

### Step 3: Create Command Audit Checklist

**File:** `docs/reference/command-checklist.md` (new file)

```markdown
# Command Implementation Checklist

## Reply Visibility

Before merging a new command, verify:

- [ ] Validation errors use `ephemeral: true`
- [ ] Operation errors use `ephemeral: true`
- [ ] Moderation actions use `ephemeral: false` (explicit)
- [ ] Status queries use `ephemeral: true`
- [ ] Team reports/analytics use `ephemeral: false` (explicit)
- [ ] User confirmations use `ephemeral: true`
- [ ] Privacy-critical commands never leak actor identity

## Code Review Questions

1. **Does this command perform a moderation action?**
   - Yes → Public replies for visibility
   - No → Proceed to #2

2. **Does this command return team-wide information?**
   - Yes → Public replies for sharing
   - No → Proceed to #3

3. **Is this a status/info query or user confirmation?**
   - Yes → Ephemeral replies to avoid clutter
   - No → Review case-by-case

## Common Patterns

```typescript
// Guild-only check (ephemeral error)
if (!interaction.guild) {
  await interaction.reply({
    content: "This command can only be used in a server.",
    ephemeral: true,
  });
  return;
}

// Permission check (ephemeral error)
if (!requireStaff(interaction)) {
  // requireStaff already replies ephemerally
  return;
}

// Moderation action (public confirmation)
await interaction.deferReply({ ephemeral: false });
// ... perform action ...
await interaction.editReply({ content: "✅ Action completed." });

// Team report (public result)
await interaction.deferReply({ ephemeral: false });
// ... generate report ...
await interaction.editReply({ embeds: [reportEmbed] });

// Status query (ephemeral result)
await interaction.reply({
  content: getStatusMessage(),
  ephemeral: true,
});
```
```

### Step 4: Audit and Fix Inconsistent Commands

**High Priority Fixes** (inconsistent with proposed pattern):

1. **artistqueue.ts** - All replies are public, including errors
   - Lines 142, 274, 285, 294, etc. - Errors should be ephemeral
   - Fix: Add `ephemeral: true` to validation/error messages
   - Keep action confirmations public (move/skip/unskip are mod actions)

2. **health.ts** - Success is public, timeout error is ephemeral (lines 84, 98)
   - Current behavior is correct but should add comment explaining why
   - Add comment: "Public by default (team status check), ephemeral only on timeout"

**Medium Priority Review** (verify current behavior is correct):

3. **modstats.ts** - Mix of ephemeral and public
   - Line 288: Error is ephemeral ✓ Correct
   - Line 295: Leaderboard is public (deferred line 295) ✓ Correct
   - Line 459: User stats are public (deferred line 459) ✓ Correct
   - Line 568: Reset is ephemeral (deferred line 568) ✓ Correct (sensitive admin op)

4. **panic.ts** - Mix of ephemeral and public
   - Line 79: Guild-only error ephemeral ✓ Correct
   - Line 94-96: Enable/disable public ✓ Correct (mod action)
   - Line 168-171: Status query ephemeral ✓ Correct
   - **No changes needed** - already follows pattern

5. **suggestion.ts** - All replies ephemeral (lines 114, 142, 159, 172, etc.)
   - Current: Staff action confirmations are ephemeral
   - Proposed: Should be public (mod actions for team visibility)
   - Fix: Change `deferReply({ ephemeral: true })` → `deferReply({ ephemeral: false })`
   - Keep validation errors ephemeral (lines 114, 159, 214, 269, 324)

### Step 5: Add Code Comments for Edge Cases

For commands with non-obvious choices, add inline comments explaining the reasoning:

```typescript
// Example: health.ts
await interaction.reply({ embeds: [embed] }); // Public - team status check

// Example: send.ts
await interaction.editReply({ content: "Sent ✅" }); // Ephemeral - never reveal actor

// Example: unblock.ts
await interaction.deferReply({ ephemeral: false }); // Public - moderation action
```

## Files Affected

### Created
- `docs/reference/command-checklist.md` - New command implementation checklist

### Modified (Documentation)
- `docs/reference/slash-commands.md` - Add ephemeral decision matrix section

### Modified (Code - High Priority)
- `src/commands/artistqueue.ts` - Fix error messages to be ephemeral (lines 142, 274, 285, 294, 326, 334, 342, 375, 383, 391)
- `src/commands/suggestion.ts` - Change staff action confirmations to public (lines 172, 227, 283, 329)

### Modified (Code - Add Comments)
- `src/commands/health.ts` - Add comment explaining public default (line 84)
- `src/commands/send.ts` - Comment already exists (line 279) ✓
- `src/commands/panic.ts` - Comment already exists (lines 151-153) ✓
- `src/commands/unblock.ts` - Comment already exists (lines 131-132) ✓

### Reviewed (No Changes Needed)
- `src/commands/panic.ts` - Already follows pattern correctly
- `src/commands/modstats.ts` - Already follows pattern correctly
- `src/commands/flag.ts` - Already follows pattern correctly
- `src/commands/backfill.ts` - Already follows pattern correctly
- `src/commands/activity.ts` - Already follows pattern correctly

## Testing Strategy

### Pre-Implementation Review
1. **Audit all commands** - Create spreadsheet of current ephemeral patterns
2. **Document edge cases** - Identify commands with special requirements
3. **Review with team** - Validate proposed pattern makes sense for UX

### Post-Documentation Testing
1. **Documentation review** - Ensure examples are clear and accurate
2. **Run existing tests** - Verify no breaking changes to test expectations
   ```bash
   npm test
   ```

### Code Changes Testing

For each modified command:

#### artistqueue.ts Testing
```bash
# Test validation errors are now ephemeral
/artistqueue show  # With non-staff user → ephemeral error
/artistqueue move  # With missing guild → ephemeral error
/artistqueue skip  # With staff user → public confirmation ✓
```

#### suggestion.ts Testing
```bash
# Test staff actions are now public
/suggestion approve 1  # Staff action → public confirmation (changed)
/suggestion deny 1 "reason"  # Staff action → public confirmation (changed)
/suggestion delete 1  # Staff action → public confirmation (changed)

# Test errors remain ephemeral
/suggestion approve 999  # Not found → ephemeral error ✓
```

#### Manual Test Matrix

| Command | Scenario | Expected Visibility | Status |
|---------|----------|-------------------|--------|
| artistqueue | Error (missing guild) | Ephemeral | To Fix |
| artistqueue | Success (move artist) | Public | Correct ✓ |
| suggestion | Error (not found) | Ephemeral | Correct ✓ |
| suggestion | Success (approve) | Public | To Fix |
| panic | on/off | Public | Correct ✓ |
| panic | status | Ephemeral | Correct ✓ |
| health | Success | Public | Correct ✓ |
| health | Timeout | Ephemeral | Correct ✓ |
| send | Confirmation | Ephemeral | Correct ✓ |
| unblock | Success | Public | Correct ✓ |
| activity | Heatmap | Public | Correct ✓ |

### Regression Testing
```bash
# Full test suite
npm test

# TypeScript compilation
npm run build

# Lint check
npm run lint
```

## Rollback Plan

### If Documentation is Unclear
1. **Gather feedback** from team about confusing sections
2. **Iterate on examples** - add more real-world cases
3. **Create FAQ section** for edge cases
4. **No code rollback needed** - documentation is non-breaking

### If Code Changes Break Behavior
1. **Identify failing command**
   ```bash
   # Check error logs for interaction failures
   grep "interaction" logs/bot.log
   ```

2. **Quick revert specific file**
   ```bash
   git checkout HEAD -- src/commands/artistqueue.ts
   git checkout HEAD -- src/commands/suggestion.ts
   ```

3. **Verify baseline**
   ```bash
   npm run build && npm test
   ```

### If Users Complain About UX
1. **Document feedback** - which pattern is confusing?
2. **Review specific command** - is it following the pattern correctly?
3. **Consider adjustment** - pattern may need refinement
4. **Update documentation** - clarify edge cases

### Emergency Bypass
If a critical command breaks in production:

```typescript
// Temporary revert - restore original ephemeral value
await interaction.reply({
  content: "...",
  ephemeral: true,  // or false - restore to working state
});

// File issue to re-evaluate pattern for this command
```

## Success Criteria

- [ ] Documentation clearly explains when to use ephemeral vs public
- [ ] Command checklist exists for future command implementations
- [ ] All high-priority commands follow consistent pattern
- [ ] Comments explain non-obvious ephemeral choices
- [ ] Team understands and agrees with the pattern
- [ ] No regressions in existing test suite
- [ ] Users report improved predictability of bot behavior

## Timeline

1. **Phase 1: Documentation** (1 hour)
   - Write decision matrix and guidelines (30 min)
   - Create command checklist (20 min)
   - Team review and feedback (10 min)

2. **Phase 2: Code Audit** (45 minutes)
   - Audit all commands for current patterns (30 min)
   - Create spreadsheet of changes needed (15 min)

3. **Phase 3: Implementation** (45 minutes)
   - Fix artistqueue.ts errors (15 min)
   - Fix suggestion.ts action confirmations (15 min)
   - Add comments to edge cases (15 min)

4. **Phase 4: Testing** (30 minutes)
   - Manual testing of modified commands (20 min)
   - Run full test suite (10 min)

**Total estimated time:** 3 hours

## Post-Implementation Notes

### Monitoring

After deployment, monitor for:
- User feedback about visibility confusion
- Staff feedback about missing moderation visibility
- Edge cases not covered by the pattern

### Future Improvements

1. **Lint rule** - Create ESLint rule to enforce explicit `ephemeral` flag
   ```javascript
   // Warn if ephemeral is omitted in reply/deferReply
   'explicit-ephemeral': 'warn'
   ```

2. **Type helper** - Create utility types for clearer intent
   ```typescript
   type EphemeralReply = { content: string; ephemeral: true };
   type PublicReply = { content: string; ephemeral: false };
   ```

3. **Template snippets** - Add VSCode snippets for common patterns
   ```json
   "Ephemeral Error": {
     "prefix": "err-ephemeral",
     "body": [
       "await interaction.reply({",
       "  content: \"$1\",",
       "  ephemeral: true,",
       "});"
     ]
   }
   ```

4. **Audit script** - Create automated script to detect missing `ephemeral` flags
   ```bash
   # Find all .reply() calls without explicit ephemeral
   grep -rn "\.reply({" src/commands/ | grep -v "ephemeral:"
   ```

### Related Issues

- Issue #8: Extract shared auth helper (uses ephemeral errors correctly)
- Future: Standardize error message formats (should all be ephemeral)
- Future: Create command template with best practices baked in
