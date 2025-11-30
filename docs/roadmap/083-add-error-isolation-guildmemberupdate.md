# Issue #83: Add Error Isolation to guildMemberUpdate Level Rewards

**Status:** Completed
**Priority:** Critical
**Type:** Bug Fix / Reliability
**Estimated Effort:** 15 minutes

---

## Summary

In the `guildMemberUpdate` event handler, if `handleLevelRoleAdded` throws for one role, remaining roles in the loop are not processed.

## Current State

```typescript
// src/index.ts:732-747
client.on("guildMemberUpdate", wrapEvent("guildMemberUpdate", async (oldMember, newMember) => {
  await handleArtistRoleChange(oldMember, newMember);

  const addedRoles = newMember.roles.cache.filter(
    (role) => !oldMember.roles.cache.has(role.id)
  );

  if (addedRoles.size === 0) return;

  // Check each new role to see if it's a level role
  for (const [roleId, role] of addedRoles) {
    await handleLevelRoleAdded(newMember.guild, newMember, roleId);
    // ⚠️ If this throws, remaining roles are NOT processed
  }
}));
```

## Impact

- If one role reward fails, others are skipped
- Partial reward grants with no retry
- User may miss some rewards they earned

## Proposed Changes

Add error isolation for each role:

```typescript
client.on("guildMemberUpdate", wrapEvent("guildMemberUpdate", async (oldMember, newMember) => {
  await handleArtistRoleChange(oldMember, newMember);

  const addedRoles = newMember.roles.cache.filter(
    (role) => !oldMember.roles.cache.has(role.id)
  );

  if (addedRoles.size === 0) return;

  // Check each new role to see if it's a level role
  // Process independently so one failure doesn't block others
  for (const [roleId, role] of addedRoles) {
    try {
      await handleLevelRoleAdded(newMember.guild, newMember, roleId);
    } catch (err) {
      logger.error({
        err,
        roleId,
        userId: newMember.id,
        guildId: newMember.guild.id,
      }, "[guildMemberUpdate] Failed to process level role reward");
      // Continue to next role
    }
  }
}));
```

Alternative using Promise.allSettled:

```typescript
const results = await Promise.allSettled(
  Array.from(addedRoles.keys()).map(roleId =>
    handleLevelRoleAdded(newMember.guild, newMember, roleId)
  )
);

for (const result of results) {
  if (result.status === 'rejected') {
    logger.error({ err: result.reason }, "[guildMemberUpdate] Level role reward failed");
  }
}
```

## Files Affected

- `src/index.ts:732-747`

## Testing Strategy

1. Test adding multiple level roles at once
2. Mock one role handler to throw
3. Verify other roles still process
4. Check error is logged
