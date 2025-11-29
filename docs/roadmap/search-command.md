# Feature: /search Command

## Overview
A `/search` command that pulls up an embed card showing all of a user's past applications with links to each review card.

## Command Signature
```
/search user:@user
```

## Behavior
1. Query all applications for the specified user in the current guild
2. Display an embed showing:
   - User info (username, ID, avatar)
   - Total application count
   - List of all applications with:
     - App code (e.g., #ABC123)
     - Status (approved/rejected/pending/kicked)
     - Submitted date
     - Resolution reason (if any, truncated)
     - Link to review card message (if exists)

## Embed Design
```
Application History for @Username
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total Applications: 3

✅ #ABC123 • Approved • 2 months ago
   [View Card](link)

❌ #DEF456 • Rejected • 6 months ago
   Reason: "Account too new"
   [View Card](link)

❌ #GHI789 • Rejected • 1 year ago
   Reason: "Incomplete answers"
   [View Card](link)
```

## Database Queries
```sql
-- Get all applications for user
SELECT
  a.id, a.status, a.submitted_at, a.resolved_at, a.resolution_reason,
  rc.channel_id, rc.message_id
FROM application a
LEFT JOIN review_card rc ON rc.app_id = a.id
WHERE a.guild_id = ? AND a.user_id = ?
ORDER BY a.submitted_at DESC
```

## Implementation Files
- `src/commands/search.ts` - New command file
- Register in `src/commands/index.ts`

## Permissions
- Requires reviewer/moderator role (same as review commands)

## Edge Cases
- User has no applications: Show "No applications found for this user"
- Review card message deleted: Show app info but no link
- Too many applications: Paginate or limit to most recent 10

## Effort Estimate
Low-medium (2-3 hours)
