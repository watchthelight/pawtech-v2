# Slash Commands

All commands are registered per-server and updated with `npm run deploy:cmds`.

## Command List

| Command | What It Does | Who Can Use |
|---------|-------------|-------------|
| `/gate` | Submit join application | Everyone |
| `/accept` | Approve an application | Mods |
| `/reject` | Deny an application | Mods |
| `/kick` | Remove a member | Mods with Kick permission |
| `/unclaim` | Release a claimed application | Mods |
| `/health` | Check bot status | Everyone |
| `/config` | Change server settings | Admins |
| `/modmail` | Close or reopen tickets | Mods |
| `/analytics` | View stats report | Mods |
| `/modstats` | View mod performance | Mods |
| `/send` | Send message as bot | Admins |
| `/flag` | Mark user as potential bot | Mods |

## How Commands Work

### Modal Commands (/gate)
1. User types `/gate`
2. Bot shows a popup form
3. User fills out name, age, reason
4. Bot creates review card for mods

### Button Interactions
When mods click "Claim" on a review card, the bot updates the database and changes the button to "Unclaim".

### Slash Command Options
Commands like `/accept` take options:
```
/accept app_id:123 reason:"Looks good"
```

## Reply Types

**Ephemeral (only you see):**
- Errors
- Confirmations
- Status checks

**Public (everyone sees):**
- Mod actions (for transparency)
- Team reports and stats

Example:
```typescript
// Ephemeral error
await interaction.reply({
  content: "Error!",
  ephemeral: true
});

// Public mod action
await interaction.reply({
  content: "User banned"
  // ephemeral defaults to false
});
```

## Permissions

Commands check permissions at two levels:

1. **Discord level:** Set in command definition (like "Manage Messages")
2. **Bot level:** Checks user roles in the server

Owner IDs in config can bypass all permission checks.

## Registering Commands

Commands are defined in `src/commands/` and registered with:

```bash
npm run deploy:cmds
```

This must be run after:
- Adding new commands
- Changing command options
- Updating descriptions

## Common Issues

**Command not showing?**
- Run `npm run deploy:cmds`
- Check if command is disabled in Discord server settings

**Permission denied?**
- Check user has correct Discord permission
- Check user has required role (for mod commands)

**Changes not working?**
- Re-run `npm run deploy:cmds` after editing commands
