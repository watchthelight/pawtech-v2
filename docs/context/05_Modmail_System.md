# 05 — Modmail System

**Last Updated:** 2025-10-22
**Status:** Production-ready with thread-based architecture

## Summary

- **Purpose:** Private support ticket system routing user DMs to moderator threads
- **Architecture:** Discord private threads + SQLite tracking
- **Bidirectional:** User DM ↔ Moderator Thread (automatic forwarding)
- **Audit Trail:** `modmail_open` and `modmail_close` actions logged

---

## Table of Contents

- [System Overview](#system-overview)
- [DM to Thread Mapping](#dm-to-thread-mapping)
- [Ticket Lifecycle](#ticket-lifecycle)
- [Message Forwarding](#message-forwarding)
- [Permissions and Privacy](#permissions-and-privacy)
- [Dashboard Integration](#dashboard-integration)

---

## System Overview

The modmail system creates a **private thread** for each support ticket, allowing moderators to communicate with users without exposing their personal Discord DMs.

**Key Benefits:**

- **Privacy:** User DMs never exposed to all moderators
- **Collaboration:** Multiple moderators can see/reply in same thread
- **History:** All conversations preserved in thread archive
- **Context:** Thread name shows user identity and ticket #

---

## DM to Thread Mapping

### Data Model

```sql
CREATE TABLE open_modmail (
  user_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  thread_id TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  opened_by_moderator TEXT
);

CREATE INDEX idx_open_modmail_thread ON open_modmail(thread_id);
CREATE INDEX idx_open_modmail_guild ON open_modmail(guild_id);
```

**Composite Key:** `user_id` (one ticket per user at a time)

### Thread Creation

```javascript
// User sends DM to bot
client.on("messageCreate", async (message) => {
  if (message.channel.type === ChannelType.DM) {
    // Check for existing ticket
    const existing = getOpenTicketByUser(message.author.id);

    if (!existing) {
      // Create private thread in modmail channel
      const thread = await modmailChannel.threads.create({
        name: `${message.author.username} (${message.author.id})`,
        type: ChannelType.PrivateThread,
        reason: "Modmail ticket opened via DM",
      });

      // Save to database
      insertOpenModmail(message.author.id, guild.id, thread.id);

      // Log action
      logAction("modmail_open", guild.id, null, message.author.id);
    }
  }
});
```

---

## Ticket Lifecycle

### 1. Open Ticket

**Trigger:** User sends DM to bot
**Flow:**

```
1. User sends DM: "Hi, I need help with verification"
   ↓
2. Bot checks for existing open ticket (query open_modmail by user_id)
   ↓
3. If none exists:
   • Create private thread in #modmail channel
   • Thread name: "Alice#1234 (123456789012345678)"
   • Add to open_modmail table
   • Log modmail_open action
   ↓
4. Forward message content to thread
   ↓
5. Send confirmation DM to user: "Ticket opened. A moderator will respond soon."
```

**Thread Embed (First Message):**

```
┌─────────────────────────────────────────────┐
│ 🎫 New Modmail Ticket                      │
│ User: Alice#1234 (ID: 123456789012345678)  │
│ Opened: 2025-10-22 03:30:15 UTC            │
├─────────────────────────────────────────────┤
│ Initial Message:                            │
│ "Hi, I need help with verification"        │
├─────────────────────────────────────────────┤
│ [Close Ticket]                             │
└─────────────────────────────────────────────┘
```

### 2. Active Conversation

**User → Thread:**

```
User sends DM: "It's been 2 hours and no response"
   ↓
Bot forwards to thread with timestamp and author context
   ↓
Thread message: "👤 Alice: It's been 2 hours and no response"
```

**Thread → User:**

```
Moderator replies in thread: "Sorry for the delay! Let me help you."
   ↓
Bot detects message in thread channel
   ↓
Forwards to user's DM: "🛡️ Staff: Sorry for the delay! Let me help you."
```

### 3. Close Ticket

**Trigger:** Moderator clicks "Close Ticket" button or uses `/modmail close @user`
**Flow:**

```
1. Moderator clicks "Close Ticket"
   ↓
2. Bot archives thread (thread.setArchived(true))
   ↓
3. Remove from open_modmail table
   ↓
4. Log modmail_close action (moderator_id, user_id, timestamp)
   ↓
5. Send DM to user: "Your ticket has been closed. Send a new message to reopen."
   ↓
6. Thread name updated: "✅ Alice#1234 (CLOSED)"
```

**Reopening:**
If user sends new DM after close, creates new ticket (fresh thread).

---

## Message Forwarding

### User DM → Moderator Thread

```javascript
async function routeDmToThread(message: Message) {
  const ticket = getOpenTicketByUser(message.author.id);

  if (!ticket) {
    // No open ticket → create one
    await handleModmailOpenButton(message);
    return;
  }

  // Forward message to thread
  const thread = await client.channels.fetch(ticket.thread_id);
  await thread.send({
    content: `👤 **${message.author.tag}**: ${message.content}`,
    files: message.attachments.map(a => a.url) // Forward attachments
  });
}
```

**Formatting:**

- User messages prefixed with 👤
- Attachments (images, files) forwarded as-is
- Embeds flattened to text (Discord limitation)
- Reactions not forwarded (one-way)

### Moderator Thread → User DM

```javascript
async function routeThreadToDm(message: Message) {
  const ticket = getTicketByThread(message.channel.id);

  if (!ticket) return; // Not a modmail thread

  // Fetch user
  const user = await client.users.fetch(ticket.user_id);

  // Forward message to user DM
  await user.send({
    content: `🛡️ **Staff**: ${message.content}`,
    files: message.attachments.map(a => a.url)
  });
}
```

**Formatting:**

- Moderator messages prefixed with 🛡️ Staff
- Moderator identity hidden (anonymous to user)
- Attachments forwarded
- Bot messages ignored (no echo loop)

### Attachment Handling

**Supported:**

- Images (PNG, JPG, GIF, WebP)
- Documents (PDF, TXT, DOCX)
- Archives (ZIP, RAR)

**Limitations:**

- Max 25 MB per file (Discord limit)
- Max 10 files per message
- Videos forwarded as links (size restrictions)

---

## Permissions and Privacy

### Required Bot Permissions

**Modmail Channel:**

- `ViewChannel` — See modmail parent channel
- `SendMessages` — Post in channel
- `CreatePrivateThreads` — Create ticket threads
- `SendMessagesInThreads` — Reply in threads
- `ManageThreads` — Archive threads on close
- `EmbedLinks` — Send formatted embeds
- `AttachFiles` — Forward attachments

**User DMs:**

- `SendMessages` — Reply to user DMs
- No special permissions needed (inherent bot capability)

### Moderator Access

**Who can see tickets:**

- Moderators with `SendMessagesInThreads` permission in parent channel
- Bot automatically adds moderators to private threads on first message

**Who can close tickets:**

- Any moderator with access to thread
- Button or `/modmail close` command

### Privacy Guarantees

**User Identity Protection:**

- Only moderators with channel access see tickets
- Private threads not visible to regular members
- User cannot see moderator names (all replies show "Staff")

**Message Security:**

- Messages never stored in plaintext by bot (Discord native storage)
- No third-party logging or external APIs
- Audit log only records open/close actions (not message content)

**Deletion:**

- Closing ticket archives thread (preserves history)
- Admins can delete thread for GDPR/privacy requests
- Database row removed on close (no persistent user tracking)

---

## Dashboard Integration

### Logs View

Modmail actions appear in admin dashboard logs:

**Open Action:**

```
┌──────────────────────────────────────────────┐
│ 🟣 Modmail Opened                           │
│ User: Alice#1234                             │
│ Opened: 2025-10-22 03:30:15 UTC             │
│ Moderator: N/A (user-initiated)             │
└──────────────────────────────────────────────┘
```

**Close Action:**

```
┌──────────────────────────────────────────────┐
│ ⚫ Modmail Closed                            │
│ User: Alice#1234                             │
│ Closed: 2025-10-22 04:15:42 UTC             │
│ Moderator: Bob#5678                          │
│ Duration: 45 minutes                         │
└──────────────────────────────────────────────┘
```

### Metrics Tracking

**Moderator Stats:**

- `modmail_opens` count incremented when moderator manually opens ticket
- Response time p50/p95 calculated for first reply in thread
- Ticket close actions tracked per moderator

**Dashboard Analytics:**

- Average ticket duration (open → close time)
- Tickets per day/week/month
- Moderator response time distribution
- Busiest hours for ticket volume

---

## Changelog

**Since last revision:**

- Added detailed DM ↔ Thread mapping architecture
- Documented ticket lifecycle (open, active, close, reopen)
- Added message forwarding implementation details
- Clarified permissions required for bot and moderators
- Added privacy guarantees section
- Documented dashboard integration for modmail actions
- Added attachment handling support and limitations
- Included database schema for `open_modmail` table
