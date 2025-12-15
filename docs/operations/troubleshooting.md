# Troubleshooting

## Common Problems

### 1. Missing Database Column Error

**Error**:

```
SqliteError: no such column: configs.logging_channel_id
```

**When this happens**:

- Running `/config set logging`
- Bot tries to read logging channel from database
- Any query using `configs.logging_channel_id`

**Cause**: Database migration not run yet.

**Fix**:

```bash
# Backup database
cp data/data.db data/data.db.backup_$(date +%Y%m%d_%H%M%S)

# Add the missing column
sqlite3 data/data.db "ALTER TABLE configs ADD COLUMN logging_channel_id TEXT;"

# Set default value if you have one
sqlite3 data/data.db "UPDATE configs SET logging_channel_id = '$LOGGING_CHANNEL' WHERE logging_channel_id IS NULL;"

# Check it worked
sqlite3 data/data.db "PRAGMA table_info(configs);" | grep logging_channel_id

# Restart bot
systemctl restart pawtropolis
```

**Better fix (use migrations)**:

```bash
npm run migrate
```

**Test it**:

```bash
# In Discord:
/config set logging channel:#audit-log

# Check database:
sqlite3 data/data.db "SELECT logging_channel_id FROM configs WHERE guild_id='<GUILD_ID>';"
```

---

### 2. Cannot Rename Table Error

**Error**:

```
Error: Legacy SQL detected: ALTER TABLE review_action RENAME TO review_action_old;
better-sqlite3 blocks this to prevent data loss.
```

**When this happens**:

- Running a migration that renames a table
- Trying to rename columns

**Cause**: better-sqlite3 blocks table renames for safety.

**Fix**:

Run the migration script - it creates a new table, copies data, then swaps:

```bash
# Backup first
cp data/data.db data/data.db.backup_$(date +%Y%m%d_%H%M%S)

# Run migration
npm run migrate
```

**Check it worked**:

```bash
# Check table structure
sqlite3 data/data.db "PRAGMA table_info(review_action);"

# Count rows (should match old table)
sqlite3 data/data.db "SELECT COUNT(*) FROM review_action;"

# Check relationships
sqlite3 data/data.db "PRAGMA foreign_key_check(action_log);"
```

**If something breaks**:

```bash
systemctl stop pawtropolis
cp data/data.db.backup_<timestamp> data/data.db
systemctl start pawtropolis
```

---

### 3. Sentry Permission Error

**Error**:

```
[Sentry] Failed to send event: 403 Forbidden
```

**When this happens**:

- Bot starts up
- Errors get logged
- Performance tracking runs

**Possible causes**:

- Wrong DSN (project, org, or key)
- DSN expired or disabled
- No permission to the project
- Rate limited (rare)

**Check the DSN**:

```bash
# Check format
echo $SENTRY_DSN

# Test it
curl -X POST "https://o<org>.ingest.sentry.io/api/<project>/store/" \
  -H "X-Sentry-Auth: Sentry sentry_key=<key>, sentry_version=7" \
  -H "Content-Type: application/json" \
  -d '{"message":"test","level":"info"}'

# Check Sentry settings
# Go to: https://sentry.io/settings/[org]/projects/[project]/keys/
```

**Fix**:

```bash
# Option 1: Get new DSN
# Settings → Projects → Client Keys → Create New Key

# Update .env
SENTRY_DSN=https://<new_key>@o<org>.ingest.sentry.io/<project>

# Restart
systemctl restart pawtropolis

# Option 2: Turn off Sentry
SENTRY_DSN=
```

**Test it**:

```bash
# Run command in Discord
/health

# Check for errors in Sentry dashboard
```

---

### 4. Logging Not Working

**Problem**:

- `/accept` or `/reject` works
- Action saved to database
- No message in logging channel

**Possible causes**:

1. `logging_channel_id` missing from database
2. Environment variable not set
3. Bot can't send messages in logging channel
4. Code not calling the logging function

**Check what's wrong**:

```bash
# Check database
sqlite3 data/data.db "SELECT logging_channel_id FROM configs WHERE guild_id='<GUILD_ID>';"

# Check environment variable
echo $LOGGING_CHANNEL

# Check bot permissions
# Discord: Server Settings → Roles → Bot → Logging Channel
# Needs: Send Messages, Embed Links

# Check logs
journalctl -u pawtropolis -n 100 | grep -i "logging\|card\|embed"
```

**Quick fix**:

Add the column (see error #1 above) or use environment variable:

```typescript
// Use env var instead (src/features/logger.ts)
function getLoggingChannel(guildId: string): TextChannel | null {
  const channelId = process.env.LOGGING_CHANNEL;
  if (!channelId) {
    console.warn("No logging channel set");
    return null;
  }
  // ... rest
}
```

**Test it**:

```bash
# Try accepting something
/accept app_id:123 reason:Test

# Check logging channel for message

# Check database
sqlite3 data/data.db "SELECT * FROM action_log WHERE app_id=123 AND action='accept';"
```

---

### 5. Cannot Close Modmail Threads

**Error**:

```
DiscordAPIError[50013]: Missing Permissions
```

**When this happens**:

- Running `/modmail close`
- Threads stay open instead of archiving

**Cause**: Bot needs Manage Threads permission.

**Fix**:

```bash
# Give bot permission
# Discord: Modmail Channel → Edit → Permissions
# Bot Role → Enable "Manage Threads"
```

Add a startup check:

```typescript
// src/index.ts
const modmailChannel = guild.channels.cache.get(MODMAIL_CHANNEL_ID) as TextChannel;
const botPerms = modmailChannel.permissionsFor(guild.members.me);

if (!botPerms.has(PermissionFlagsBits.ManageThreads)) {
  console.error("Missing ManageThreads permission!");
  process.exit(1);
}
```

**Test it**:

```bash
# Close a thread
/modmail close

# Check it's archived (greyed out in Discord)

# Check database
sqlite3 data/data.db "SELECT status, closed_at FROM open_modmail WHERE thread_id='<THREAD_ID>';"
```

**Fix stuck threads**:

```bash
# Run sync script
npm run sync-threads
```

---

### 6. Commands Not Showing Up

**Problem**:

- Commands registered successfully
- Don't see commands when typing `/` in Discord

**Possible causes**:

1. Discord cache (can take up to 1 hour)
2. Command disabled in Server Settings → Integrations
3. Bot missing `applications.commands` permission
4. Command restricted to certain roles

**Check registration**:

```bash
# Check guild commands
curl -H "Authorization: Bot $DISCORD_TOKEN" \
  "https://discord.com/api/v10/applications/$CLIENT_ID/guilds/$GUILD_ID/commands"

# Check global commands (should be empty)
curl -H "Authorization: Bot $DISCORD_TOKEN" \
  "https://discord.com/api/v10/applications/$CLIENT_ID/commands"

# Check Discord settings
# Server Settings → Integrations → Bot
```

**Fix**:

```bash
# Clear and re-register
npm run commands:clear
npm run commands

# Check bot permissions
# Bot invite URL needs: bot + applications.commands

# Check channel settings
# Channel Settings → Integrations → Bot
```

**Test**:

```bash
# Type / in Discord and look for your commands

# Try one
/health
```

---

## Diagnostic Commands

### Check Database

```bash
# Check if database is OK
sqlite3 data/data.db "PRAGMA integrity_check;"

# Check for broken relationships
sqlite3 data/data.db "PRAGMA foreign_key_check;"

# Count rows
sqlite3 data/data.db "
SELECT
  (SELECT COUNT(*) FROM review_action) as reviews,
  (SELECT COUNT(*) FROM action_log) as actions,
  (SELECT COUNT(*) FROM open_modmail) as modmail;
"

# Check file size
ls -lh data/data.db
```

### Check Discord Connection

```bash
# Check bot
curl -H "Authorization: Bot $DISCORD_TOKEN" \
  "https://discord.com/api/v10/users/@me"

# Check guild
curl -H "Authorization: Bot $DISCORD_TOKEN" \
  "https://discord.com/api/v10/guilds/$GUILD_ID"

# Check permissions
curl -H "Authorization: Bot $DISCORD_TOKEN" \
  "https://discord.com/api/v10/guilds/$GUILD_ID/members/@me"
```

### Check Logs

```bash
# Recent errors
journalctl -u pawtropolis --since "1 hour ago" -p err

# Count errors
journalctl -u pawtropolis --since "24 hours ago" -o json | \
  jq -r 'select(.MESSAGE | contains("Error")) | .MESSAGE' | \
  sort | uniq -c | sort -rn

# Find slow operations
journalctl -u pawtropolis --since "1 hour ago" | \
  grep -E "took [0-9]{4,}ms"

# Permission errors
journalctl -u pawtropolis --since "24 hours ago" | \
  grep -i "50013\|permission\|forbidden"
```

## Re-register Commands

Do this when:
- You added a new command
- You changed command options
- Commands don't show up in Discord

**Steps**:

```bash
# Clear old commands (optional)
npm run commands:clear

# Register commands
npm run commands

# Wait a few seconds
sleep 5

# Test in Discord
/health
```

## Fix Stuck Review Cards

**Problem**: Card shows "Claimed by @User" but they unclaimed it.

**Fix**:

```bash
# Find the application
sqlite3 data/data.db "SELECT id, claimed_by FROM review_action WHERE user_id='<USER_ID>';"

# Clear the claim
sqlite3 data/data.db "UPDATE review_action SET claimed_by=NULL, claimed_at=NULL WHERE id=<APP_ID>;"

# Manually edit the Discord message
```

## Check Logging Setup

```bash
# Check database
sqlite3 data/data.db "SELECT guild_id, logging_channel_id FROM configs;"

# Check environment
echo $LOGGING_CHANNEL

# Check bot can send messages
# Channel Settings → Permissions → Bot
# Needs: Send Messages, Embed Links
```

## Test After Deployment

Run these tests after deploying:

1. `/health` - Check bot is running
2. `/gate` - Submit test application
3. Click claim button - Should show "Claimed by @You"
4. `/accept <id> reason:Test` - Should send DM
5. DM bot - Should create modmail thread
6. Reply in thread - User should get DM
7. `/modmail close` - Thread should archive
8. `/modstats mode:leaderboard days:7` - Show stats
9. `/config get logging` - Show channel
10. Check logging channel - Messages appear
