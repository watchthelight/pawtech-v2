# Modmail System

## Overview

The Modmail system provides a private communication channel between staff and applicants via Discord private threads. It enables staff to communicate with applicants without exposing their personal DMs.

## Features

- **Private Threads**: Create private threads in the review channel for staff-applicant communication
- **Bidirectional Routing**: Messages automatically route between the thread and the applicant's DMs
- **Thread Management**: Open, close, and reopen threads with proper status tracking
- **Review Card Integration**: Modmail button appears on review cards when claimed
- **Status Display**: Review cards show current modmail status (Open/Closed with thread link)

## Flow

### Opening Modmail

1. **Via Review Card Button**:
   - Claim an application first
   - Click the "Modmail" button on the review card
   - A private thread is created in the review channel
   - The moderator who clicked is automatically added to the thread
   - The applicant receives a DM notification

2. **Via Context Menu**:
   - Right-click on a review card message
   - Select "Modmail: Open" from the context menu
   - Same flow as button

3. **Thread Contents**:
   - Starter embed with applicant info:
     - Applicant tag and mention
     - Application code (hex6)
     - Account creation date
     - Avatar thumbnail
   - "Close" button
   - "Copy Lens Link" button (for reverse image search)

### Message Routing

**Thread → DM**:
- Any non-bot message in the modmail thread is forwarded to the applicant's DM
- Format: `**From Staff ({tag}):**\n{content}`
- First attachment URL is included
- If DM delivery fails, a warning is posted in the thread

**DM → Thread**:
- Any DM from the applicant (with an open ticket) is forwarded to the thread
- Format: `**Applicant (<@{userId}>):**\n{content}`
- First attachment URL is included
- Bot tracks forwarded messages to prevent echo loops

### Closing Modmail

**Via Button**:
- Click "Close" in the thread's starter embed
- Thread is locked and archived
- DB status updated to `closed`
- Applicant receives closure notification DM

**Via Command**:
```
/modmail close [thread]
```
- If `thread` is omitted, uses the current thread
- Same behavior as button

### Reopening Modmail

```
/modmail reopen [user] [thread]
```

**Within 7 Days**:
- Thread is unlocked and unarchived
- DB status updated to `open`
- Applicant receives reopen notification DM

**After 7 Days**:
- Creates a new thread transparently
- Keeps association with original application code

## Permissions

### Required Bot Permissions

- **ManageThreads**: Create and manage private threads
- **SendMessagesInThreads**: Post messages in threads
- **ViewChannel**: See the review channel
- **SendMessages**: Send DMs to applicants

### Required User Permissions

One of:
- **Manage Guild** permission
- **Reviewer Role** (configured in guild settings)

## Database Schema

```sql
CREATE TABLE modmail_ticket (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  app_code TEXT,                -- hex6 for convenience
  review_message_id TEXT,       -- original review card
  thread_id TEXT,               -- staff thread
  status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'closed'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE UNIQUE INDEX idx_modmail_open_unique
ON modmail_ticket(guild_id, user_id, status)
WHERE status = 'open';
```

**Constraint**: Only one open ticket per user per guild (enforced by unique index).

## Commands

### `/modmail close [thread]`

Close a modmail thread.

**Parameters**:
- `thread` (optional): Thread ID to close. If omitted, uses current thread.

**Permissions**: Manage Guild or Reviewer Role

**Effects**:
- Sets DB status to `closed`
- Locks and archives thread
- DMs applicant with closure notice

### `/modmail reopen [user] [thread]`

Reopen a closed modmail thread.

**Parameters**:
- `user` (optional): User to reopen modmail for (finds most recent closed ticket)
- `thread` (optional): Specific thread ID to reopen

**Permissions**: Manage Guild or Reviewer Role

**Effects**:
- If within 7 days: unlocks and unarchives thread
- If after 7 days: creates new thread
- DMs applicant with reopen notice

## Context Menu

**"Modmail: Open"** (Message Command)

Right-click on any review card message and select this option to open modmail for that applicant.

**Permissions**: Manage Guild or Reviewer Role

## Failure Modes

### DM Delivery Failures

**When Opening**:
- If applicant has DMs disabled, a warning is posted in the thread
- Thread still opens successfully
- Staff can proceed with thread messages (they won't deliver until DMs are enabled)

**When Routing**:
- Thread → DM: Warning posted in thread if delivery fails
- DM → Thread: Fails silently (logged); applicant won't get feedback if thread is closed

### Permission Failures

**Missing Bot Permissions**:
- Returns error message to staff: "Bot is missing ManageThreads or SendMessagesInThreads permission."
- Does not create ticket in DB
- Logs error for debugging

**Missing User Permissions**:
- Returns ephemeral error: "You do not have permission for this."
- No ticket created

### Multiple Open Tickets

**Prevented by DB Constraint**:
- Unique index ensures only one open ticket per user per guild
- Attempting to open second ticket returns: "Modmail thread already exists: <#threadId>"

## Logging

All modmail operations use `[modmail]` prefix in logs:

```javascript
logger.info({ ticketId, threadId, userId }, "[modmail] thread opened");
logger.warn({ err, ticketId }, "[modmail] failed to DM applicant on close");
```

**Key Events**:
- `[modmail] thread opened`: New ticket created
- `[modmail] thread closed`: Ticket closed
- `[modmail] thread reopened`: Ticket reopened
- `[modmail] routed thread → DM`: Message forwarded to applicant
- `[modmail] routed DM → thread`: Message forwarded to thread
- `[modmail] failed to route thread → DM`: DM delivery failed
- `[modmail] failed to DM applicant on open`: Opening notification failed

## Integration with Review Cards

### Button Visibility

The "Modmail" button appears on the review card:
- **Only when claimed** by a reviewer
- **Not on terminal states** (approved/rejected/kicked)
- In the same row as Accept/Reject/Kick buttons

### Status Display

Review cards show modmail status in an inline field:

```
Modmail: Open: #modmail-A1B2C3
```

or

```
Modmail: Closed
```

**Location**: Inline field after Status field

## Testing Checklist

- [ ] Open modmail from review card button
- [ ] Open modmail from context menu
- [ ] Send message in thread → verify DM delivery
- [ ] Send DM → verify thread delivery
- [ ] Verify attachments are forwarded
- [ ] Close via button → verify lock/archive/DM
- [ ] Close via command → verify same behavior
- [ ] Reopen within 7 days → verify unlock/unarchive
- [ ] Reopen after 7 days → verify new thread
- [ ] Test with DMs disabled → verify warnings
- [ ] Test permission failures → verify error messages
- [ ] Test duplicate open attempt → verify constraint error
- [ ] Verify echo loop prevention (forwarded messages not re-forwarded)

## Security Considerations

1. **Privacy**: Threads are private; only staff and thread members can see messages
2. **Audit Trail**: All messages logged; ticket lifecycle tracked in DB
3. **Permission Gating**: All actions require staff permissions
4. **No Applicant Access**: Applicants never join the thread directly
5. **Rate Limiting**: Relies on Discord's native rate limits for DMs

## Future Enhancements

Potential improvements:
- Transcripts: Export thread history to file
- Multiple threads: Allow multiple concurrent threads per applicant
- Custom templates: Configurable opening/closing messages
- Auto-close: Close threads after inactivity timeout
- Webhooks: Route messages via webhooks for better attribution

---

## See Also

### Related Guides
- [Modmail System (Reference)](../reference/modmail-system.md) — Technical architecture details
- [GATEKEEPER-GUIDE.md](../GATEKEEPER-GUIDE.md) — Gate system basics for staff
- [Gate Review Flow](../reference/gate-review-flow.md) — Application review workflow

### Reference Documentation
- [BOT-HANDBOOK.md](../../BOT-HANDBOOK.md) — Complete command reference
- [MOD-HANDBOOK.md](../MOD-HANDBOOK.md) — Staff policies and escalation
- [PERMS-MATRIX.md](../../PERMS-MATRIX.md) — Permission reference

### Navigation
- [Bot Handbook](../../BOT-HANDBOOK.md) — Start here for all docs
- [Troubleshooting](../operations/troubleshooting.md) — Common issues and fixes
