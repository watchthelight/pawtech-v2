# Troubleshooting and Runbook

## Common Errors and Fixes

### 1. SQLite Error: No Such Column `logging_channel_id`

**Error Message**:

```
SqliteError: no such column: configs.logging_channel_id
    at Database.prepare (node_modules/better-sqlite3/lib/methods/wrappers.js:5:21)
    at getLoggingChannel (src/features/logger.ts:42:18)
```

**When It Occurs**:

- Running `/config set logging channel:#audit-log`
- Pretty logger trying to fetch guild logging channel from DB
- Any query referencing `configs.logging_channel_id`

**Root Cause**: Migration to add `logging_channel_id` column not yet applied.

**Fix (Immediate)**:

```bash
# Step 1: Backup database
cp data/data.db data/data.db.backup_$(date +%Y%m%d_%H%M%S)

# Step 2: Add column manually
sqlite3 data/data.db "ALTER TABLE configs ADD COLUMN logging_channel_id TEXT;"

# Step 3: Backfill with environment variable (if set)
sqlite3 data/data.db "UPDATE configs SET logging_channel_id = '$LOGGING_CHANNEL' WHERE logging_channel_id IS NULL;"

# Step 4: Verify
sqlite3 data/data.db "PRAGMA table_info(configs);" | grep logging_channel_id
# Expected: logging_channel_id|TEXT|0||0

# Step 5: Restart bot
systemctl restart pawtropolis
```

**Fix (Proper Migration)**:

```bash
# Run migration script (see 07_Database_Schema_and_Migrations.md)
npm run migrate
```

**Verification**:

```bash
# Test /config set logging
# In Discord:
/config set logging channel:#audit-log
# Expected: "Logging channel set to #audit-log"

# Verify DB update
sqlite3 data/data.db "SELECT logging_channel_id FROM configs WHERE guild_id='<GUILD_ID>';"
# Expected: <channel_id>
```

---

### 2. Legacy SQL Guard: `ALTER TABLE ... RENAME TO` Blocked

**Error Message**:

```
Error: Legacy SQL detected in prepare(): ALTER TABLE review_action RENAME TO review_action_old;
better-sqlite3 blocks this statement to prevent data loss.
    at Database.prepare (better-sqlite3)
```

**When It Occurs**:

- Running migration to rename `review_action` column to `reason`
- Any migration attempting table rename

**Root Cause**: better-sqlite3 blocks `ALTER TABLE ... RENAME TO` (table rename) to prevent accidental data loss in complex schemas.

**Fix (Safe Migration)**:
Use create-copy-swap approach (see `migrations/002_rename_review_action_to_reason.ts` in 07_Database_Schema_and_Migrations.md):

```bash
# Step 1: Backup database
cp data/data.db data/data.db.backup_$(date +%Y%m%d_%H%M%S)

# Step 2: Run migration script
npm run migrate:002

# Migration performs:
# 1. CREATE TABLE review_action_new (clean schema)
# 2. INSERT INTO new SELECT ... FROM old (copy data)
# 3. DROP TABLE old
# 4. ALTER TABLE new RENAME TO old
```

**Verification**:

```bash
# Check schema
sqlite3 data/data.db "PRAGMA table_info(review_action);"
# Should show: reason|TEXT|0||0
# Should NOT show: review_action column

# Verify data integrity
sqlite3 data/data.db "SELECT COUNT(*) FROM review_action;"
# Compare to pre-migration count (should match)

# Check foreign keys
sqlite3 data/data.db "PRAGMA foreign_key_check(action_log);"
# Expected: (empty result)
```

**Rollback (if needed)**:

```bash
# Restore backup
systemctl stop pawtropolis
cp data/data.db.backup_<timestamp> data/data.db
systemctl start pawtropolis
```

---

### 3. Sentry 403 Unauthorized

**Error Message**:

```
[Sentry] Failed to send event: 403 Forbidden
Response: {"detail":"You do not have permission to perform this action."}
```

**When It Occurs**:

- Bot startup (`Sentry.init()`)
- Capturing exceptions with `Sentry.captureException()`
- Performance traces

**Root Cause**:

- Invalid DSN (wrong project, org, or key)
- DSN revoked/expired in Sentry project settings
- Insufficient project permissions
- IP-based rate limiting (rare)

**Diagnosis**:

```bash
# Step 1: Verify DSN format
echo $SENTRY_DSN
# Expected: https://<key>@o<org>.ingest.sentry.io/<project>

# Step 2: Test DSN with curl
curl -X POST "https://o<org>.ingest.sentry.io/api/<project>/store/" \
  -H "X-Sentry-Auth: Sentry sentry_key=<key>, sentry_version=7" \
  -H "Content-Type: application/json" \
  -d '{"message":"test","level":"info"}'
# Expected: 200 OK (or specific error message)

# Step 3: Check Sentry project settings
# Navigate to: https://sentry.io/settings/[org]/projects/[project]/keys/
# Verify DSN is active (not disabled or revoked)
```

**Fix**:

```bash
# Option 1: Rotate DSN in Sentry UI
# Settings → Projects → [Your Project] → Client Keys → Create New Key
# Copy new DSN

# Update .env
SENTRY_DSN=https://<new_key>@o<org>.ingest.sentry.io/<project>

# Restart bot
systemctl restart pawtropolis

# Option 2: Disable Sentry temporarily
SENTRY_DSN=  # Leave blank

# Or in code (src/telemetry/sentry.ts)
if (!process.env.SENTRY_DSN || process.env.SENTRY_DSN === 'placeholder') {
  console.warn('Sentry disabled; no DSN configured.');
  // Skip Sentry.init()
}
```

**Verification**:

```bash
# Trigger test error in Discord
/health
# Check Sentry dashboard for new event
# Navigate to: https://sentry.io/organizations/[org]/issues/
```

---

### 4. Review Decisions Not Emitting Pretty Log Cards

**Symptom**:

- `/accept` or `/reject` completes successfully
- Action logged to `action_log` table in DB
- No embed posted to logging channel

**Root Causes**:

1. `logging_channel_id` missing from configs table → query fails, returns null
2. `LOGGING_CHANNEL` env var not read (fallback code exists but never triggered)
3. Channel permissions: bot lacks `SendMessages` or `EmbedLinks` in logging channel
4. `logAction()` function not called in accept/reject handlers

**Diagnosis**:

```bash
# Step 1: Check DB config
sqlite3 data/data.db "SELECT logging_channel_id FROM configs WHERE guild_id='<GUILD_ID>';"
# If empty: column missing or not set

# Step 2: Check env var
echo $LOGGING_CHANNEL
# If empty: no fallback available

# Step 3: Check bot permissions in logging channel
# Discord: Server Settings → Roles → Bot Role → Logging Channel
# Verify: ✅ Send Messages, ✅ Embed Links

# Step 4: Check logs for errors
journalctl -u pawtropolis -n 100 | grep -i "logging\|card\|embed"
```

**Fix**:

```typescript
// Option 1: Add logging_channel_id column (permanent fix)
// See Error #1 above

// Option 2: Force env var usage (temporary workaround)
// In src/features/logger.ts
function getLoggingChannel(guildId: string): TextChannel | null {
  const channelId = process.env.LOGGING_CHANNEL; // Skip DB query
  if (!channelId) {
    console.warn("No LOGGING_CHANNEL env var set.");
    return null;
  }
  // ... rest of function
}

// Option 3: Ensure logAction() called in handlers
// In src/commands/gate.ts (accept handler)
await acceptApplication(appId, moderatorId, reason);
await logAction("accept", appId, moderatorId, reason); // ← Add if missing
```

**Verification**:

```bash
# Test accept flow
/accept app_id:123 reason:Test

# Check logging channel for new embed
# Expected: Green card with "Application Approved" title

# Check DB
sqlite3 data/data.db "SELECT * FROM action_log WHERE app_id=123 AND action='accept';"
# Expected: Row with timestamp, moderator_id, reason
```

---

### 5. Modmail Auto-Close Not Deleting/Archiving Threads (Permission 50013)

**Error Message**:

```
DiscordAPIError[50013]: Missing Permissions
    at SequentialHandler.runRequest (discord.js/rest)
    at async ThreadChannel.setArchived (discord.js)
```

**When It Occurs**:

- Running `/modmail close`
- Auto-close job archiving inactive threads
- Thread locked but still visible (not archived)

**Root Cause**: Bot lacks `ManageThreads` permission in modmail channel.

**Diagnosis**:

```bash
# Check bot permissions in modmail channel
# Discord: Server Settings → Roles → Bot Role → Modmail Channel
# Required: ✅ Manage Threads, ✅ Send Messages in Threads
```

**Fix**:

```bash
# Step 1: Grant permission
# Discord: Modmail Channel → Edit Channel → Permissions
# Add Bot Role → Enable "Manage Threads"

# Step 2: Verify permission at startup (add to src/index.ts)
```

```typescript
// src/index.ts (startup checks)
const modmailChannel = guild.channels.cache.get(MODMAIL_CHANNEL_ID) as TextChannel;
const botPerms = modmailChannel.permissionsFor(guild.members.me);

if (!botPerms.has(PermissionFlagsBits.ManageThreads)) {
  console.error("❌ Missing ManageThreads in modmail channel!");
  console.error("   Grant permission: Server Settings → Roles → Bot → Modmail Channel");
  process.exit(1); // Fail fast
}
```

**Verification**:

```bash
# Test close flow
/modmail close

# Check thread state in Discord
# Expected: Thread archived and locked (greyed out)

# Check DB
sqlite3 data/data.db "SELECT status, closed_at FROM open_modmail WHERE thread_id='<THREAD_ID>';"
# Expected: status=closed, closed_at=<timestamp>
```

**Compensation (if threads stuck open)**:

```bash
# Run sync job to retry archiving
npm run sync-threads

# Script: scripts/sync-threads.ts
const closedThreads = db.prepare('SELECT thread_id FROM open_modmail WHERE status = "closed"').all();
for (const ticket of closedThreads) {
  const thread = client.channels.cache.get(ticket.thread_id);
  if (thread && !thread.archived) {
    await thread.setArchived(true);
    await thread.setLocked(true);
  }
}
```

---

### 6. Slash Command Not Visible

**Symptom**:

- Commands registered successfully (logs show "N commands registered")
- Command doesn't appear in Discord autocomplete when typing `/`

**Possible Causes**:

1. Discord cache (1h for global commands, instant for guild commands)
2. Command disabled per-channel in Server Settings → Integrations
3. Bot missing `applications.commands` scope
4. Command permissions restrict to specific roles (user doesn't have role)

**Diagnosis**:

```bash
# Step 1: Verify registration via Discord API
curl -H "Authorization: Bot $DISCORD_TOKEN" \
  "https://discord.com/api/v10/applications/$CLIENT_ID/guilds/$GUILD_ID/commands"
# Expected: JSON array with your commands

# Step 2: Check for global commands (conflict with guild commands)
curl -H "Authorization: Bot $DISCORD_TOKEN" \
  "https://discord.com/api/v10/applications/$CLIENT_ID/commands"
# Expected: [] (empty array for guild-only bot)

# Step 3: Check Discord UI
# Server Settings → Integrations → [Bot Name]
# Verify commands enabled in target channel
```

**Fix**:

```bash
# Fix 1: Clear global commands (if accidentally registered)
npm run commands:clear-global

# Fix 2: Re-register guild commands
npm run commands

# Fix 3: Check bot invite URL includes applications.commands scope
# https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot%20applications.commands&permissions=<PERMS>

# Fix 4: Check per-channel overrides
# Discord: Channel Settings → Integrations → [Bot Name]
# Ensure commands not disabled for that channel
```

**Verification**:

```bash
# Type / in Discord
# Expected: Command autocomplete shows your commands

# Test public command
/health
# Expected: Ephemeral response with uptime stats
```

---

## Diagnostic Commands

### Database Health Check

```bash
# Check database integrity
sqlite3 data/data.db "PRAGMA integrity_check;"
# Expected: ok

# Check foreign key violations
sqlite3 data/data.db "PRAGMA foreign_key_check;"
# Expected: (empty result)

# Check table sizes
sqlite3 data/data.db "
SELECT
  name,
  (SELECT COUNT(*) FROM review_action) as review_action_rows,
  (SELECT COUNT(*) FROM action_log) as action_log_rows,
  (SELECT COUNT(*) FROM open_modmail) as open_modmail_rows;
"

# Check database file size
ls -lh data/data.db
# Expected: <50MB for typical usage
```

### Discord API Status

```bash
# Check bot connection
curl -H "Authorization: Bot $DISCORD_TOKEN" \
  "https://discord.com/api/v10/users/@me"
# Expected: JSON with bot user info

# Check guild access
curl -H "Authorization: Bot $DISCORD_TOKEN" \
  "https://discord.com/api/v10/guilds/$GUILD_ID"
# Expected: JSON with guild info

# Check bot permissions in guild
curl -H "Authorization: Bot $DISCORD_TOKEN" \
  "https://discord.com/api/v10/guilds/$GUILD_ID/members/@me"
# Expected: JSON with roles, permissions
```

### Log Analysis

```bash
# View recent errors
journalctl -u pawtropolis --since "1 hour ago" -p err

# Count error types
journalctl -u pawtropolis --since "24 hours ago" -o json | \
  jq -r 'select(.MESSAGE | contains("Error")) | .MESSAGE' | \
  sort | uniq -c | sort -rn

# Find slow operations (>1s)
journalctl -u pawtropolis --since "1 hour ago" | \
  grep -E "took [0-9]{4,}ms"

# Check for permission errors
journalctl -u pawtropolis --since "24 hours ago" | \
  grep -i "50013\|permission\|forbidden"
```

## Resync Commands

**When to Resync**:

- Added new command
- Changed command options/description
- Changed permission requirements
- Commands not appearing in Discord

**Procedure**:

```bash
# Step 1: Clear existing commands (optional, for clean slate)
npm run commands:clear

# Step 2: Re-register
npm run commands

# Step 3: Wait 5 seconds (Discord cache propagation)
sleep 5

# Step 4: Verify in Discord
# Type / and check autocomplete

# Step 5: Test command
/health
```

## Recover Stuck Review Cards

**Symptom**: Application card shows "Claimed by @User" but user unclaimed it.

**Cause**: Review card not updated after unclaim operation.

**Fix**:

```bash
# Option 1: Manual refresh via command
/admin refresh-cards

# Implementation: scripts/refresh-cards.ts
const pendingApps = db.prepare('SELECT * FROM review_action WHERE status = "pending"').all();
for (const app of pendingApps) {
  await updateReviewCardStatus(app.id, app.claimed_by ? 'claimed' : 'pending');
}
```

**Option 2: SQL Update + Manual Edit**:

```bash
# Step 1: Find app ID
sqlite3 data/data.db "SELECT id, claimed_by FROM review_action WHERE user_id='<USER_ID>';"

# Step 2: Update DB
sqlite3 data/data.db "UPDATE review_action SET claimed_by=NULL, claimed_at=NULL WHERE id=<APP_ID>;"

# Step 3: Manually edit Discord message
# Copy message link, edit embed in review channel
```

## Verify Logging Channel Configuration

```bash
# Step 1: Check DB config
sqlite3 data/data.db "SELECT guild_id, logging_channel_id FROM configs;"

# Step 2: Check env var
echo $LOGGING_CHANNEL

# Step 3: Test channel access in Discord
# Navigate to channel, check bot can see it

# Step 4: Verify bot permissions
# Channel Settings → Permissions → Bot Role
# Required: ✅ Send Messages, ✅ Embed Links

# Step 5: Test posting
/admin test-logging

# Implementation: Send test embed to logging channel
const loggingChannel = getLoggingChannel(guildId);
await loggingChannel.send({ embeds: [testEmbed] });
```

## Smoke Test Checklist

Run after every deployment:

| Step | Action                              | Expected Result                     |
| ---- | ----------------------------------- | ----------------------------------- |
| 1    | `/health`                           | Uptime reset to <1m, DB stats shown |
| 2    | `/gate` (submit test app)           | "Application submitted!" message    |
| 3    | Claim app via button                | "Claimed by @You" appears on card   |
| 4    | `/accept <id> reason:Test`          | Approval DM sent, card marked green |
| 5    | DM bot "test ticket"                | Thread created in modmail channel   |
| 6    | Reply in thread                     | User receives DM, ✅ reaction       |
| 7    | `/modmail close`                    | Thread archived, user notified      |
| 8    | `/modstats mode:leaderboard days:7` | Leaderboard table shown             |
| 9    | `/config get logging`               | Returns logging channel ID          |
| 10   | Check logging channel               | All actions have pretty cards       |

## Actionable Recommendations

### Immediate Actions

1. **Add permission checks on startup**: Validate all required permissions; exit if missing.
2. **Implement health endpoint**: HTTP `/health` returning JSON (uptime, DB stats, last event timestamp).
3. **Create diagnostic script**: `npm run diagnose` → runs all checks above, outputs report.

### Monitoring Improvements

1. **Structured logging**: Replace `console.log` with Winston/Pino (JSON format, log levels).
2. **Error aggregation**: Parse logs daily, group by error type, alert if new error appears.
3. **Alerting**: Slack/Discord webhook when critical errors occur (DB corruption, permission failures).

### Recovery Automation

1. **Auto-retry failed cards**: Queue failed logging channel posts in DB; retry on next boot.
2. **Self-healing permissions**: Bot detects missing permissions, posts alert in admin channel with fix instructions.
3. **Database repair script**: `npm run repair-db` → VACUUM, integrity check, foreign key check, report issues.
