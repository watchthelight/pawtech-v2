# Modmail System

The modmail system creates private threads when users DM the bot. Messages go back and forth between the user's DMs and a staff thread.

## How It Works

### User DMs Bot
1. User sends DM to bot
2. Bot checks for existing open thread
3. If none exists, bot creates new thread in modmail channel
4. Bot posts user's message in thread
5. Thread includes user info (avatar, ID, username)

### Staff Replies
1. Staff types in the thread
2. Bot sends message to user's DMs
3. Bot reacts with ✅ to confirm delivery

### States

| State | What It Means | Thread Status |
|-------|---------------|---------------|
| Open | Active conversation | Unlocked, unarchived |
| Closed | Conversation ended | Locked, archived |

## Commands

**Close a thread:**
```
/modmail close thread_id:123456789
```

**Reopen a thread:**
```
/modmail reopen thread_id:123456789
```

## Required Permissions

Bot needs these permissions in modmail channel:
- View Channel
- Send Messages
- Send Messages in Threads
- Create Public Threads
- Manage Threads
- Embed Links

**Missing permissions?** You'll get Error 50013.

## What Happens on Close

1. Thread status set to "closed" in database
2. Thread archived and locked
3. User gets DM: "Your conversation has been closed"
4. Action logged to audit channel

## What Happens on Reopen

User can reopen by sending another DM, or staff can use `/modmail reopen`.

1. Thread unarchived and unlocked
2. Status set to "open" in database
3. Message posted in thread: "Thread reopened"

## Auto-Close

Bot can auto-close threads with no activity for 7 days. This requires a scheduled job.

## Common Issues

**Error 50013 (Missing Permissions)**
- Bot needs "Send Messages in Threads" permission
- Check modmail channel permissions

**User not getting DMs**
- User has DMs disabled or blocked bot
- Bot shows warning in thread
- Action still completes

**Thread not archiving**
- Bot missing "Manage Threads" permission
- Database updated but Discord not changed

## Database

Threads are stored in `open_modmail` table:

```sql
CREATE TABLE open_modmail (
  thread_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by TEXT,
  transcript TEXT
);
```

## Transcripts

When closing, bot can save full conversation to database. View with:
```
/modmail transcript thread_id:123456789
```
