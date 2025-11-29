# Server Artist Rotation System

## Overview

Manage a rotating queue of Server Artists for art reward fulfillment with automatic role change detection, logging, and confirmation-based workflow.

**Goals:**
- Eliminate manual tracking of artist rotation
- Prevent queue desync when multiple staff handle rewards
- Automatically detect when artists join/leave the program
- Provide audit trail for all assignments

---

## Key IDs

### Roles

| Type | Name | ID |
|------|------|-----|
| Role | Server Artist | `896070888749940770` |
| Role | Community Ambassador | `896070888762535967` |

### Channels

| Name | ID | Purpose |
|------|-----|---------|
| server-artist | `1131332813585661982` | Artist coordination channel |

### Art Ticket Roles

| Ticket Type | Role ID | Reward Source |
|-------------|---------|---------------|
| OC Headshot Ticket | `929950578379993108` | Level 50, Level 100+, 1 Credit, Top Text Chatter |
| OC Half-body Ticket | `1402298352560902224` | 2 Credits |
| OC Emoji Ticket | `1414982808631377971` | Shop/Reward |
| OC Full-body Ticket | *TBD* | Top Voice Chatter monthly |

---

## Database Schema

### `artist_queue` Table

Tracks the current rotation order of Server Artists.

```sql
CREATE TABLE artist_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  added_at TEXT DEFAULT (datetime('now')),
  assignments_count INTEGER DEFAULT 0,
  last_assigned_at TEXT,
  skipped INTEGER DEFAULT 0,
  UNIQUE(guild_id, user_id)
);

CREATE INDEX idx_artist_queue_guild_position ON artist_queue(guild_id, position);
```

### `artist_assignment_log` Table

Audit trail for all art reward assignments.

```sql
CREATE TABLE artist_assignment_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  ticket_type TEXT NOT NULL,
  ticket_role_id TEXT,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT DEFAULT (datetime('now')),
  channel_id TEXT,
  override INTEGER DEFAULT 0
);

CREATE INDEX idx_artist_assignment_log_guild ON artist_assignment_log(guild_id);
CREATE INDEX idx_artist_assignment_log_artist ON artist_assignment_log(artist_id);
```

---

## Feature 1: Server Artist Role Detection & Logging

### Event Handler

Listen to `guildMemberUpdate` event to detect Server Artist role changes.

### On Role Added

When a user receives the Server Artist role:

1. Add user to the **end** of the artist queue
2. Attempt audit log lookup to find who added the role
3. Post log message to logging channel:

```
🎨 Server Artist Added

User: @ArtistName (123456789012345678)
Added by: @ModeratorName
Queue Position: #5
Time: <t:1234567890:F>
```

4. Optionally DM the new artist with onboarding info

### On Role Removed

When a user loses the Server Artist role:

1. Remove user from artist queue
2. Reorder remaining positions to fill gap
3. Attempt audit log lookup to find who removed the role
4. Post log message to logging channel:

```
🎨 Server Artist Removed

User: @ArtistName (123456789012345678)
Removed by: @ModeratorName
Total Assignments Completed: 12
Time in Program: 45 days
Time: <t:1234567890:F>
```

### Edge Cases

- If user rejoins program, they go to end of queue (fresh start)
- Bot startup should sync queue with current role holders (see `/artistqueue sync`)

---

## Feature 2: Channel Permission Setup

### Requirement

Community Ambassadors need access to the `#server-artist` channel to coordinate art rewards.

### Implementation

On bot startup or via `/artistqueue setup` command:

```typescript
const channel = await guild.channels.fetch('1131332813585661982');
const ambassadorRole = '896070888762535967';

await channel.permissionOverwrites.edit(ambassadorRole, {
  ViewChannel: true,
  SendMessages: true,
  ReadMessageHistory: true
});
```

### Logging

Log permission changes to audit channel:

```
🔧 Channel Permissions Updated

Channel: #server-artist
Role: Community Ambassador
Permissions: ViewChannel, SendMessages, ReadMessageHistory
```

---

## Feature 3: `/redeemreward` Command

### Command Definition

```
/redeemreward user:<User> type:<Choice> [artist:<User>]
```

**Permissions:** Community Ambassador and above

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user` | User | Yes | The user redeeming their art reward |
| `type` | Choice | Yes | Type of art: `headshot`, `halfbody`, `emoji`, `fullbody` |
| `artist` | User | No | Override automatic rotation with specific artist |

### Type to Role Mapping

```typescript
const TICKET_ROLES = {
  headshot: '929950578379993108',
  halfbody: '1402298352560902224',
  emoji: '1414982808631377971',
  fullbody: null // TBD - create role or handle differently
};
```

### Flow (Confirmation-Based)

#### Step 1: Inspect User Profile

Check which ticket roles the target user currently has:

```typescript
const userRoles = member.roles.cache;
const hasHeadshot = userRoles.has(TICKET_ROLES.headshot);
const hasHalfbody = userRoles.has(TICKET_ROLES.halfbody);
const hasEmoji = userRoles.has(TICKET_ROLES.emoji);
```

#### Step 2: Display Confirmation Embed

**Normal Case (Role Matches):**

```
🎨 Art Reward Redemption

Recipient: @Fable
Requested Type: Headshot

✅ User has: OC Headshot Ticket

Next Artist: @AwesomeArtist (#3 in queue)

━━━━━━━━━━━━━━━━━━━━━━

[✅ Confirm & Assign] [❌ Cancel]
```

**User Has Multiple Ticket Roles:**

```
🎨 Art Reward Redemption

Recipient: @Fable
Requested Type: Headshot

✅ User has: OC Headshot Ticket
ℹ️ User also has: OC Emoji Ticket (will not be used)

Next Artist: @AwesomeArtist (#3 in queue)

━━━━━━━━━━━━━━━━━━━━━━

[✅ Confirm & Assign] [❌ Cancel]
```

**Mismatch Warning (Role Doesn't Match):**

```
⚠️ Art Reward - Type Mismatch

Recipient: @Fable
Requested Type: Half-body

❌ User does NOT have: OC Half-body Ticket
✅ User has: OC Headshot Ticket

Are you sure you want to proceed with Half-body?

━━━━━━━━━━━━━━━━━━━━━━

[⚠️ Proceed Anyway] [🔄 Switch to Headshot] [❌ Cancel]
```

**No Ticket Role Found:**

```
❌ Art Reward - No Ticket Found

Recipient: @Fable
Requested Type: Headshot

User does not have any art ticket roles:
• OC Headshot Ticket - ❌
• OC Half-body Ticket - ❌
• OC Emoji Ticket - ❌

━━━━━━━━━━━━━━━━━━━━━━

[⚠️ Assign Anyway (Admin)] [❌ Cancel]
```

#### Step 3: On Confirm Button Click

Only after staff clicks confirm:

1. **Remove ticket role** from recipient
2. **Send Ticket Tool command** in current channel:
   ```
   $add <artistUserId>
   ```
3. **Move artist** to end of queue
4. **Increment** artist's assignment count
5. **Log assignment** to database
6. **Update embed** to show completion:

```
✅ Art Reward Assigned

Recipient: @Fable
Type: OC Headshot
Artist: @AwesomeArtist

Actions Completed:
✓ Ticket role removed from @Fable
✓ @AwesomeArtist added to ticket
✓ Artist moved to end of queue (was #3, now #7)

Assignment logged.
```

### Artist Override

If `artist` parameter is provided:

1. Verify override artist has Server Artist role
2. Show warning that this skips rotation:

```
⚠️ Artist Override

You selected @SpecificArtist instead of the next in queue (@QueuedArtist #3).

This will NOT affect @SpecificArtist's queue position.

[✅ Confirm Override] [🔄 Use Queue] [❌ Cancel]
```

---

## Feature 4: Queue Management Commands

### `/artistqueue list`

Display current rotation order.

```
🎨 Server Artist Queue

Position | Artist | Assignments | Last Assigned
---------|--------|-------------|---------------
#1       | @Artist1 | 15       | 2 days ago
#2       | @Artist2 | 12       | 5 days ago
#3       | @Artist3 ⏸️ | 8     | 1 week ago (skipped)
#4       | @Artist4 | 3        | Never

Total Artists: 4
Total Assignments: 38
```

### `/artistqueue sync`

Synchronize queue with current Server Artist role holders.

**Flow:**
1. Fetch all members with Server Artist role
2. Add any missing members to end of queue
3. Remove any queue entries for members without the role
4. Report changes:

```
🔄 Queue Synchronized

Added to queue:
• @NewArtist1 (position #5)
• @NewArtist2 (position #6)

Removed from queue:
• @FormerArtist (had 10 assignments)

Queue is now in sync with Server Artist role.
```

### `/artistqueue move <user> <position>`

Manually reorder an artist in the queue.

```
/artistqueue move user:@Artist3 position:1
```

```
✅ Queue Updated

@Artist3 moved from position #5 to #1

New order:
#1 @Artist3 ⬆️
#2 @Artist1
#3 @Artist2
#4 @Artist4
#5 @Artist5
```

### `/artistqueue skip <user> [reason]`

Temporarily skip an artist (e.g., on break, busy).

```
/artistqueue skip user:@Artist2 reason:On vacation until Dec 15
```

```
⏸️ Artist Skipped

@Artist2 will be skipped in rotation.
Reason: On vacation until Dec 15

They remain in queue at position #2 but won't be auto-assigned.
Use /artistqueue unskip to restore.
```

### `/artistqueue unskip <user>`

Remove skip status from an artist.

### `/artistqueue history [user] [limit]`

View assignment history.

**Global history:**
```
/artistqueue history
```

```
📜 Recent Assignments

1. @Artist1 → @Recipient1 (Headshot) - 2 hours ago by @Mod1
2. @Artist2 → @Recipient2 (Half-body) - 1 day ago by @Mod2
3. @Artist1 → @Recipient3 (Emoji) - 3 days ago by @Mod1
...

Showing 10 of 38 total assignments.
```

**Per-artist history:**
```
/artistqueue history user:@Artist1
```

```
📜 @Artist1's Assignment History

Total Assignments: 15
Average per month: 3.2

Recent:
1. @Recipient1 (Headshot) - 2 hours ago
2. @Recipient3 (Emoji) - 3 days ago
3. @Recipient5 (Headshot) - 1 week ago
...
```

---

## Feature 5: Setup Command

### `/artistqueue setup`

One-time setup command for administrators.

**Actions:**
1. Create database tables if not exist
2. Sync queue with current Server Artist role holders
3. Update channel permissions for Community Ambassador
4. Confirm setup complete

```
🎨 Artist Queue Setup Complete

✅ Database tables created
✅ Queue synced (4 artists)
✅ #server-artist permissions updated

The artist rotation system is ready to use.

Commands available:
• /redeemreward - Assign art reward to user
• /artistqueue list - View rotation order
• /artistqueue sync - Re-sync with role
```

---

## Implementation Checklist

### Phase 1: Database & Core
- [ ] Create database migration for `artist_queue` table
- [ ] Create database migration for `artist_assignment_log` table
- [ ] Implement queue CRUD functions
- [ ] Write unit tests for queue operations

### Phase 2: Role Detection
- [ ] Add `guildMemberUpdate` event handler
- [ ] Implement Server Artist role add detection
- [ ] Implement Server Artist role remove detection
- [ ] Add audit log lookup for role changes
- [ ] Add logging to designated channel

### Phase 3: Commands
- [ ] Implement `/artistqueue setup` command
- [ ] Implement `/artistqueue list` command
- [ ] Implement `/artistqueue sync` command
- [ ] Implement `/artistqueue move` command
- [ ] Implement `/artistqueue skip` and `unskip` commands
- [ ] Implement `/artistqueue history` command

### Phase 4: Redemption Flow
- [ ] Implement `/redeemreward` command
- [ ] Build confirmation embed with user inspection
- [ ] Handle type mismatch warnings
- [ ] Implement confirm/cancel button handlers
- [ ] Add `$add` command sending to Ticket Tool
- [ ] Implement role removal on confirmation
- [ ] Add assignment logging

### Phase 5: Permissions & Polish
- [ ] Implement channel permission setup
- [ ] Add proper permission checks to commands
- [ ] Error handling and edge cases
- [ ] Integration testing

---

## File Structure

```
src/
├── commands/
│   └── artistqueue.ts      # Queue management commands
├── features/
│   └── artistRotation/
│       ├── index.ts        # Main exports
│       ├── queue.ts        # Queue operations
│       ├── redemption.ts   # /redeemreward logic
│       ├── roleSync.ts     # Role change detection
│       └── types.ts        # TypeScript types
├── db/
│   └── migrations/
│       └── XXX_artist_queue.sql
```

---

## Constants

```typescript
// src/features/artistRotation/constants.ts

export const ARTIST_ROLE_ID = '896070888749940770';
export const AMBASSADOR_ROLE_ID = '896070888762535967';
export const SERVER_ARTIST_CHANNEL_ID = '1131332813585661982';

export const TICKET_ROLES = {
  headshot: '929950578379993108',
  halfbody: '1402298352560902224',
  emoji: '1414982808631377971',
  fullbody: null, // TBD
} as const;

export const TICKET_ROLE_NAMES = {
  '929950578379993108': 'OC Headshot Ticket',
  '1402298352560902224': 'OC Half-body Ticket',
  '1414982808631377971': 'OC Emoji Ticket',
} as const;
```

---

## Open Questions

1. **Full-body Ticket Role** - Does this need to be created, or is full-body handled differently?
2. **Logging Channel** - Which channel should artist add/remove logs go to?
3. **Skip Duration** - Should skips auto-expire after a certain time?
4. **Multiple Guilds** - Is this system needed for multiple guilds or just Pawtropolis?
