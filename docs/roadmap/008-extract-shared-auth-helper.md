# Issue #8: Extract Shared Auth Helper from Review Commands

**Status:** Planned
**Priority:** Medium
**Estimated Effort:** 1-2 hours
**Created:** 2025-11-30

## Summary

Two review commands (`setNotifyConfig` and `getNotifyConfig`) contain identical 26-line authorization blocks that implement multi-tier permission checking. This duplication is error-prone and makes security updates require changes in multiple locations. The code should be extracted to a shared helper function.

## Current State

### Problem
Both commands implement identical multi-tier authorization logic:

1. **`src/commands/review/setNotifyConfig.ts:101-126`**
   - Bot owner bypass check via `isOwner()`
   - Server owner check via `interaction.guild?.ownerId`
   - Staff permissions check via `hasStaffPermissions()`
   - Leadership role check via config `leadership_role_id`
   - Returns early with error message if all checks fail

2. **`src/commands/review/getNotifyConfig.ts:46-76`**
   - Identical permission hierarchy (same 4 tiers)
   - Same member validation logic
   - Same error message format
   - Only difference: inline comments are more detailed

### Current Auth Flow
```typescript
// Duplicated in both files:
if (isOwner(userId)) {
  // Bot owner bypass
} else if (interaction.guild?.ownerId === userId) {
  // Server owner
} else {
  const member = interaction.member;
  if (!member || typeof member.permissions === "string") {
    await interaction.reply({
      content: "❌ You must be a server administrator to use this command.",
      ephemeral: true,
    });
    return;
  }

  const hasPerms = hasStaffPermissions(member as any, guildId);
  const config = getConfig(guildId);
  const hasLeadershipRole = config?.leadership_role_id && (member as any).roles.cache.has(config.leadership_role_id);

  if (!hasPerms && !hasLeadershipRole) {
    await interaction.reply({
      content: "❌ You must be a server administrator to use this command.",
      ephemeral: true,
    });
    return;
  }
}
```

### Risk Assessment
- **Security Updates:** Any auth logic changes require updating 2 locations
- **Inconsistency Risk:** Logic can drift between implementations over time
- **Testing Burden:** Each duplication point must be tested separately
- **Code Smell:** Comments in setNotifyConfig acknowledge this is "ideally would be extracted"
- **Maintenance Overhead:** Similar pattern exists in `modhistory.ts:77-108` but uses a proper function

### Precedent
The `modhistory.ts` command already implements a proper `requireLeadership()` function (lines 77-108) that handles the same authorization pattern. This should be the model for extraction.

## Proposed Changes

### Step 1: Create Shared Auth Helper
**Goal:** Extract authorization logic to a reusable utility function

Create new file: `src/utils/requireAdminOrLeadership.ts`

```typescript
/**
 * Authorization helper for admin-level slash commands.
 *
 * PERMISSION HIERARCHY (any one grants access):
 *   1. Bot owner (OWNER_IDS in env) - global override for debugging
 *   2. Guild owner - always has access to their own server
 *   3. Staff permissions (mod_role_ids or ManageGuild) - server admins
 *   4. Leadership role (leadership_role_id in config) - designated oversight role
 *
 * @param interaction - ChatInputCommandInteraction to check
 * @returns Promise<boolean> - true if authorized, false otherwise
 */
export async function requireAdminOrLeadership(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  if (!guildId) {
    return false;
  }

  // Owner override
  if (isOwner(userId)) {
    return true;
  }

  // Guild owner
  if (interaction.guild?.ownerId === userId) {
    return true;
  }

  // Member validation
  const member = interaction.member;
  if (!member || typeof member.permissions === "string") {
    return false;
  }

  // Staff permissions
  if (hasStaffPermissions(member as any, guildId)) {
    return true;
  }

  // Leadership role
  const config = getConfig(guildId);
  if (config?.leadership_role_id && (member as any).roles.cache.has(config.leadership_role_id)) {
    return true;
  }

  return false;
}
```

### Step 2: Update setNotifyConfig.ts
**Goal:** Replace inline auth with helper function

Replace lines 101-126 with:

```typescript
// Authorization check
const authorized = await requireAdminOrLeadership(interaction);
if (!authorized) {
  await interaction.reply({
    content: "❌ You must be a server administrator to use this command.",
    ephemeral: true,
  });
  return;
}
```

Remove now-unused imports:
- `isOwner` from `../../utils/owner.js`
- `hasStaffPermissions, getConfig` from `../../lib/config.js`

Add new import:
```typescript
import { requireAdminOrLeadership } from "../../utils/requireAdminOrLeadership.js";
```

### Step 3: Update getNotifyConfig.ts
**Goal:** Replace inline auth with helper function

Replace lines 46-76 with:

```typescript
// Authorization check
const authorized = await requireAdminOrLeadership(interaction);
if (!authorized) {
  await interaction.reply({
    content: "❌ You must be a server administrator to use this command.",
    ephemeral: true,
  });
  return;
}
```

Update imports (same as Step 2).

### Step 4: Consider Refactoring modhistory.ts (Optional)
**Goal:** Evaluate if modhistory should also use the shared helper

The `modhistory.ts` file has its own `requireLeadership()` function that is nearly identical. Options:

1. **Keep separate** - The function is already well-encapsulated and only used in one place
2. **Migrate** - Replace with shared helper for complete consistency
3. **Merge** - Move `requireLeadership()` to utils and rename it to `requireAdminOrLeadership()`

**Recommendation:** Start with option 1 (keep separate) to minimize scope. Consider option 3 in future refactoring if more commands need this pattern.

### Step 5: Add Unit Tests
**Goal:** Ensure helper function works correctly

Create test file: `tests/utils/requireAdminOrLeadership.test.ts`

Test cases:
- Bot owner always passes
- Guild owner always passes
- Member with staff permissions passes
- Member with leadership role passes
- Member with no permissions fails
- Missing member object fails
- String permissions (edge case) fails
- Null guildId fails

## Files Affected

### Created
- `src/utils/requireAdminOrLeadership.ts` - New shared auth helper

### Modified
- `src/commands/review/setNotifyConfig.ts` - Replace lines 101-126 with helper call
- `src/commands/review/getNotifyConfig.ts` - Replace lines 46-76 with helper call

### Reviewed (no changes needed)
- `src/commands/modhistory.ts` - Has similar pattern but already properly encapsulated
- `src/utils/owner.ts` - Existing dependency, no changes
- `src/lib/config.ts` - Existing dependency, no changes

### Testing
- `tests/utils/requireAdminOrLeadership.test.ts` - New test suite

## Testing Strategy

### Pre-Refactor Testing
1. Verify current auth behavior works:
   ```bash
   # Test with bot owner account
   # Test with server owner account
   # Test with admin/leadership role
   # Test with regular user (should fail)
   ```

2. Document expected behavior for each tier

### Post-Refactor Testing

#### Unit Tests
```bash
npm test -- tests/utils/requireAdminOrLeadership.test.ts
```

Test each permission tier independently:
- Mock interaction objects for each scenario
- Verify true/false returns match expected hierarchy
- Test edge cases (missing member, string permissions)

#### Integration Tests
Test both commands with live interactions:

1. **setNotifyConfig command:**
   - Bot owner can execute
   - Server owner can execute
   - Admin with staff permissions can execute
   - Member with leadership role can execute
   - Regular member receives error

2. **getNotifyConfig command:**
   - Same test matrix as above

#### Regression Testing
```bash
# Full test suite
npm test

# TypeScript compilation
npm run build

# Verify no unexpected behavior changes
npm run lint
```

### Manual Testing Checklist
- [ ] Bot owner can execute both commands
- [ ] Guild owner can execute both commands
- [ ] Member with ManageGuild permission can execute
- [ ] Member with mod_role_id can execute
- [ ] Member with leadership_role_id can execute
- [ ] Regular member receives proper error message
- [ ] Commands work in multiple guilds with different configs
- [ ] Error messages are consistent and user-friendly

## Rollback Plan

### If Helper Function Has Bugs
1. **Immediate Rollback**
   ```bash
   git checkout HEAD -- src/commands/review/setNotifyConfig.ts
   git checkout HEAD -- src/commands/review/getNotifyConfig.ts
   git rm src/utils/requireAdminOrLeadership.ts
   ```

2. **Restore inline auth logic**
   - Both files revert to original 26-line auth blocks
   - All imports restored to original state

3. **Verify baseline**
   ```bash
   npm run build
   npm test
   ```

### If Authorization Fails in Production
1. **Identify failure mode:**
   - Check error logs for auth-related failures
   - Determine which tier is failing (owner/guild/staff/leadership)

2. **Quick fix options:**
   - If helper logic wrong: Hotfix `requireAdminOrLeadership.ts`
   - If imports broken: Restore original inline auth in affected files
   - If type issues: Add proper type guards to helper

3. **Emergency bypass:**
   ```typescript
   // Temporary - revert to inline auth in critical commands
   // Remove helper import, paste original 26-line block
   ```

### If Tests Fail
1. Do not merge until all tests pass
2. Fix helper function logic before proceeding
3. Compare behavior against `modhistory.ts:requireLeadership()` for reference
4. If unfixable, keep current implementation and document issue for later

## Success Criteria

- [ ] New `requireAdminOrLeadership()` helper exists in `src/utils/`
- [ ] Both review commands use the helper (lines reduced from ~26 to ~7)
- [ ] All authorization tiers work correctly (owner, guild, staff, leadership)
- [ ] Unit tests achieve >95% coverage of helper function
- [ ] Integration tests pass for both commands
- [ ] No regressions in existing test suite
- [ ] TypeScript compilation succeeds with no new warnings
- [ ] Code duplication reduced by ~52 lines
- [ ] Similar auth patterns have reference implementation to follow

## Post-Refactor Notes

### Documentation Updates

Update `docs/reference/SECURITY.md` (if exists) or create it:
```markdown
## Command Authorization

Admin-level commands use `requireAdminOrLeadership()` helper for consistent permission checking.

### Permission Hierarchy
1. Bot owner (environment OWNER_IDS)
2. Guild owner (Discord server owner)
3. Staff permissions (hasStaffPermissions check)
4. Leadership role (guild config leadership_role_id)

### Usage
```typescript
import { requireAdminOrLeadership } from "../../utils/requireAdminOrLeadership.js";

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  const authorized = await requireAdminOrLeadership(interaction);
  if (!authorized) {
    await interaction.reply({
      content: "❌ You must be a server administrator to use this command.",
      ephemeral: true,
    });
    return;
  }

  // Command implementation...
}
```
```

### Changelog Entry
```markdown
### Changed
- Extracted duplicate authorization logic to shared `requireAdminOrLeadership()` helper
- Refactored setNotifyConfig and getNotifyConfig commands to use shared auth
- Reduced code duplication by 52 lines

### Added
- New auth utility: `src/utils/requireAdminOrLeadership.ts`
- Unit tests for permission hierarchy validation
```

### Future Improvements
1. Consider migrating `modhistory.ts` to use the same helper
2. Audit other admin commands for similar duplication patterns
3. Add JSDoc examples to helper function
4. Consider creating decorator pattern for cleaner syntax:
   ```typescript
   @requiresAdminOrLeadership()
   export async function execute(ctx: CommandContext) {
     // Already authorized
   }
   ```

## Timeline

1. **Phase 1: Implementation** (45 minutes)
   - Create helper function with proper types and docs (15 min)
   - Update setNotifyConfig.ts (15 min)
   - Update getNotifyConfig.ts (15 min)

2. **Phase 2: Testing** (30 minutes)
   - Write unit tests for helper (20 min)
   - Manual integration testing (10 min)

3. **Phase 3: Review & Deploy** (15 minutes)
   - Code review and lint check (10 min)
   - Documentation updates (5 min)

**Total estimated time:** 1.5 hours
