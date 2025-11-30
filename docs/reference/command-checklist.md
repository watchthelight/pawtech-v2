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
   - Yes -> Public replies for visibility
   - No -> Proceed to #2

2. **Does this command return team-wide information?**
   - Yes -> Public replies for sharing
   - No -> Proceed to #3

3. **Is this a status/info query or user confirmation?**
   - Yes -> Ephemeral replies to avoid clutter
   - No -> Review case-by-case

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
