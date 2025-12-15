# Modmail System

## Ticket Lifecycle Overview

The Modmail system creates persistent threads for each user who DMs the bot. Messages are mirrored bidirectionally between the user's DMs and a private staff thread in the designated modmail channel.

### Lifecycle States

```
[New DM] → [Thread Created] → [Active Conversation] → [Closed] → [Reopened] (optional)
```

| State               | Database Status | Thread State     | Actions Available       |
| ------------------- | --------------- | ---------------- | ----------------------- |
| New DM              | _(none)_        | _(no thread)_    | Create thread           |
| Thread Created      | `open`          | Active, unlocked | Mirror messages, close  |
| Active Conversation | `open`          | Active, unlocked | Mirror messages, close  |
| Closed              | `closed`        | Archived, locked | Reopen, view transcript |
| Reopened            | `open`          | Active, unlocked | Mirror messages, close  |

## Thread Creation and Message Routing

### Inbound: User DMs Bot

```typescript
client.on("messageCreate", async (message) => {
  // Filter: only DMs from users (not bots)
  if (message.channel.type !== ChannelType.DM) return;
  if (message.author.bot) return;

  const userId = message.author.id;

  // Check for existing open thread
  let ticket = db
    .prepare(
      `
    SELECT thread_id FROM open_modmail
    WHERE user_id = ? AND status = 'open'
  `
    )
    .get(userId);

  if (!ticket) {
    // Create new thread
    const config = db
      .prepare("SELECT modmail_channel_id FROM configs WHERE guild_id = ?")
      .get(GUILD_ID);
    const modmailChannel = client.channels.cache.get(config.modmail_channel_id) as TextChannel;

    const thread = await modmailChannel.threads.create({
      name: `${message.author.tag} (${message.author.id})`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      type: ChannelType.PublicThread,
      reason: "New modmail ticket",
    });

    // Insert into DB
    db.prepare(
      `
      INSERT INTO open_modmail (thread_id, user_id, status, created_at)
      VALUES (?, ?, 'open', ?)
    `
    ).run(thread.id, userId, new Date().toISOString());

    // Post initial message
    const initEmbed = new EmbedBuilder()
      .setTitle("New Modmail Ticket")
      .setDescription(`User: <@${userId}>\nUser ID: ${userId}`)
      .setColor(0x3498db)
      .setThumbnail(message.author.displayAvatarURL())
      .setTimestamp();

    await thread.send({ embeds: [initEmbed] });

    ticket = { thread_id: thread.id };
  }

  // Mirror user message to thread
  const threadChannel = client.channels.cache.get(ticket.thread_id) as ThreadChannel;
  const messageEmbed = new EmbedBuilder()
    .setAuthor({
      name: message.author.tag,
      iconURL: message.author.displayAvatarURL(),
    })
    .setDescription(message.content || "*[No text content]*")
    .setColor(0x3498db)
    .setTimestamp(message.createdAt);

  // Include attachments
  if (message.attachments.size > 0) {
    const attachmentUrls = message.attachments.map((a) => a.url).join("\n");
    messageEmbed.addFields({ name: "Attachments", value: attachmentUrls });
  }

  await threadChannel.send({ embeds: [messageEmbed] });
  console.log(`[Modmail] Routed DM from ${userId} → thread ${ticket.thread_id}`);
});
```

### Outbound: Staff Replies in Thread

```typescript
client.on("messageCreate", async (message) => {
  // Filter: only messages in modmail threads
  if (message.channel.type !== ChannelType.PublicThread) return;
  if (message.author.bot) return;

  const config = db
    .prepare("SELECT modmail_channel_id FROM configs WHERE guild_id = ?")
    .get(message.guildId);
  if (message.channel.parentId !== config.modmail_channel_id) return;

  // Lookup ticket
  const ticket = db
    .prepare(
      `
    SELECT user_id, status FROM open_modmail
    WHERE thread_id = ?
  `
    )
    .get(message.channel.id);

  if (!ticket || ticket.status === "closed") {
    // Ignore messages in closed threads (staff discussion)
    return;
  }

  try {
    const user = await client.users.fetch(ticket.user_id);

    // Send plain message to user DM
    await user.send(message.content);

    // Confirm delivery in thread
    await message.react("✅");
    console.log(`[Modmail] Routed thread ${message.channel.id} → DM ${ticket.user_id}`);
  } catch (error) {
    if (error.code === 50007) {
      // Cannot send DM (user blocked bot or left guild)
      await message.reply("⚠️ Cannot send DM: User has DMs disabled or blocked the bot.");
    } else {
      throw error;
    }
  }
});
```

## Thread Permissions Requirements

### Required Bot Permissions in Modmail Channel

| Permission              | Purpose                         | Failure Mode                       |
| ----------------------- | ------------------------------- | ---------------------------------- |
| `ViewChannel`           | See modmail channel and threads | Cannot access threads at all       |
| `SendMessages`          | Post initial ticket message     | Thread creation fails              |
| `SendMessagesInThreads` | Mirror user DMs into threads    | **Error 50013** (Permission 50013) |
| `CreatePublicThreads`   | Create new threads for tickets  | New tickets fail to open           |
| `ManageThreads`         | Archive/lock threads on close   | Close operation fails              |
| `EmbedLinks`            | Rich user message embeds        | Embeds not displayed               |

### Known Issue: Permission 50013

**Error**:

```
DiscordAPIError[50013]: Missing Permissions
  at SequentialHandler.runRequest (discord.js/rest)
```

**Cause**: Bot lacks `SendMessagesInThreads` permission in modmail channel.

**Fix**:

```typescript
// Startup check
const modmailChannel = guild.channels.cache.get(MODMAIL_CHANNEL_ID) as TextChannel;
const botPerms = modmailChannel.permissionsFor(guild.members.me);

if (!botPerms.has(PermissionFlagsBits.SendMessagesInThreads)) {
  console.error("❌ Missing SendMessagesInThreads in modmail channel!");
  console.error("   Grant permission in channel settings → Permissions → Bot Role");
  process.exit(1); // Fail fast to force fix
}
```

## Close and Reopen Operations

### Close Thread (`/modmail close`)

```typescript
async function closeModmailThread(threadId: string, moderatorId: string): Promise<void> {
  const ticket = db
    .prepare(
      `
    SELECT user_id, status FROM open_modmail
    WHERE thread_id = ?
  `
    )
    .get(threadId);

  if (!ticket || ticket.status === "closed") {
    throw new Error("Ticket not found or already closed.");
  }

  // Update DB
  db.prepare(
    `
    UPDATE open_modmail
    SET status = 'closed', closed_at = ?, closed_by = ?
    WHERE thread_id = ?
  `
  ).run(new Date().toISOString(), moderatorId, threadId);

  // Archive and lock thread
  const thread = client.channels.cache.get(threadId) as ThreadChannel;

  try {
    await thread.setArchived(true);
    await thread.setLocked(true);
  } catch (error) {
    if (error.code === 50013) {
      console.error("[Modmail] Cannot archive thread: Missing ManageThreads permission");
      // [Known Issue] Thread not deleted/archived due to permission 50013
    } else {
      throw error;
    }
  }

  // Notify user
  const user = await client.users.fetch(ticket.user_id);
  try {
    await user.send("Your support conversation has been closed. Reply to this DM to reopen.");
  } catch (error) {
    if (error.code !== 50007) throw error; // Ignore "Cannot DM user"
  }

  // Log action
  db.prepare(
    `
    INSERT INTO action_log (thread_id, moderator_id, action, timestamp)
    VALUES (?, ?, 'modmail_close', ?)
  `
  ).run(threadId, moderatorId, new Date().toISOString());

  await logAction("modmail_close", null, moderatorId, { threadId, userId: ticket.user_id });

  console.log(`[Modmail] Closed thread ${threadId} by moderator ${moderatorId}`);
}
```

### Reopen Thread (User DMs After Close)

```typescript
// In messageCreate handler (user DM)
const closedTicket = db
  .prepare(
    `
  SELECT thread_id FROM open_modmail
  WHERE user_id = ? AND status = 'closed'
  ORDER BY closed_at DESC
  LIMIT 1
`
  )
  .get(userId);

if (closedTicket) {
  // Reopen existing thread
  const thread = client.channels.cache.get(closedTicket.thread_id) as ThreadChannel;

  await thread.setArchived(false);
  await thread.setLocked(false);

  db.prepare(
    `
    UPDATE open_modmail
    SET status = 'open', reopened_at = ?
    WHERE thread_id = ?
  `
  ).run(new Date().toISOString(), closedTicket.thread_id);

  await thread.send(`🔄 **Thread Reopened** by <@${userId}>`);

  await logAction("modmail_reopen", null, userId, { threadId: closedTicket.thread_id });
}
```

### Manual Reopen (`/modmail reopen`)

```typescript
async function reopenModmailThread(threadId: string, moderatorId: string): Promise<void> {
  const ticket = db
    .prepare(
      `
    SELECT user_id FROM open_modmail
    WHERE thread_id = ? AND status = 'closed'
  `
    )
    .get(threadId);

  if (!ticket) {
    throw new Error("Ticket not found or not closed.");
  }

  const thread = client.channels.cache.get(threadId) as ThreadChannel;
  await thread.setArchived(false);
  await thread.setLocked(false);

  db.prepare(
    `
    UPDATE open_modmail
    SET status = 'open', reopened_at = ?
    WHERE thread_id = ?
  `
  ).run(new Date().toISOString(), threadId);

  await thread.send(`🔄 **Thread Reopened** by <@${moderatorId}>`);

  await logAction("modmail_reopen", null, moderatorId, { threadId, userId: ticket.user_id });
}
```

## Auto-Close and Cleanup

### Auto-Archive After Inactivity

**Strategy**: Close threads with no new messages for 7 days.

```typescript
// Scheduled job (run daily)
async function autoCloseInactiveThreads(): Promise<void> {
  const inactiveThreads = db
    .prepare(
      `
    SELECT thread_id, user_id
    FROM open_modmail
    WHERE status = 'open'
      AND datetime(created_at) < datetime('now', '-7 days')
      AND thread_id NOT IN (
        SELECT DISTINCT thread_id FROM action_log
        WHERE action = 'message_sent'
          AND timestamp > datetime('now', '-7 days')
      )
  `
    )
    .all();

  for (const ticket of inactiveThreads) {
    try {
      await closeModmailThread(ticket.thread_id, "0"); // System close
      console.log(`[AutoClose] Closed inactive thread ${ticket.thread_id}`);
    } catch (error) {
      console.error(`[AutoClose] Failed to close ${ticket.thread_id}:`, error);
    }
  }
}
```

### Cleanup Orphaned Threads

**Problem**: Threads deleted manually in Discord but still `open` in DB.

```typescript
async function cleanupOrphanedThreads(): Promise<void> {
  const allTickets = db.prepare('SELECT thread_id FROM open_modmail WHERE status = "open"').all();

  for (const ticket of allTickets) {
    try {
      await client.channels.fetch(ticket.thread_id);
    } catch (error) {
      if (error.code === 10003) {
        // Unknown Channel
        console.warn(`[Cleanup] Orphaned thread ${ticket.thread_id}; marking closed`);
        db.prepare('UPDATE open_modmail SET status = "closed" WHERE thread_id = ?').run(
          ticket.thread_id
        );
      }
    }
  }
}
```

## Transcripts

### Generate Transcript on Close

```typescript
async function generateTranscript(threadId: string): Promise<string> {
  const thread = client.channels.cache.get(threadId) as ThreadChannel;
  const messages = await thread.messages.fetch({ limit: 100 });

  const lines = messages
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((msg) => {
      const timestamp = new Date(msg.createdTimestamp).toISOString();
      return `[${timestamp}] ${msg.author.tag}: ${msg.content}`;
    });

  return lines.join("\n");
}

// Save to DB or upload to file host
async function saveTranscript(threadId: string, content: string): Promise<void> {
  // Option 1: Store in DB (TEXT column)
  db.prepare("UPDATE open_modmail SET transcript = ? WHERE thread_id = ?").run(content, threadId);

  // Option 2: Upload to file host and store URL
  // const url = await uploadToS3(content);
  // db.prepare('UPDATE open_modmail SET transcript_url = ? WHERE thread_id = ?')
  //   .run(url, threadId);
}
```

### View Transcript

```typescript
// /modmail transcript <thread_id>
const ticket = db.prepare("SELECT transcript FROM open_modmail WHERE thread_id = ?").get(threadId);

if (!ticket?.transcript) {
  return interaction.reply({ content: "No transcript available.", ephemeral: true });
}

// Send as file attachment (Discord limit: 2000 chars per message)
const buffer = Buffer.from(ticket.transcript, "utf-8");
await interaction.reply({
  content: `Transcript for thread ${threadId}:`,
  files: [{ attachment: buffer, name: `transcript_${threadId}.txt` }],
  ephemeral: true,
});
```

## Known Failures and Retry Strategy

### Permission 50013 Recovery

**Scenario**: Thread creation succeeds, but sending initial message fails.

```typescript
try {
  const thread = await modmailChannel.threads.create({ ... });
  await thread.send({ embeds: [initEmbed] });
} catch (error) {
  if (error.code === 50013) {
    // Permission error; clean up thread
    await thread.delete();
    db.prepare('DELETE FROM open_modmail WHERE thread_id = ?').run(thread.id);

    // Notify user via DM
    await message.author.send('⚠️ Unable to create support ticket. Please contact server admin.');

    // Alert admin channel
    const adminChannel = client.channels.cache.get(ADMIN_CHANNEL_ID) as TextChannel;
    await adminChannel.send(`❌ Modmail thread creation failed: Missing permissions in <#${modmailChannel.id}>`);
  }
  throw error;
}
```

### DM Send Retry (User Blocked Bot)

```typescript
async function sendDMWithRetry(userId: string, content: string, maxRetries = 3): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const user = await client.users.fetch(userId);
      await user.send(content);
      return true;
    } catch (error) {
      if (error.code === 50007) {
        console.warn(`[Modmail] User ${userId} has DMs disabled; no retry.`);
        return false; // Don't retry DM blocks
      }
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2s
    }
  }
  return false;
}
```

### Compensation Strategy (Thread Not Archived)

**Problem**: `/modmail close` updates DB but thread archive fails (50013).

**Compensation**:

```typescript
// Scheduled job: sync DB state with Discord state
async function syncThreadStates(): Promise<void> {
  const closedTickets = db
    .prepare('SELECT thread_id FROM open_modmail WHERE status = "closed"')
    .all();

  for (const ticket of closedTickets) {
    const thread = client.channels.cache.get(ticket.thread_id) as ThreadChannel;
    if (thread && !thread.archived) {
      console.warn(`[Sync] Thread ${ticket.thread_id} marked closed but not archived; retrying...`);
      try {
        await thread.setArchived(true);
        await thread.setLocked(true);
      } catch (error) {
        console.error(`[Sync] Still cannot archive ${ticket.thread_id}:`, error);
        // Escalate to admin
      }
    }
  }
}
```

## Database Schema

```sql
CREATE TABLE open_modmail (
  thread_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'closed'
  related_app_id INTEGER,              -- FK to review_action.id (optional)
  created_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by TEXT,                      -- Moderator ID or '0' for auto-close
  reopened_at TEXT,
  transcript TEXT,                     -- Full conversation log (optional)

  FOREIGN KEY (related_app_id) REFERENCES review_action(id) ON DELETE SET NULL
);

CREATE INDEX idx_open_modmail_user_id ON open_modmail(user_id);
CREATE INDEX idx_open_modmail_status ON open_modmail(status);
CREATE INDEX idx_open_modmail_created_at ON open_modmail(created_at);
```

## Actionable Recommendations

### Immediate Fixes

1. **Verify permissions on startup**: Check `SendMessagesInThreads` in modmail channel; exit if missing.
2. **Handle 50013 gracefully**: Delete orphaned threads and notify admins when permission errors occur.
3. **Implement retry logic**: Auto-retry DM sends (except 50007) with exponential backoff.

### Feature Enhancements

1. **Link to applications**: Auto-populate `related_app_id` when user who submitted application opens modmail.
2. **Canned responses**: `/modmail reply <template_name>` for common support answers.
3. **Tag system**: Add tags to threads (billing, technical, appeals) for categorization.

### Monitoring and Alerts

1. **Track thread volume**: Alert if >50 open threads (indicates support backlog).
2. **Measure response time**: P95 time from thread creation to first staff message.
3. **Log permission failures**: Aggregate 50013 errors and alert admin channel daily.

### Cleanup Automation

1. **Auto-close after 7 days**: Implement scheduled job (cron or Discord scheduled event).
2. **Archive old closed threads**: Delete threads closed >90 days ago (retain transcripts in DB).
3. **Purge orphaned DB rows**: Daily cleanup of threads that no longer exist in Discord.

---

## See Also

### Related Guides
- [Modmail Guide (How-To)](../how-to/modmail-guide.md) — Step-by-step usage guide
- [Gate Review Flow](gate-review-flow.md) — Application review workflow
- [Logging and ModStats](logging-and-modstats.md) — Action logging and metrics

### Reference Documentation
- [BOT-HANDBOOK.md](../../BOT-HANDBOOK.md) — Complete command reference
- [Database Schema](database-schema.md) — Full schema documentation
- [PERMS-MATRIX.md](../../PERMS-MATRIX.md) — Permission reference

### Navigation
- [Bot Handbook](../../BOT-HANDBOOK.md) — Start here for all docs
- [Troubleshooting](../operations/troubleshooting.md) — Common issues and fixes
