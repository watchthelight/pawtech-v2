# Issue #89: Add Bot Role Hierarchy Check to Role Configuration

**Status:** Completed
**Priority:** High
**Type:** UX / Bug Prevention
**Estimated Effort:** 30 minutes

---

## Summary

`/roles` command allows configuring tier/reward roles without checking if the bot can actually manage those roles, leading to silent failures when automation tries to assign them.

## Current State

```typescript
// src/commands/roles.ts - allows setting any role
// No validation that bot can manage the configured roles
```

Users can configure roles that are:
- Above the bot's highest role position
- @everyone role
- Managed roles (bot/integration roles)

These configurations will silently fail when level rewards or tier automation runs.

## Proposed Changes

1. Add validation when configuring roles:

```typescript
import { canManageRole } from "../features/roleAutomation.js";

// When setting a tier role or reward role:
const role = interaction.options.getRole("role", true);

const check = canManageRole(interaction.guild!, role as Role);
if (!check.canManage) {
  await interaction.reply({
    content: `⚠️ Cannot configure this role: ${check.reason}\n\nPlease choose a role that is below the bot's highest role.`,
    ephemeral: true,
  });
  return;
}
```

2. Add warning for existing misconfigured roles:

```typescript
// When displaying /roles list or /config
const configuredRoles = [/* tier roles, reward roles */];
const warnings: string[] = [];

for (const roleId of configuredRoles) {
  const role = guild.roles.cache.get(roleId);
  if (role) {
    const check = canManageRole(guild, role);
    if (!check.canManage) {
      warnings.push(`⚠️ ${role.name}: ${check.reason}`);
    }
  }
}

if (warnings.length > 0) {
  embed.addFields({
    name: "⚠️ Configuration Warnings",
    value: warnings.join("\n"),
    inline: false,
  });
}
```

3. Show role position info in configuration:

```typescript
// Show helpful info about role hierarchy
const botMember = guild.members.me;
const botHighestRole = botMember?.roles.highest;

embed.setFooter({
  text: `Bot can manage roles below position ${botHighestRole?.position ?? 0} (${botHighestRole?.name ?? 'unknown'})`,
});
```

## Files Affected

- `src/commands/roles.ts`
- `src/commands/config.ts` (if role configuration there)
- `src/lib/configCard.ts` (add warnings display)

## Testing Strategy

1. Try to configure role above bot's highest
2. Verify error message is shown
3. Configure valid role (should work)
4. Check existing config shows warnings for invalid roles
