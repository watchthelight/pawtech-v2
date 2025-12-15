# Command Checklist

## When to Use Ephemeral vs Public

**Ephemeral (only you see it):**
- Errors and validation messages
- Personal confirmations
- Status checks
- Private info

**Public (everyone sees it):**
- Mod actions (for transparency)
- Team reports and stats
- Long-running job notifications

## Quick Check

1. Is this a mod action? → Public
2. Is this a team report? → Public
3. Is this a status check or error? → Ephemeral

## Code Patterns

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
await interaction.editReply({ content: "Action completed." });

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
