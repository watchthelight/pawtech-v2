---
title: "Modmail System"
slug: "05_Modmail_System"
status: "active"
last_reviewed: "2025-10-30"
owner: "Pawtropolis Tech / Platform"
audience: "Moderators • Engineers • Operators"
source_of_truth: ["code", "src/features/modmail.ts", "src/index.ts"]
related:
  - "03_Slash_Commands_and_UX"
  - "04_Gate_and_Review_Flow"
  - "06_Logging_Auditing_and_ModStats"
  - "07_Database_Schema_and_Migrations"
summary: "Complete technical specification of the modmail system for private staff-applicant communication via Discord threads. Covers thread creation, bidirectional message routing, transcript logging, and thread management with full operational procedures."
---

## Purpose & Outcomes

- **Private communication**: Enable staff to communicate with applicants without exposing staff DMs or personal information
- **Bidirectional message relay**: Seamlessly forward messages between Discord threads (staff) and user DMs (applicants)
- **Audit trail**: Maintain complete transcripts of all conversations for compliance and dispute resolution
- **Thread lifecycle management**: Support opening, closing, reopening, and archiving modmail threads
- **Race-safe operations**: Prevent duplicate threads and message loops with database-level constraints
- **Privacy protection**: Shield staff identity in user DMs while maintaining accountability internally

## Scope & Boundaries

### In Scope
- Public thread creation from review cards or manual commands
- Bidirectional message routing with reply preservation
- In-memory transcript buffering and `.txt` file export
- Thread close/reopen with auto-archive and auto-delete options
- Integration with application review workflow
- Permission checking for moderators and configured roles
- Automatic thread cleanup on application decisions

### Out of Scope
- Private DM threads (system uses public threads for visibility)
- Multi-user group DMs or conference threads
- Message editing or deletion synchronization
- File attachment mirroring (images supported, other files not synchronized)
- Real-time typing indicators
- Read receipts or message status tracking

## Current State

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  Review Card (Review Channel)               │
│         [Approve] [Reject] [Ping] [Open Modmail]            │
└───────────────────────────┬─────────────────────────────────┘
                            │ Click "Open Modmail"
                            ▼
            ┌──────────────────────────────┐
            │  Permission Check            │
            │  - OWNER_IDS                 │
            │  - mod_role_ids              │
            │  - Manage Guild              │
            └────────┬─────────────────────┘
                     │
         ┌───────────▼───────────────────┐
         │  Race-Safe Ticket Creation    │
         │  1. Check open_modmail guard  │
         │  2. Create modmail_ticket     │
         │  3. Create public thread      │
         └────────┬──────────────────────┘
                  │
       ┌──────────▼─────────────┐
       │   Public Thread        │
       │   (Review Channel)     │
       └──┬──────────────────┬──┘
          │                  │
    ┌─────▼─────┐      ┌────▼──────┐
    │ Staff Msg │      │ User DM   │
    │ → User DM │      │ → Thread  │
    └───────────┘      └───────────┘
          │                  │
          └──────┬───────────┘
                 ▼
      ┌─────────────────────┐
      │ Transcript Buffer    │
      │ (In-Memory)          │
      │ ticketId → lines[]   │
      └──────┬───────────────┘
             │ On Close
             ▼
      ┌──────────────────┐
      │ Log Channel      │
      │ modmail-XXX.txt  │
      │ (Permanent)      │
      └──────────────────┘
```

### Database Schema

#### `modmail_ticket`

**Purpose**: Tracks modmail thread lifecycle and metadata.

**Schema**:
```sql
CREATE TABLE modmail_ticket (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  app_code TEXT,                      -- HEX6 code linking to application
  review_message_id TEXT,             -- Review card message ID
  thread_id TEXT,                     -- Discord thread ID
  thread_channel_id TEXT,             -- Same as thread_id (redundant for migration compat)
  log_channel_id TEXT,                -- Channel where transcript was posted
  log_message_id TEXT,                -- Message ID of transcript log
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

-- Unique index: Only one open ticket per (guild, user)
CREATE UNIQUE INDEX idx_modmail_open_unique
  ON modmail_ticket(guild_id, user_id, status)
  WHERE status = 'open';
```

**Key Queries**:
```sql
-- Find open ticket for user
SELECT * FROM modmail_ticket
WHERE guild_id = ? AND user_id = ? AND status = 'open'
ORDER BY created_at DESC LIMIT 1;

-- Find ticket by thread ID (for message routing)
SELECT * FROM modmail_ticket
WHERE thread_id = ?;

-- Find ticket by app_code (for review card integration)
SELECT * FROM modmail_ticket
WHERE guild_id = ? AND app_code = ?
ORDER BY id DESC LIMIT 1;

-- Close ticket
UPDATE modmail_ticket
SET status = 'closed', closed_at = datetime('now')
WHERE id = ?;

-- Reopen ticket
UPDATE modmail_ticket
SET status = 'open', closed_at = NULL
WHERE id = ?;
```

#### `modmail_message`

**Purpose**: Maps thread message IDs to DM message IDs for reply threading.

**Schema**:
```sql
CREATE TABLE modmail_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('to_user','to_staff')),
  thread_message_id TEXT,
  dm_message_id TEXT,
  reply_to_thread_message_id TEXT,    -- For reply preservation
  reply_to_dm_message_id TEXT,        -- For reply preservation
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(thread_message_id),
  FOREIGN KEY (ticket_id) REFERENCES modmail_ticket(id) ON DELETE CASCADE
);
```

**Key Queries**:
```sql
-- Find DM message for thread reply
SELECT dm_message_id FROM modmail_message
WHERE thread_message_id = ?;

-- Find thread message for DM reply
SELECT thread_message_id FROM modmail_message
WHERE dm_message_id = ?;

-- Insert with upsert on conflict
INSERT INTO modmail_message
  (ticket_id, direction, thread_message_id, dm_message_id, reply_to_thread_message_id, reply_to_dm_message_id)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(thread_message_id) DO UPDATE SET
  dm_message_id = COALESCE(excluded.dm_message_id, dm_message_id),
  reply_to_thread_message_id = COALESCE(excluded.reply_to_thread_message_id, reply_to_thread_message_id),
  reply_to_dm_message_id = COALESCE(excluded.reply_to_dm_message_id, reply_to_dm_message_id);
```

#### `open_modmail` (Guard Table)

**Purpose**: Race-safe deduplication for modmail thread creation.

**Schema**:
```sql
CREATE TABLE open_modmail (
  guild_id TEXT NOT NULL,
  applicant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, applicant_id)
);
```

**Why**: Prevents duplicate threads when multiple mods click "Open Modmail" simultaneously. Database-level PRIMARY KEY constraint ensures atomicity.

### In-Memory State

#### Thread Tracking Set

**File**: [src/features/modmail.ts:114](../src/features/modmail.ts#L114)

```typescript
export const OPEN_MODMAIL_THREADS = new Set<string>();
```

**Purpose**: Fast O(1) lookup to determine if a message belongs to an active modmail thread.

**Hydration**: Populated on bot startup from database:
```typescript
export async function hydrateOpenModmailThreadsOnStartup(client: Client) {
  const rows = db
    .prepare(`SELECT thread_id FROM modmail_ticket WHERE status = 'open' AND thread_id IS NOT NULL`)
    .all() as { thread_id: string }[];
  for (const row of rows) {
    OPEN_MODMAIL_THREADS.add(row.thread_id);
  }
  logger.info({ count: OPEN_MODMAIL_THREADS.size }, "[modmail] hydrated open threads");
}
```

**Lifecycle**:
- Added when thread is created
- Removed when thread is closed
- Cleared on graceful shutdown (not persisted)

#### Transcript Buffers

**File**: [src/features/modmail.ts:145](../src/features/modmail.ts#L145)

```typescript
type TranscriptLine = {
  timestamp: string; // ISO 8601 format
  author: "STAFF" | "USER";
  content: string;
};

const transcriptBuffers = new Map<number, TranscriptLine[]>();
```

**Purpose**: In-memory buffer for modmail conversation logs before flushing to `.txt` file.

**Format**:
```
[2025-10-30T12:34:56.789Z] STAFF: Hello, we need to clarify your application.
[2025-10-30T12:35:12.345Z] USER: Sure, what do you need to know?
[2025-10-30T12:36:00.123Z] STAFF: Can you explain your answer to question 3?
```

**Retention**: Cleared after successful flush to log channel on ticket close.

#### Message Forwarding Guard

**File**: [src/features/modmail.ts:755](../src/features/modmail.ts#L755)

```typescript
const forwardedMessages = new Set<string>();

export function markForwarded(messageId: string) {
  forwardedMessages.add(messageId);
  // Clean up after 5 minutes to prevent memory leak
  setTimeout(() => forwardedMessages.delete(messageId), 5 * 60 * 1000);
}
```

**Purpose**: Prevent infinite echo loops when bot forwards messages between thread and DM.

**Why Needed**: Discord fires `MessageCreate` events for bot-sent messages. Without this guard, the bot would forward its own forwards infinitely.

**TTL**: 5 minutes (300 seconds) - sufficient to prevent loops while allowing memory cleanup.

## Key Flows

### 1. Opening a Modmail Thread

**Trigger**: Moderator clicks "Open Modmail" button on review card or uses `/modmail` command.

**Entry Point**: [src/features/modmail.ts:1036](../src/features/modmail.ts#L1036) - `openPublicModmailThreadFor`

**Flow**:

```
┌────────────────────────────────────┐
│ 1. Permission Check                │
│    - OWNER_IDS                     │
│    - mod_role_ids from config      │
│    - ManageGuild permission        │
│    - reviewer_role_id              │
└────────┬───────────────────────────┘
         │ ❌ Fail → "No permission"
         ▼ ✅ Pass
┌────────────────────────────────────┐
│ 2. Fast Path: Check open_modmail  │
│    SELECT thread_id                │
│    FROM open_modmail               │
│    WHERE guild_id=? AND user=?     │
└────────┬───────────────────────────┘
         │ ✅ Found → Return existing thread link
         ▼ ❌ Not found
┌────────────────────────────────────┐
│ 3. Check Existing Open Ticket      │
│    SELECT * FROM modmail_ticket    │
│    WHERE guild=? AND user=?        │
│    AND status='open'               │
└────────┬───────────────────────────┘
         │ ✅ Found → Attempt reopen
         ▼ ❌ Not found
┌────────────────────────────────────┐
│ 4. Create New Ticket (DB)          │
│    INSERT INTO modmail_ticket      │
│    (guild, user, app_code, ...)    │
│    VALUES (?, ?, ?, ...)           │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 5. Get Review Channel              │
│    config.review_channel_id        │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 6. Create Public Thread            │
│    channel.threads.create({        │
│      name: "Modmail: UserName",    │
│      autoArchiveDuration: 1440,    │
│      type: PublicThread            │
│    })                              │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 7. Register Thread (Transaction)   │
│    db.transaction(() => {          │
│      UPDATE modmail_ticket         │
│      SET thread_id=?               │
│      INSERT INTO open_modmail      │
│      VALUES (guild, user, thread)  │
│    })                              │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 8. Update In-Memory Tracking       │
│    OPEN_MODMAIL_THREADS.add(tid)   │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 9. Configure Thread Permissions    │
│    - Add SendMessagesInThreads     │
│      to parent for mod roles       │
│    - Public threads: inherit perms │
│    - Private threads: add members  │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 10. Send Starter Embed (Thread)    │
│     - Application summary          │
│     - Q&A preview                  │
│     - Avatar scan risk             │
│     - Account age                  │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 11. Notify User (DM)               │
│     "A moderator has opened a      │
│      modmail thread for your       │
│      application."                 │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 12. Log Action (audit trail)       │
│     logActionPretty: "modmail"     │
└────────────────────────────────────┘
```

**Code Reference**:
```typescript
// File: src/features/modmail.ts:1036-1400
export async function openPublicModmailThreadFor(params: {
  interaction: ButtonInteraction | ChatInputCommandInteraction | MessageContextMenuCommandInteraction;
  userId: string;
  appCode?: string;
  reviewMessageId?: string;
  appId?: string;
}): Promise<{ success: boolean; message?: string }> {
  const { interaction, userId, appCode, reviewMessageId, appId } = params;

  // 1. Permission check
  const member = interaction.member as GuildMember | null;
  const hasPermission =
    canRunAllCommands(member, interaction.guildId) ||
    hasManageGuild(member) ||
    isReviewer(interaction.guildId, member);

  if (!hasPermission) {
    return { success: false, message: "You do not have permission for this." };
  }

  // 2-3. Fast path + existing ticket check
  const existingThreadId = db.prepare(`
    SELECT thread_id FROM open_modmail
    WHERE guild_id = ? AND applicant_id = ?
  `).get(guildId, userId);

  if (existingThreadId) {
    return {
      success: true,
      message: `Existing thread: <#${existingThreadId.thread_id}>`
    };
  }

  // 4. Create ticket
  const ticketId = createTicket({
    guildId,
    userId,
    appCode,
    reviewMessageId,
  });

  // 5-6. Create thread
  const reviewChannel = await client.channels.fetch(config.review_channel_id);
  const thread = await reviewChannel.threads.create({
    name: `Modmail: ${user.username}`,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    type: ChannelType.PublicThread,
    reason: `Modmail for ${user.tag} (app ${appCode ?? 'N/A'})`,
  });

  // 7-8. Register thread
  db.transaction(() => {
    registerModmailThreadTx({ guildId, userId, threadId: thread.id, ticketId });
    OPEN_MODMAIL_THREADS.add(thread.id);
  })();

  // 9. Configure permissions
  await ensureModsCanSpeakInThread(thread, interaction.member);

  // 10-12. Send starter, notify user, log action
  // ... (full implementation in source file)
}
```

### 2. Message Routing: Thread → User DM

**Trigger**: Staff member posts a message in the modmail thread.

**Entry Point**: [src/index.ts:1050-1150](../src/index.ts#L1050-1150) - `MessageCreate` event handler

**Flow**:

```
┌────────────────────────────────────┐
│ MessageCreate Event                │
│ - message.channel.id               │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Check if Thread is Modmail         │
│ if (OPEN_MODMAIL_THREADS.has(id))  │
└────────┬───────────────────────────┘
         │ ❌ Not modmail → ignore
         ▼ ✅ Is modmail
┌────────────────────────────────────┐
│ Fetch Ticket from DB               │
│ SELECT * FROM modmail_ticket       │
│ WHERE thread_id = ?                │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Guard: Skip if Bot/Forwarded       │
│ if (message.author.bot) return;    │
│ if (isForwarded(message.id)) ret;  │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Extract Message Content            │
│ - content (text)                   │
│ - first image attachment (URL)     │
│ - reply reference (message ID)     │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Build Privacy-Safe Embed           │
│ buildStaffToUserEmbed({            │
│   content: message.content,        │
│   guildName: "Server Name",        │
│   guildIcon: (not staff identity)  │
│ })                                 │
└────────┬───────────────────────────┘
         │ Why: Hides staff identity
         ▼     to prevent harassment
┌────────────────────────────────────┐
│ Resolve Reply Threading            │
│ if (message.reference) {           │
│   dmId = getDmIdForThreadReply()   │
│ }                                  │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Send to User DM                    │
│ user.send({                        │
│   embeds: [embed],                 │
│   reply: { messageReference: dmId }│
│ })                                 │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Mark as Forwarded (Loop Guard)     │
│ markForwarded(dmMessage.id)        │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Store Message Mapping (DB)         │
│ INSERT INTO modmail_message        │
│ (ticket_id, direction: 'to_user',  │
│  thread_message_id, dm_message_id) │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Append to Transcript Buffer        │
│ appendTranscript(ticketId,         │
│   "STAFF", message.content)        │
└────────────────────────────────────┘
```

**Code Reference**:
```typescript
// File: src/features/modmail.ts:770-875
export async function routeThreadToDm(message: Message, ticket: ModmailTicket, client: Client) {
  if (message.author.bot) return;
  if (isForwarded(message.id)) return;

  // Ignore empty messages
  if (!message.content && message.attachments.size === 0) return;

  const user = await client.users.fetch(ticket.user_id);
  const guild = message.guild;

  // Extract first image URL
  let imageUrl: string | null = null;
  for (const att of message.attachments.values()) {
    if (att.contentType?.startsWith("image/")) {
      imageUrl = att.url;
      break;
    }
  }

  // Detect reply threading
  let replyToDmMessageId: string | undefined;
  if (message.reference?.messageId) {
    const dmId = getDmIdForThreadReply(message.reference.messageId);
    if (dmId) replyToDmMessageId = dmId;
  }

  // Build embed (hides staff identity for privacy)
  const embed = buildStaffToUserEmbed({
    staffDisplayName: "(not shown to user)",
    content: message.content,
    imageUrl,
    guildName: guild.name,
    guildIconUrl: guild.iconURL({ size: 128 }),
  });

  // Send to DM
  const dmMessage = await user.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
    ...(replyToDmMessageId && {
      reply: { messageReference: replyToDmMessageId, failIfNotExists: false },
    }),
  });

  markForwarded(dmMessage.id);

  // Store mapping for reply threading
  insertModmailMessage({
    ticketId: ticket.id,
    direction: "to_user",
    threadMessageId: message.id,
    dmMessageId: dmMessage.id,
    replyToThreadMessageId: message.reference?.messageId,
    replyToDmMessageId,
  });

  // Append to transcript
  appendTranscript(ticket.id, "STAFF", message.content);
}
```

### 3. Message Routing: User DM → Thread

**Trigger**: Applicant sends a DM to the bot while a modmail ticket is open.

**Entry Point**: [src/index.ts:1050-1150](../src/index.ts#L1050-1150) - `MessageCreate` event handler (DM branch)

**Flow**:

```
┌────────────────────────────────────┐
│ MessageCreate Event (DM)           │
│ - message.channel.type = DM        │
│ - message.author = user            │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Find Open Ticket for User          │
│ SELECT * FROM modmail_ticket       │
│ WHERE user_id = ?                  │
│ AND status = 'open'                │
└────────┬───────────────────────────┘
         │ ❌ Not found → ignore
         ▼ ✅ Found
┌────────────────────────────────────┐
│ Guard: Skip if Bot/Forwarded       │
│ if (message.author.bot) return;    │
│ if (isForwarded(message.id)) ret;  │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Extract Message Content            │
│ - content (text)                   │
│ - first image attachment (URL)     │
│ - reply reference (message ID)     │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Build User Embed                   │
│ buildUserToStaffEmbed({            │
│   userDisplayName: user.username,  │
│   userAvatarUrl: user.avatar,      │
│   content: message.content,        │
│   imageUrl                         │
│ })                                 │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Resolve Reply Threading            │
│ if (message.reference) {           │
│   threadId = getThreadIdForDm()    │
│ }                                  │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Send to Thread                     │
│ thread.send({                      │
│   embeds: [embed],                 │
│   reply: { messageReference: tid } │
│ })                                 │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Mark as Forwarded (Loop Guard)     │
│ markForwarded(threadMessage.id)    │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Store Message Mapping (DB)         │
│ INSERT INTO modmail_message        │
│ (ticket_id, direction: 'to_staff', │
│  thread_message_id, dm_message_id) │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Append to Transcript Buffer        │
│ appendTranscript(ticketId,         │
│   "USER", message.content)         │
└────────────────────────────────────┘
```

**Code Reference**:
```typescript
// File: src/features/modmail.ts:880-971
export async function routeDmToThread(message: Message, ticket: ModmailTicket, client: Client) {
  if (message.author.bot) return;
  if (isForwarded(message.id)) return;

  if (!message.content && message.attachments.size === 0) return;

  if (!ticket.thread_id) {
    logger.warn({ ticketId: ticket.id }, "[modmail] no thread_id for DM routing");
    return;
  }

  const channel = await client.channels.fetch(ticket.thread_id);
  if (!channel || !channel.isThread()) return;
  const thread = channel as ThreadChannel;

  // Detect reply threading
  let replyToThreadMessageId: string | undefined;
  if (message.reference?.messageId) {
    const threadId = getThreadIdForDmReply(message.reference.messageId);
    if (threadId) replyToThreadMessageId = threadId;
  }

  // Extract image
  let imageUrl: string | null = null;
  for (const att of message.attachments.values()) {
    if (att.contentType?.startsWith("image/")) {
      imageUrl = att.url;
      break;
    }
  }

  // Build embed
  const embed = buildUserToStaffEmbed({
    userDisplayName: message.author.globalName ?? message.author.username,
    userAvatarUrl: message.author.displayAvatarURL({ size: 128 }),
    content: message.content,
    imageUrl,
  });

  // Send to thread
  const threadMessage = await thread.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
    ...(replyToThreadMessageId && {
      reply: { messageReference: replyToThreadMessageId, failIfNotExists: false },
    }),
  });

  markForwarded(threadMessage.id);

  insertModmailMessage({
    ticketId: ticket.id,
    direction: "to_staff",
    threadMessageId: threadMessage.id,
    dmMessageId: message.id,
    replyToThreadMessageId,
    replyToDmMessageId: message.reference?.messageId,
  });

  appendTranscript(ticket.id, "USER", message.content);
}
```

### 4. Closing a Modmail Thread

**Triggers**:
1. Manual: `/modmail close` command or "Close Modmail" button
2. Automatic: Application approved/rejected/kicked (auto-close)

**Entry Point**: [src/features/modmail.ts:1650-1850](../src/features/modmail.ts#L1650-1850) - `closeModmailTicket`

**Flow**:

```
┌────────────────────────────────────┐
│ Close Request                      │
│ - Manual: /modmail close           │
│ - Auto: Approve/Reject/Kick        │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Fetch Ticket                       │
│ SELECT * FROM modmail_ticket       │
│ WHERE id = ? OR thread_id = ?      │
└────────┬───────────────────────────┘
         │ ❌ Not found → error
         ▼ ✅ Found
┌────────────────────────────────────┐
│ Check Status                       │
│ if (status === 'closed')           │
│   return "Already closed"          │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Phase A: Post Close Message        │
│ thread.send({                      │
│   content: "Closing modmail..."    │
│ })                                 │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Phase B: Flush Transcript          │
│ 1. Get transcript buffer           │
│ 2. Format as plain text            │
│ 3. Create .txt attachment          │
│ 4. Post to log channel             │
│ 5. Store log_message_id            │
└────────┬───────────────────────────┘
         │ Transcript format:
         │ [2025-10-30T12:34:56.789Z] STAFF: Hello
         │ [2025-10-30T12:35:12.345Z] USER: Hi
         ▼
┌────────────────────────────────────┐
│ Phase C: Update Database           │
│ UPDATE modmail_ticket              │
│ SET status='closed',               │
│     closed_at=datetime('now'),     │
│     log_channel_id=?,              │
│     log_message_id=?               │
│ WHERE id=?                         │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Phase D: Archive/Delete Thread     │
│ Config: modmail_delete_on_close    │
│   true → thread.delete()           │
│   false → thread.setArchived(true) │
│           thread.setLocked(true)   │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Phase E: Cleanup In-Memory State   │
│ OPEN_MODMAIL_THREADS.delete(id)    │
│ transcriptBuffers.delete(ticketId) │
│ DELETE FROM open_modmail           │
│ WHERE guild=? AND user=?           │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Phase F: Notify User (DM)          │
│ user.send({                        │
│   content: "Modmail closed."       │
│ })                                 │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Phase G: Log Action                │
│ logActionPretty({                  │
│   action: "modmail_close",         │
│   metadata: {                      │
│     transcriptLines: N,            │
│     archive: "delete|archive"      │
│   }                                │
│ })                                 │
└────────────────────────────────────┘
```

**Code Reference**:
```typescript
// File: src/features/modmail.ts:1650-1850
export async function closeModmailTicket(params: {
  interaction: ButtonInteraction | ChatInputCommandInteraction;
  ticketId?: number;
  threadId?: string;
}): Promise<{ success: boolean; message?: string }> {
  const { interaction, ticketId, threadId } = params;

  // Fetch ticket
  const ticket = ticketId
    ? getTicketById(ticketId)
    : getTicketByThread(threadId!);

  if (!ticket) {
    return { success: false, message: "No modmail ticket found." };
  }

  if (ticket.status === "closed") {
    return { success: false, message: "This ticket is already closed." };
  }

  // PHASE A: Post close message in thread
  if (ticket.thread_id) {
    const thread = await client.channels.fetch(ticket.thread_id);
    if (thread?.isThread()) {
      await thread.send({
        content: "📭 **Modmail Closed** — This thread has been closed by staff.",
        allowedMentions: { parse: [] },
      });
    }
  }

  // PHASE B: Flush transcript to log channel
  let logMessageId: string | null = null;
  if (interaction.guildId) {
    logMessageId = await flushTranscript({
      client: interaction.client,
      ticketId: ticket.id,
      guildId: interaction.guildId,
      userId: ticket.user_id,
      appCode: ticket.app_code,
    });
  }

  // PHASE C: Update database
  closeTicket(ticket.id);

  if (logMessageId) {
    const config = getConfig(interaction.guildId!);
    db.prepare(`
      UPDATE modmail_ticket
      SET log_channel_id = ?, log_message_id = ?
      WHERE id = ?
    `).run(config?.modmail_log_channel_id, logMessageId, ticket.id);
  }

  // PHASE D: Archive or delete thread
  const config = getConfig(interaction.guildId!);
  const preferDelete = config?.modmail_delete_on_close !== false;

  if (ticket.thread_id) {
    const thread = await client.channels.fetch(ticket.thread_id);
    if (thread?.isThread()) {
      if (preferDelete) {
        await thread.delete("Closed by decision — transcript flushed");
      } else {
        await thread.setArchived(true);
        await thread.setLocked(true);
      }
    }
  }

  // PHASE E: Cleanup in-memory state
  if (ticket.thread_id) {
    OPEN_MODMAIL_THREADS.delete(ticket.thread_id);
  }

  db.prepare(`
    DELETE FROM open_modmail
    WHERE guild_id = ? AND applicant_id = ?
  `).run(interaction.guildId, ticket.user_id);

  // PHASE F: Notify user
  try {
    const user = await client.users.fetch(ticket.user_id);
    await user.send({
      content: `Your modmail thread for **${interaction.guild?.name ?? "the server"}** has been closed by staff.`,
      allowedMentions: { parse: [] },
    });
  } catch {
    // User DMs closed or left server - best effort
  }

  // PHASE G: Log action
  const transcriptLines = transcriptBuffers.get(ticket.id)?.length ?? 0;
  await logActionPretty(interaction.guild!, {
    action: "modmail_close",
    appCode: ticket.app_code || undefined,
    metadata: {
      ticketId: ticket.id,
      transcriptLines,
      archive: preferDelete ? "delete" : "archive",
    },
  });

  return { success: true, message: "Modmail thread closed and transcript saved." };
}
```

### 5. Reopening a Closed Thread

**Trigger**: `/modmail reopen` command with user or thread ID.

**Entry Point**: [src/features/modmail.ts:1900-2000](../src/features/modmail.ts#L1900-2000) - `reopenModmailTicket`

**Flow**:

```
┌────────────────────────────────────┐
│ /modmail reopen                    │
│ - user: @User (optional)           │
│ - thread: thread_id (optional)     │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Find Most Recent Closed Ticket     │
│ SELECT * FROM modmail_ticket       │
│ WHERE guild=? AND user=?           │
│ AND status='closed'                │
│ ORDER BY closed_at DESC LIMIT 1    │
└────────┬───────────────────────────┘
         │ ❌ Not found → error
         ▼ ✅ Found
┌────────────────────────────────────┐
│ Check Already Open                 │
│ if (status === 'open')             │
│   return "Already open"            │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Reopen in Database                 │
│ UPDATE modmail_ticket              │
│ SET status='open',                 │
│     closed_at=NULL                 │
│ WHERE id=?                         │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Unlock and Unarchive Thread        │
│ thread.setArchived(false)          │
│ thread.setLocked(false)            │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Re-register in open_modmail        │
│ INSERT INTO open_modmail           │
│ (guild, user, thread, created_at)  │
│ ON CONFLICT DO UPDATE              │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Update In-Memory Tracking          │
│ OPEN_MODMAIL_THREADS.add(threadId) │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Notify User (DM)                   │
│ "Your modmail has been reopened"  │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Post Reopen Message in Thread      │
│ "🔓 Modmail Reopened by staff"    │
└────────────────────────────────────┘
```

**Code Reference**:
```typescript
// File: src/features/modmail.ts:1900-2000
export async function reopenModmailTicket(params: {
  interaction: ChatInputCommandInteraction;
  userId?: string;
  threadId?: string;
}): Promise<{ success: boolean; message?: string }> {
  const { interaction, userId, threadId } = params;

  // Find most recent closed ticket
  const ticket = userId
    ? db.prepare(`
        SELECT * FROM modmail_ticket
        WHERE guild_id = ? AND user_id = ? AND status = 'closed'
        ORDER BY closed_at DESC LIMIT 1
      `).get(interaction.guildId, userId)
    : db.prepare(`
        SELECT * FROM modmail_ticket
        WHERE thread_id = ? AND status = 'closed'
      `).get(threadId);

  if (!ticket) {
    return { success: false, message: "No closed modmail ticket found." };
  }

  if (ticket.status === "open") {
    return { success: false, message: "This ticket is already open." };
  }

  // Reopen in DB
  reopenTicket(ticket.id);

  // Unlock and unarchive thread
  if (ticket.thread_id) {
    const thread = await interaction.client.channels.fetch(ticket.thread_id);
    if (thread?.isThread()) {
      await thread.setArchived(false);
      await thread.setLocked(false);

      // Re-register in open_modmail
      db.prepare(`
        INSERT INTO open_modmail (guild_id, applicant_id, thread_id, created_at)
        VALUES (?, ?, ?, strftime('%s','now'))
        ON CONFLICT(guild_id, applicant_id) DO UPDATE SET thread_id=excluded.thread_id
      `).run(interaction.guildId, ticket.user_id, ticket.thread_id);

      OPEN_MODMAIL_THREADS.add(ticket.thread_id);
    }
  }

  // Notify user
  try {
    const user = await interaction.client.users.fetch(ticket.user_id);
    await user.send({
      content: `Your modmail thread for **${interaction.guild?.name ?? "the server"}** has been reopened by staff.`,
      allowedMentions: { parse: [] },
    });
  } catch {
    // Best effort
  }

  return { success: true, message: "Modmail thread reopened." };
}
```

## Commands & Snippets

### Slash Commands

#### `/modmail close`

**Description**: Close a modmail thread and export transcript.

**Options**:
- `thread` (optional): Thread ID to close (defaults to current thread if in one)

**Usage**:
```
/modmail close
/modmail close thread:1234567890123456789
```

**Permissions**: Moderators, Manage Guild, Owner IDs

#### `/modmail reopen`

**Description**: Reopen a previously closed modmail thread.

**Options**:
- `user` (optional): User to reopen modmail for
- `thread` (optional): Thread ID to reopen

**Usage**:
```
/modmail reopen user:@Username
/modmail reopen thread:1234567890123456789
```

**Permissions**: Moderators, Manage Guild, Owner IDs

### Button Interactions

#### `v1:modmail:open:codeABC123`

**Location**: Review card "Open Modmail" button

**Pattern**: [src/lib/modalPatterns.ts](../src/lib/modalPatterns.ts)
```typescript
export const MODMAIL_OPEN_REGEX = /^v1:modmail:open:code([0-9A-F]{6})$/i;
```

**Handler**: [src/features/review.ts](../src/features/review.ts) - Button click → `openPublicModmailThreadFor`

#### `v1:modmail:close:codeABC123`

**Location**: Review card "Close Modmail" button (appears after thread opened)

**Pattern**: `^v1:modmail:close:code([0-9A-F]{6})$`

**Handler**: [src/features/modmail.ts](../src/features/modmail.ts) - `closeModmailTicket`

### Database Queries

#### Manual Ticket Lookup

```sql
-- Find all open tickets for a guild
SELECT t.id, t.user_id, t.app_code, t.thread_id, t.created_at
FROM modmail_ticket t
WHERE t.guild_id = '{guildId}' AND t.status = 'open'
ORDER BY t.created_at DESC;

-- Find ticket history for a specific user
SELECT t.*,
  (SELECT COUNT(*) FROM modmail_message WHERE ticket_id = t.id) as message_count
FROM modmail_ticket t
WHERE t.guild_id = '{guildId}' AND t.user_id = '{userId}'
ORDER BY t.created_at DESC;

-- Find tickets with transcript logs
SELECT t.id, t.app_code, t.user_id, t.log_message_id, t.closed_at
FROM modmail_ticket t
WHERE t.guild_id = '{guildId}'
  AND t.status = 'closed'
  AND t.log_message_id IS NOT NULL
ORDER BY t.closed_at DESC
LIMIT 50;
```

#### Manual Cleanup

```sql
-- Find orphaned open_modmail entries (thread deleted but DB still has record)
SELECT om.*
FROM open_modmail om
LEFT JOIN modmail_ticket t ON om.thread_id = t.thread_id AND t.status = 'open'
WHERE t.id IS NULL;

-- Clean up orphaned entries
DELETE FROM open_modmail
WHERE guild_id = '{guildId}'
  AND applicant_id NOT IN (
    SELECT user_id FROM modmail_ticket WHERE status = 'open' AND guild_id = '{guildId}'
  );

-- Close all open tickets (emergency cleanup)
UPDATE modmail_ticket
SET status = 'closed', closed_at = datetime('now')
WHERE guild_id = '{guildId}' AND status = 'open';
```

#### Message Routing Analysis

```sql
-- Find messages without DM delivery
SELECT mm.*
FROM modmail_message mm
WHERE mm.direction = 'to_user'
  AND mm.dm_message_id IS NULL
  AND mm.ticket_id IN (
    SELECT id FROM modmail_ticket WHERE guild_id = '{guildId}'
  );

-- Count messages per ticket
SELECT t.id, t.app_code, t.user_id,
  COUNT(mm.id) as total_messages,
  SUM(CASE WHEN mm.direction = 'to_user' THEN 1 ELSE 0 END) as staff_messages,
  SUM(CASE WHEN mm.direction = 'to_staff' THEN 1 ELSE 0 END) as user_messages
FROM modmail_ticket t
LEFT JOIN modmail_message mm ON t.id = mm.ticket_id
WHERE t.guild_id = '{guildId}'
GROUP BY t.id
ORDER BY t.created_at DESC;
```

## Interfaces & Data

### Configuration

**File**: [src/lib/config.ts](../src/lib/config.ts)

```typescript
type GuildConfig = {
  modmail_log_channel_id?: string;    // Where transcripts are posted
  modmail_delete_on_close?: boolean;  // true = delete thread, false = archive
  mod_role_ids?: string;              // Comma-separated role IDs (e.g., "123,456,789")
  review_channel_id?: string;         // Where modmail threads are created
};
```

**Environment Variables**:
```bash
# None required - all config is per-guild via /config command
```

**Setting via Commands**:
```
/config set modmail_log_channel #modmail-logs
/config set modmail_delete_on_close true
/config set mod_roles @Moderator,@Admin
```

### Embed Formats

#### Staff → User Embed

**Purpose**: Hide staff identity to prevent harassment.

**Code**: [src/features/modmail.ts:664](../src/features/modmail.ts#L664)

```typescript
const embed = new EmbedBuilder()
  .setColor(0x2b2d31)
  .setDescription(content)
  .setTimestamp()
  .setFooter({
    text: guildName,          // "Pawtropolis Tech"
    iconURL: guildIconUrl     // Server icon (not staff avatar)
  })
  .setImage(imageUrl);        // First attachment if present
```

**Example**:
```
┌─────────────────────────────────────────┐
│ [Embed - Gray color]                    │
│                                         │
│ Hello! We need to clarify your         │
│ application. Can you explain your      │
│ answer to question 3?                  │
│                                         │
│ [Image if attached]                    │
│                                         │
│ Footer: Pawtropolis Tech [icon]        │
│ Timestamp: 2025-10-30 12:34 PM         │
└─────────────────────────────────────────┘
```

**Privacy Note**: User sees only server name, not individual staff member.

#### User → Staff Embed

**Purpose**: Show user identity to staff for context.

**Code**: [src/features/modmail.ts:699](../src/features/modmail.ts#L699)

```typescript
const embed = new EmbedBuilder()
  .setColor(0x5865f2)
  .setDescription(content)
  .setTimestamp()
  .setFooter({
    text: userDisplayName,    // "Username" or "Display Name"
    iconURL: userAvatarUrl    // User's avatar
  })
  .setImage(imageUrl);
```

**Example**:
```
┌─────────────────────────────────────────┐
│ [Embed - Blue color]                    │
│                                         │
│ Sure! For question 3, I meant that...  │
│ [rest of user's response]              │
│                                         │
│ [Image if attached]                    │
│                                         │
│ Footer: Username#1234 [avatar]         │
│ Timestamp: 2025-10-30 12:35 PM         │
└─────────────────────────────────────────┘
```

#### Starter Embed (Thread)

**Purpose**: Provide staff with application context when modmail opens.

**Code**: [src/features/modmail.ts:1200-1350](../src/features/modmail.ts#L1200-1350)

```typescript
const embed = new EmbedBuilder()
  .setColor(0x5865f2)
  .setTitle(`Modmail: ${user.username}`)
  .setDescription(`Application code: \`${appCode}\`\nReview: [Jump to message](reviewCardUrl)`)
  .addFields(
    { name: "User", value: `<@${userId}>`, inline: true },
    { name: "Account Age", value: accountAge, inline: true },
    { name: "Avatar Risk", value: `${riskPct}%`, inline: true }
  )
  .addFields(
    { name: "Q1: [question text]", value: "```\n[answer]\n```", inline: false },
    // ... up to 5 questions shown
  )
  .setTimestamp();
```

### External APIs

**None**: Modmail system is entirely self-contained within Discord Gateway and database.

### Discord Events Consumed

| Event | File | Purpose |
|-------|------|---------|
| `ClientReady` | [src/index.ts:180](../src/index.ts#L180) | Hydrate `OPEN_MODMAIL_THREADS` set from DB |
| `MessageCreate` | [src/index.ts:1050](../src/index.ts#L1050) | Route thread → DM and DM → thread |
| `InteractionCreate` (Button) | [src/index.ts:550](../src/index.ts#L550) | Handle "Open Modmail" button |
| `InteractionCreate` (SlashCommand) | [src/index.ts:450](../src/index.ts#L450) | Handle `/modmail` commands |

## Ops & Recovery

### Health Checks

```bash
# Check for orphaned threads (thread exists but ticket deleted)
sqlite3 data/data.db <<SQL
SELECT COUNT(*) as orphaned_count
FROM open_modmail om
WHERE NOT EXISTS (
  SELECT 1 FROM modmail_ticket t
  WHERE t.thread_id = om.thread_id AND t.status = 'open'
);
SQL

# Check for tickets with missing threads
sqlite3 data/data.db <<SQL
SELECT COUNT(*) as missing_threads
FROM modmail_ticket
WHERE status = 'open' AND thread_id IS NULL;
SQL

# Check in-memory state (must be run from bot logs)
pm2 logs pawtropolis --lines 50 | grep "modmail.*hydrated"
# Expected output: "[modmail] hydrated open threads" with count
```

### Transcript Recovery

**Scenario**: Bot crashed before flushing transcript.

**Solution**: Transcripts are in-memory only. If not flushed, they are lost. Recommend:
1. Enable verbose logging for message routing
2. Retrieve message history from Discord API
3. Manually reconstruct transcript

**Manual Transcript Export**:
```typescript
// Run in bot console or script
import { Client } from 'discord.js';
const client = new Client({ intents: [...] });
await client.login(TOKEN);

const threadId = '1234567890123456789';
const thread = await client.channels.fetch(threadId);
const messages = await thread.messages.fetch({ limit: 100 });

const transcript = messages
  .reverse()
  .map(m => `[${m.createdAt.toISOString()}] ${m.author.username}: ${m.content}`)
  .join('\n');

console.log(transcript);
```

### Common Issues

#### Issue: "Failed to create modmail thread"

**Symptoms**: Error message when clicking "Open Modmail" button.

**Causes**:
1. Bot missing permissions in review channel
2. Review channel not configured
3. Database constraint violation (duplicate open ticket)

**Fix**:
```bash
# Check bot permissions
# Required: ViewChannel, SendMessages, CreatePublicThreads, SendMessagesInThreads

# Check config
sqlite3 data/data.db "SELECT review_channel_id FROM guild_config WHERE guild_id = '{guildId}';"

# Check for duplicate open tickets
sqlite3 data/data.db <<SQL
SELECT * FROM modmail_ticket
WHERE guild_id = '{guildId}' AND user_id = '{userId}' AND status = 'open';
SQL

# Force-close duplicate tickets
sqlite3 data/data.db <<SQL
UPDATE modmail_ticket
SET status = 'closed', closed_at = datetime('now')
WHERE guild_id = '{guildId}' AND user_id = '{userId}' AND status = 'open';
SQL
```

#### Issue: Messages not routing

**Symptoms**: Staff messages not appearing in user DMs, or vice versa.

**Causes**:
1. User DMs closed
2. Thread not in `OPEN_MODMAIL_THREADS` set
3. Message already marked as forwarded (loop guard false positive)

**Fix**:
```bash
# Check if ticket is tracked
sqlite3 data/data.db <<SQL
SELECT t.id, t.thread_id, t.status
FROM modmail_ticket t
WHERE t.guild_id = '{guildId}' AND t.user_id = '{userId}';
SQL

# Restart bot to re-hydrate OPEN_MODMAIL_THREADS
pm2 restart pawtropolis

# Check bot logs for routing errors
pm2 logs pawtropolis --lines 200 | grep "modmail.*failed"
```

#### Issue: Transcript not posted to log channel

**Symptoms**: Thread closed but no `.txt` file in log channel.

**Causes**:
1. `modmail_log_channel_id` not configured
2. Bot missing Send Messages permission in log channel
3. Transcript buffer empty (no messages exchanged)

**Fix**:
```bash
# Check config
sqlite3 data/data.db "SELECT modmail_log_channel_id FROM guild_config WHERE guild_id = '{guildId}';"

# Set log channel via command
# /config set modmail_log_channel #modmail-logs

# Check permissions in log channel
# Required: ViewChannel, SendMessages, AttachFiles

# Check for empty transcripts in logs
pm2 logs pawtropolis | grep "no transcript lines"
```

### Manual Thread Cleanup

**Scenario**: Bot crashed, threads left in orphaned state.

```bash
# Find all open threads in database
sqlite3 data/data.db <<SQL
SELECT t.id, t.thread_id, t.user_id, t.app_code, t.created_at
FROM modmail_ticket t
WHERE t.guild_id = '{guildId}' AND t.status = 'open';
SQL

# Close all open tickets
sqlite3 data/data.db <<SQL
UPDATE modmail_ticket
SET status = 'closed', closed_at = datetime('now')
WHERE guild_id = '{guildId}' AND status = 'open';
SQL

# Clean up open_modmail guard table
sqlite3 data/data.db <<SQL
DELETE FROM open_modmail
WHERE guild_id = '{guildId}';
SQL

# Restart bot to reset in-memory state
pm2 restart pawtropolis
```

## Security & Privacy

### Staff Identity Protection

**Problem**: Staff members may face harassment if users know who rejected them.

**Solution**: Modmail embeds sent to users show only server name/icon, not individual staff identity.

**Implementation**:
```typescript
// File: src/features/modmail.ts:664-696
const embed = buildStaffToUserEmbed({
  staffDisplayName: "(not shown)",
  content: message.content,
  guildName: guild.name,        // "Pawtropolis Tech"
  guildIconUrl: guild.iconURL()  // Server icon, not staff avatar
});
```

**Result**: Users see messages as coming from "Pawtropolis Tech" rather than "@Moderator Name".

### Audit Trail Compliance

**Requirements**:
- All modmail conversations logged permanently
- Transcripts include timestamps, authors, and full content
- Logs posted to staff-only channel (not accessible to users)

**Implementation**:
```typescript
// File: src/features/modmail.ts:156-166
export function appendTranscript(ticketId: number, author: "STAFF" | "USER", content: string) {
  if (!transcriptBuffers.has(ticketId)) {
    transcriptBuffers.set(ticketId, []);
  }
  const buffer = transcriptBuffers.get(ticketId)!;
  buffer.push({
    timestamp: new Date().toISOString(),  // ISO 8601: "2025-10-30T12:34:56.789Z"
    author,                               // "STAFF" or "USER"
    content,                              // Plain text message content
  });
}
```

**Transcript Format**:
```
[2025-10-30T12:34:56.789Z] STAFF: Hello, we need to clarify your application.
[2025-10-30T12:35:12.345Z] USER: Sure, what do you need to know?
[2025-10-30T12:36:00.123Z] STAFF: Can you explain your answer to question 3?
[2025-10-30T12:37:45.678Z] USER: For question 3, I meant that...
```

**Retention**: Transcripts stored permanently in log channel (Discord message retention policy applies).

### Permission Isolation

**Principle**: Only authorized staff can open modmail threads.

**Checks** (in order):
1. **Owner IDs**: Environment variable `OWNER_IDS` (comma-separated user IDs)
2. **Mod Roles**: Guild config `mod_role_ids` (comma-separated role IDs)
3. **Manage Guild**: Discord permission `ManageGuild`
4. **Reviewer Role**: Guild config `reviewer_role_id`

**Code**: [src/features/modmail.ts:1045-1055](../src/features/modmail.ts#L1045-1055)
```typescript
const member = interaction.member as GuildMember | null;
const hasPermission =
  canRunAllCommands(member, interaction.guildId) ||  // OWNER_IDS + mod_role_ids
  hasManageGuild(member) ||                          // ManageGuild permission
  isReviewer(interaction.guildId, member);           // reviewer_role_id

if (!hasPermission) {
  return { success: false, message: "You do not have permission for this." };
}
```

### Data Retention

| Data Type | Retention | Deletion Policy |
|-----------|-----------|-----------------|
| Transcript buffers | Until ticket close | Cleared after flush to log channel |
| `modmail_ticket` rows | Permanent | Soft-delete only (status='closed') |
| `modmail_message` rows | Permanent | CASCADE delete when ticket deleted |
| `open_modmail` rows | Until ticket close | Deleted on close/reopen |
| `OPEN_MODMAIL_THREADS` set | Until bot restart | Cleared on shutdown |
| `forwardedMessages` set | 5 minutes | TTL cleanup via `setTimeout` |

## FAQ / Gotchas

**Q: Can I use private threads instead of public threads?**

A: The current implementation creates **public threads** by default. Public threads inherit permissions from the parent review channel, making them visible to all moderators without explicit member additions. Private threads require manual member management and are not recommended.

**Q: What happens if a user blocks the bot?**

A: Messages from staff → user DM will fail silently. The bot logs a warning and posts an error in the thread: "⚠️ Failed to deliver message to applicant (DMs may be closed)." Staff can still see user replies if the user unblocks the bot later.

**Q: Can I recover a deleted transcript?**

A: No. Transcripts are in-memory only and flushed to log channel on close. If the bot crashes before flushing, the transcript is lost. Recommendation: Enable verbose logging and reconstruct from Discord message history if critical.

**Q: How do I prevent duplicate modmail threads?**

A: The system uses a `PRIMARY KEY (guild_id, applicant_id)` constraint on `open_modmail` table. Attempting to create a second open thread for the same user will fail at the database level, returning a link to the existing thread.

**Q: Can users see who is responding to them?**

A: No. Staff identity is hidden. Users see messages as coming from the server (e.g., "Pawtropolis Tech") with the server icon, not individual staff members' names or avatars.

**Q: What happens if I delete a modmail thread manually?**

A: The database still tracks the ticket as "open". The thread will appear in `modmail_ticket` but be inaccessible. Fix:
```sql
UPDATE modmail_ticket SET status='closed', closed_at=datetime('now') WHERE thread_id='{deleted_thread_id}';
DELETE FROM open_modmail WHERE thread_id='{deleted_thread_id}';
```

**Q: How do I archive threads instead of deleting them?**

A: Set config option:
```
/config set modmail_delete_on_close false
```
This will lock and archive threads instead of deleting them on close.

**Q: Can I forward attachments other than images?**

A: No. Only the first image attachment is forwarded as an embed. PDFs, videos, and other files are not synchronized. Recommendation: Ask users to send links instead.

**Q: How long are messages kept in the forwarding guard?**

A: 5 minutes (300 seconds). This TTL prevents memory leaks while ensuring loop prevention works reliably.

**Q: Can I reopen a modmail after it's been closed?**

A: Yes. Use `/modmail reopen user:@User` to reopen the most recent closed ticket for that user. The thread will be unlocked and unarchived.

## Changelog

### 2025-10-30
- **Created**: Initial modmail system documentation with complete technical specification
- **Added**: Front-matter with metadata, related docs, and summary
- **Documented**: All 10 standard sections per project requirements
- **Cross-linked**: Related flow, database, and logging documentation
- **Verified**: All code paths, SQL queries, and file references against current repository state
- **Included**: Complete flows for thread creation, message routing, transcript logging, and thread lifecycle
- **Detailed**: Privacy protection mechanisms, permission checks, and race-safe operations
- **Provided**: Operational procedures for health checks, recovery, and manual cleanup
