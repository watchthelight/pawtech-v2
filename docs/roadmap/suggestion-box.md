# Feature: Suggestion Box

## Overview
A system where users can submit **bot feature ideas**, and the community can vote on them. Staff can approve, deny, or mark suggestions as implemented. This is specifically for bot improvements, not general server suggestions.

## Commands

### User Commands
```
/suggest <suggestion>           Submit a new suggestion
/suggestions [status:open]      View suggestions (paginated)
```

### Staff Commands
```
/suggestion approve <id> [response]    Approve a suggestion
/suggestion deny <id> <reason>         Deny a suggestion
/suggestion implement <id>             Mark as implemented
/suggestion delete <id>                Delete a suggestion
```

## Database Schema
```sql
CREATE TABLE suggestion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',  -- open, approved, denied, implemented
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  staff_response TEXT,
  responded_by TEXT,
  message_id TEXT,           -- Message in suggestions channel
  channel_id TEXT,           -- Suggestions channel
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE suggestion_vote (
  suggestion_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  vote INTEGER NOT NULL,     -- 1 = upvote, -1 = downvote
  created_at INTEGER NOT NULL,
  PRIMARY KEY (suggestion_id, user_id),
  FOREIGN KEY (suggestion_id) REFERENCES suggestion(id) ON DELETE CASCADE
);

CREATE INDEX idx_suggestion_guild_status ON suggestion(guild_id, status);
CREATE INDEX idx_suggestion_votes ON suggestion(guild_id, upvotes DESC);
```

## Workflow

### Submission
1. User runs `/suggest <text>`
2. Bot creates embed in configured suggestions channel
3. Bot adds upvote/downvote reaction buttons
4. Bot confirms submission to user (ephemeral)

### Voting
1. Users click upvote (👍) or downvote (👎) buttons
2. Bot updates vote count in database
3. Bot edits embed to show current vote count
4. One vote per user (can change vote)

### Staff Actions
1. Staff runs `/suggestion approve <id>`
2. Bot updates status, adds staff response
3. Bot edits embed with new status and response
4. Bot DMs the suggester with the decision

## Suggestion Embed Design
```
🤖 Bot Feature Suggestion #42
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Add a /stats command to show personal activity

Submitted by @Username • 2 days ago

👍 15  👎 3

Status: ⏳ Open
```

After approval:
```
🤖 Bot Feature Suggestion #42
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Add a /stats command to show personal activity

Submitted by @Username • 2 days ago

👍 15  👎 3

Status: ✅ Approved
Response: "Great idea! We'll add this in the next update."
— @StaffMember
```

## Configuration
```sql
-- In guild_config
ALTER TABLE guild_config ADD COLUMN suggestion_channel_id TEXT;
ALTER TABLE guild_config ADD COLUMN suggestion_cooldown INTEGER DEFAULT 3600; -- 1 hour
```

## Implementation Files
- `src/commands/suggest.ts` - User suggestion command
- `src/commands/suggestion.ts` - Staff management commands
- `src/commands/suggestions.ts` - View suggestions
- `src/features/suggestions/` - Core logic
  - `store.ts` - Database operations
  - `voting.ts` - Vote handling
  - `embeds.ts` - Embed builders

## Edge Cases
- User tries to vote on own suggestion: Allow or deny (configurable)
- Suggestion too long: Truncate at 1000 chars
- Spam protection: Cooldown between suggestions (default 1 hour)
- Duplicate detection: Optional fuzzy matching

## DM Notifications
- Suggester gets DM when their suggestion is approved/denied/implemented
- Include staff response and link to original message

## Effort Estimate
Medium-High (6-8 hours)
