# Issue #84: Add Bot Permission Pre-flight Checks for Role Operations

**Status:** Completed
**Priority:** High
**Type:** Bug Fix / UX
**Estimated Effort:** 45 minutes

---

## Summary

Role operations (approve, kick, level rewards) attempt to add/remove roles WITHOUT checking if the bot can manage those roles first, causing API errors and poor UX.

## Current State

```typescript
// src/features/review/flows/approve.ts:132-140
if (!result.member.roles.cache.has(role.id)) {
  try {
    // Bot must be above the target role; otherwise 50013 Missing Permissions.
    await withTimeout(
      result.member.roles.add(role, "Gate approval"),
      FLOW_TIMEOUT_MS,
      "approveFlow:addRole"
    );
    result.roleApplied = true;
  } catch (err) {
    // Error handling AFTER the fact
```

## Impact

- Failed role assignments create confusion
- Generates Discord API errors that could be prevented
- No clear feedback to admin that role hierarchy is wrong
- Audit log noise from failed operations

## Proposed Changes

1. The codebase already has `canManageRole()` in `src/features/roleAutomation.ts` - use it:

```typescript
// src/features/roleAutomation.ts:74-104
export function canManageRole(guild: Guild, role: Role): CanManageRoleResult {
  const botMember = guild.members.me;
  if (!botMember) {
    return { canManage: false, reason: "Bot member not cached" };
  }

  const botHighestRole = botMember.roles.highest;
  if (role.position >= botHighestRole.position) {
    return { canManage: false, reason: `Role "${role.name}" is at or above bot's highest role` };
  }

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { canManage: false, reason: "Bot lacks ManageRoles permission" };
  }

  return { canManage: true };
}
```

2. Add pre-flight check to approve flow:

```typescript
// src/features/review/flows/approve.ts
import { canManageRole } from "../roleAutomation.js";

// Before attempting to add role:
const roleCheck = canManageRole(result.member.guild, role);
if (!roleCheck.canManage) {
  result.roleApplied = false;
  result.roleError = roleCheck.reason;
  logger.warn({
    guildId: result.member.guild.id,
    roleId: role.id,
    reason: roleCheck.reason,
  }, "[approve] Cannot manage accepted role - check role hierarchy");
  // Don't attempt the operation
} else {
  // Safe to proceed
  await result.member.roles.add(role, "Gate approval");
  result.roleApplied = true;
}
```

3. Apply same pattern to:
- `src/features/review/flows/kick.ts` (role removal)
- `src/features/levelRewards.ts` (reward roles)
- `src/features/movieNight.ts` (tier roles)

## Files Affected

- `src/features/review/flows/approve.ts`
- `src/features/review/flows/kick.ts`
- `src/features/levelRewards.ts`
- `src/features/movieNight.ts`

## Testing Strategy

1. Test with role below bot's highest (should succeed)
2. Test with role above bot's highest (should fail gracefully with message)
3. Test with ManageRoles permission removed (should fail gracefully)
4. Verify no API errors in logs for preventable failures
