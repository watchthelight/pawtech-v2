# Issue #80: Add Permission Check to /modstats Command

**Status:** Completed
**Priority:** Critical
**Type:** Security
**Estimated Effort:** 15 minutes

---

## Summary

The `/modstats` command has NO permission checks. Any user can view moderator statistics, leaderboards, and export sensitive mod performance data.

## Current State

```typescript
// src/commands/modstats.ts:781-799
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const subcommand = interaction.options.getSubcommand();

  // NO PERMISSION CHECK HERE!

  if (subcommand === "leaderboard") {
    await handleLeaderboard(interaction);
  } else if (subcommand === "user") {
    await handleUser(interaction);
  } else if (subcommand === "export") {
    await handleExport(interaction);
  } else if (subcommand === "reset") {
    await handleReset(interaction);  // Only this has password protection
  }
}
```

## Impact

- Any server member can view moderator performance metrics
- Any member can export CSV files containing moderator activity
- Exposes sensitive moderation patterns and individual moderator behavior
- Only "reset" has password protection, but other subcommands expose data

## Proposed Changes

1. Add staff permission check at start of execute:

```typescript
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;

  // Require staff permissions for all modstats subcommands
  if (!requireStaff(interaction)) {
    await interaction.reply({
      content: "You don't have permission to view moderator statistics.",
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  // ... rest of logic
}
```

2. Add setDefaultMemberPermissions to command builder:

```typescript
export const data = new SlashCommandBuilder()
  .setName("modstats")
  .setDescription("View moderator statistics")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  // ...
```

## Files Affected

- `src/commands/modstats.ts:781-799`

## Testing Strategy

1. Test as non-staff member (should be denied)
2. Test as staff member (should work)
3. Test all subcommands still function correctly
