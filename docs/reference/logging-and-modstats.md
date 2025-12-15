# Logging and ModStats

The bot logs all moderator actions to the database and posts "pretty cards" (embeds) to the logging channel.

## What Gets Logged

| Action | When |
|--------|------|
| submit | User submits application |
| claim | Mod claims application |
| unclaim | Mod unclaims application |
| accept | Mod accepts application |
| reject | Mod rejects application |
| kick | Mod kicks user |
| flag | Mod flags user as bot |
| modmail_open | New ticket created |
| modmail_close | Ticket closed |
| config_change | Server settings changed |

## Database Table

```sql
CREATE TABLE action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER,
  thread_id TEXT,
  moderator_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  metadata TEXT,
  timestamp TEXT NOT NULL
);
```

## Pretty Cards

When actions happen, bot posts colored embeds to logging channel:

**Colors:**
- Green = Positive actions (accept, modmail_open)
- Red = Negative actions (reject, kick, close)
- Blue = Neutral actions (claim, config)
- Yellow = Warnings (unclaim)

Each card shows:
- What happened
- Who did it
- When it happened
- Any reason given
- Related IDs (app ID, user ID, etc)

## Setting Up Logging

Set logging channel with:
```
/config set logging <channel-id>
```

Or use environment variable:
```
LOGGING_CHANNEL=123456789
```

**Known Issue:** `logging_channel_id` column missing from database. Pretty cards won't post until this is fixed.

## ModStats

View moderator statistics with `/modstats`.

### Leaderboard Mode
```
/modstats mode:leaderboard days:30
```

Shows:
- Total claims per mod
- Total accepts/rejects
- Average response time
- Acceptance rate

### User Mode
```
/modstats mode:user user:@ModName days:90
```

Shows for one mod:
- Total actions
- Acceptance rate
- Median response time
- P95 response time (how fast they are 95% of the time)
- Activity chart (last 7 days)

## Response Time Buckets

| Time | Rating |
|------|--------|
| Under 6h | Excellent |
| 6-24h | Good |
| 24-48h | Fair |
| Over 48h | Poor |

## Common Queries

**Pending applications:**
```sql
SELECT COUNT(*) FROM review_action WHERE status = 'pending';
```

**Mod performance:**
```sql
SELECT moderator_id, COUNT(*) as total
FROM action_log
WHERE action IN ('accept', 'reject')
GROUP BY moderator_id;
```

**Average response time:**
```sql
SELECT AVG(julianday(decided_at) - julianday(claimed_at)) * 24 as hours
FROM review_action
WHERE decided_at IS NOT NULL;
```

## Known Issues

- Pretty cards sometimes don't post (logging_channel_id missing)
- Environment fallback doesn't work (LOGGING_CHANNEL not read)
- Need to add SendMessages + EmbedLinks permissions check on startup
