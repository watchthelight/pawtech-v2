# Logging, Auditing, and ModStats

## Action Logging Model

All moderator actions are recorded in the `action_log` table and posted to the guild's logging channel as "pretty cards" (rich embeds). This creates an immutable audit trail for compliance and transparency.

### Action Taxonomy

| Action Type     | Trigger                          | Logged Data                                           |
| --------------- | -------------------------------- | ----------------------------------------------------- |
| `submit`        | User submits `/gate` application | app_id, user_id, timestamp                            |
| `claim`         | Moderator claims application     | app_id, moderator_id, timestamp                       |
| `unclaim`       | Moderator unclaims application   | app_id, moderator_id, timestamp                       |
| `accept`        | `/accept` command                | app_id, moderator_id, reason (free-text), timestamp   |
| `reject`        | `/reject` command                | app_id, moderator_id, reason (free-text), timestamp   |
| `kick`          | `/kick` command                  | user_id, moderator_id, reason, timestamp              |
| `flag`          | `/flag` command (manual bot flag)| user_id, moderator_id, reason, timestamp              |
| `modmail_open`  | New modmail thread created       | thread_id, user_id, timestamp                         |
| `modmail_close` | `/modmail close` or auto-archive | thread_id, user_id, moderator_id, duration, timestamp |
| `config_change` | `/config set` command            | key, old_value, new_value, moderator_id, timestamp    |

### Database Schema (`action_log`)

```sql
CREATE TABLE action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER,                      -- FK to review_action.id (nullable)
  thread_id TEXT,                      -- FK to open_modmail.thread_id (nullable)
  moderator_id TEXT NOT NULL,          -- Discord user ID ('0' for system)
  action TEXT NOT NULL,                -- Action type from taxonomy above
  reason TEXT,                         -- Free-text reason (nullable)
  metadata TEXT,                       -- JSON blob for extra data (nullable)
  timestamp TEXT NOT NULL,             -- ISO 8601 datetime

  FOREIGN KEY (app_id) REFERENCES review_action(id) ON DELETE CASCADE
);

CREATE INDEX idx_action_log_app_id ON action_log(app_id);
CREATE INDEX idx_action_log_moderator_id ON action_log(moderator_id);
CREATE INDEX idx_action_log_timestamp ON action_log(timestamp);
CREATE INDEX idx_action_log_action ON action_log(action);
```

### Insert Action Example

```typescript
async function logAction(
  action: string,
  appId: number | null,
  moderatorId: string,
  reason?: string,
  metadata?: Record<string, any>
): Promise<void> {
  db.prepare(
    `
    INSERT INTO action_log (app_id, moderator_id, action, reason, metadata, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(
    appId,
    moderatorId,
    action,
    reason || null,
    metadata ? JSON.stringify(metadata) : null,
    new Date().toISOString()
  );

  // [Known Issue] Pretty card sometimes not posted
  await postPrettyCard(action, appId, moderatorId, reason, metadata);
}
```

## Pretty Cards (Action Embeds)

### Card Structure

```typescript
interface PrettyCard {
  title: string; // "[ACTION] Event Name"
  color: number; // Hex color code
  fields: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer: {
    text: string; // "ID: 123 • Action: accept • Moderator: Alice"
  };
  timestamp: Date; // Automatic Discord timestamp
}
```

### Color Coding

| Action Category | Color Code | Hex      | Use Case                    |
| --------------- | ---------- | -------- | --------------------------- |
| Positive        | Green      | 0x2ecc71 | Accept, modmail_open        |
| Negative        | Red        | 0xe74c3c | Reject, kick, modmail_close |
| Neutral         | Blue       | 0x3498db | Claim, config_change        |
| Warning         | Yellow     | 0xf1c40f | Unclaim, permission issues  |

### Example: Accept Action Card

```typescript
async function buildAcceptCard(
  appId: number,
  moderatorId: string,
  reason: string
): Promise<EmbedBuilder> {
  const app = db.prepare("SELECT * FROM review_action WHERE id = ?").get(appId);
  const responseTime =
    (new Date(app.decided_at).getTime() - new Date(app.claimed_at).getTime()) / (1000 * 60 * 60);

  return new EmbedBuilder()
    .setTitle("[ACCEPT] Application Approved")
    .setColor(0x2ecc71)
    .addFields(
      { name: "Application ID", value: `#${appId}`, inline: true },
      { name: "User", value: `<@${app.user_id}>`, inline: true },
      { name: "Moderator", value: `<@${moderatorId}>`, inline: true },
      { name: "Response Time", value: `${responseTime.toFixed(1)}h`, inline: true },
      { name: "Reason", value: reason || "*No reason provided*", inline: false }
    )
    .setFooter({ text: `App ID: ${appId} • Action: accept` })
    .setTimestamp();
}
```

### Example: Modmail Close Card

```typescript
async function buildModmailCloseCard(
  threadId: string,
  userId: string,
  moderatorId: string
): Promise<EmbedBuilder> {
  const ticket = db.prepare("SELECT * FROM open_modmail WHERE thread_id = ?").get(threadId);
  const duration =
    (new Date(ticket.closed_at).getTime() - new Date(ticket.created_at).getTime()) /
    (1000 * 60 * 60);
  const messageCount = db
    .prepare('SELECT COUNT(*) as c FROM action_log WHERE thread_id = ? AND action = "message_sent"')
    .get(threadId).c;

  return new EmbedBuilder()
    .setTitle("[MODMAIL] Thread Closed")
    .setColor(0xe74c3c)
    .addFields(
      { name: "Thread ID", value: threadId, inline: true },
      { name: "User", value: `<@${userId}>`, inline: true },
      { name: "Closed By", value: `<@${moderatorId}>`, inline: true },
      { name: "Duration", value: `${duration.toFixed(1)}h`, inline: true },
      { name: "Messages", value: messageCount.toString(), inline: true }
    )
    .setFooter({ text: `Thread: ${threadId}` })
    .setTimestamp();
}
```

## Logging Channel Configuration

### `/config set logging` and Environment Fallback

**Priority**: Database config > Environment variable > Skip logging

```typescript
function getLoggingChannel(guildId: string): TextChannel | null {
  // [Known Issue] logging_channel_id column missing; query fails
  const config = db
    .prepare(
      `
    SELECT logging_channel_id FROM configs WHERE guild_id = ?
  `
    )
    .get(guildId);

  let channelId: string | undefined;

  if (config?.logging_channel_id) {
    channelId = config.logging_channel_id;
  } else if (process.env.LOGGING_CHANNEL) {
    // [Known Issue] Fallback never triggered in current code
    channelId = process.env.LOGGING_CHANNEL;
    console.warn(`Using fallback LOGGING_CHANNEL env var: ${channelId}`);
  }

  if (!channelId) {
    console.warn("No logging channel configured; skipping action log.");
    return null;
  }

  const channel = client.channels.cache.get(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.error(`Logging channel ${channelId} not found or not a text channel.`);
    return null;
  }

  return channel as TextChannel;
}
```

### Known Issue: Missing `logging_channel_id` Column

**Error**:

```
SqliteError: no such column: configs.logging_channel_id
    at Database.prepare (better-sqlite3)
```

**Impact**: `/config set logging` command fails; all logging channel queries fail.

**Workaround**: Hard-code channel ID in code or use `LOGGING_CHANNEL` env var exclusively.

**Permanent Fix** (migration):

```sql
ALTER TABLE configs ADD COLUMN logging_channel_id TEXT;

-- Backfill with env var
UPDATE configs SET logging_channel_id = '<LOGGING_CHANNEL>' WHERE logging_channel_id IS NULL;
```

### Card Posting Policy

**When to Post**:

- ✅ All moderator actions (accept, reject, kick, claim, unclaim)
- ✅ Modmail thread lifecycle events (open, close, reopen)
- ✅ Configuration changes via `/config set`
- ❌ User-initiated actions (application submit) → post to review channel, not logging
- ❌ Health checks, analytics queries → no logging

**Posting Logic**:

```typescript
async function postPrettyCard(
  action: string,
  appId: number | null,
  moderatorId: string,
  reason?: string,
  metadata?: Record<string, any>
): Promise<void> {
  const loggingChannel = getLoggingChannel(guildId);
  if (!loggingChannel) return; // Skip if no channel configured

  let embed: EmbedBuilder;

  switch (action) {
    case "accept":
      embed = await buildAcceptCard(appId!, moderatorId, reason || "");
      break;
    case "reject":
      embed = await buildRejectCard(appId!, moderatorId, reason || "");
      break;
    case "modmail_close":
      embed = await buildModmailCloseCard(metadata!.threadId, metadata!.userId, moderatorId);
      break;
    // ... other action types
    default:
      console.warn(`Unknown action type: ${action}`);
      return;
  }

  try {
    await loggingChannel.send({ embeds: [embed] });
    console.log(`[Logger] Posted ${action} card to ${loggingChannel.id}`);
  } catch (error) {
    console.error(`[Logger] Failed to post card:`, error);
    // Fallback: log to console as JSON
    console.log(
      JSON.stringify({ action, appId, moderatorId, reason, timestamp: new Date().toISOString() })
    );
  }
}
```

### Known Issue: Pretty Cards Not Emitted

**Symptom**: Action logged to DB, but no embed posted to logging channel.

**Root Causes**:

1. `logging_channel_id` missing from configs table → query fails, returns null.
2. `LOGGING_CHANNEL` env var not read (fallback code exists but never triggered).
3. Channel permissions: bot lacks `SendMessages` or `EmbedLinks` in logging channel.

**Diagnosis**:

```typescript
// Add debug logging
function getLoggingChannel(guildId: string): TextChannel | null {
  console.log("[Debug] Fetching logging channel for guild:", guildId);

  const config = db
    .prepare("SELECT logging_channel_id FROM configs WHERE guild_id = ?")
    .get(guildId);
  console.log("[Debug] Config result:", config);

  if (!config?.logging_channel_id) {
    console.log("[Debug] No DB config; checking env var:", process.env.LOGGING_CHANNEL);
  }

  // ... rest of function
}
```

**Fix Checklist**:

1. ✅ Add `logging_channel_id` column to configs table.
2. ✅ Update `/config set logging` to write to new column.
3. ✅ Verify env fallback logic executes (add explicit check).
4. ✅ Validate bot permissions in logging channel on startup.

## ModStats System

### Leaderboard Mode (`/modstats mode:leaderboard days:30`)

**Metrics Calculated**:

- Total claims per moderator
- Total accepts per moderator
- Total rejects per moderator
- Average response time (claim → decision)
- Acceptance rate (accepts / total decisions)

**SQL Query**:

```sql
SELECT
  moderator_id,
  COUNT(CASE WHEN action = 'claim' THEN 1 END) as total_claims,
  COUNT(CASE WHEN action = 'accept' THEN 1 END) as accepts,
  COUNT(CASE WHEN action = 'reject' THEN 1 END) as rejects,
  AVG(
    CASE
      WHEN action IN ('accept', 'reject') THEN
        (julianday(al.timestamp) - julianday(ra.claimed_at)) * 24
    END
  ) as avg_response_hours
FROM action_log al
JOIN review_action ra ON al.app_id = ra.id
WHERE al.timestamp > datetime('now', '-30 days')
  AND al.action IN ('claim', 'accept', 'reject')
GROUP BY moderator_id
ORDER BY total_claims DESC
LIMIT 10;
```

**Output Format** (code block embed):

```
📊 Moderator Leaderboard (Last 30 Days)

┌────────────────────┬───────┬────────┬─────────┬──────────┐
│ Moderator          │ Claims│ Accepts│ Rejects │ Avg Time │
├────────────────────┼───────┼────────┼─────────┼──────────┤
│ @Alice#1234        │   45  │   32   │   13    │  14.2h   │
│ @Bob#5678          │   38  │   29   │    9    │  18.5h   │
│ @Carol#9012        │   22  │   15   │    7    │  22.1h   │
└────────────────────┴───────┴────────┴─────────┴──────────┘

Team Metrics:
- Avg Response Time: 17.8h
- Acceptance Rate: 68%
- Total Reviews: 105
```

**Implementation**:

```typescript
async function generateLeaderboard(days: number): Promise<string> {
  const stats = db
    .prepare(
      `
    SELECT
      moderator_id,
      COUNT(CASE WHEN action = 'claim' THEN 1 END) as claims,
      COUNT(CASE WHEN action = 'accept' THEN 1 END) as accepts,
      COUNT(CASE WHEN action = 'reject' THEN 1 END) as rejects,
      AVG(CASE WHEN action IN ('accept', 'reject') THEN response_hours END) as avg_time
    FROM (
      SELECT
        al.moderator_id,
        al.action,
        (julianday(al.timestamp) - julianday(ra.claimed_at)) * 24 as response_hours
      FROM action_log al
      JOIN review_action ra ON al.app_id = ra.id
      WHERE al.timestamp > datetime('now', '-' || ? || ' days')
    )
    GROUP BY moderator_id
    ORDER BY claims DESC
    LIMIT 10
  `
    )
    .all(days);

  const rows = stats
    .map((s) => {
      const user = client.users.cache.get(s.moderator_id);
      const tag = user ? `@${user.tag}` : `<@${s.moderator_id}>`;
      return `│ ${tag.padEnd(18)} │ ${s.claims.toString().padStart(5)} │ ${s.accepts.toString().padStart(6)} │ ${s.rejects.toString().padStart(7)} │ ${s.avg_time.toFixed(1).padStart(8)}h │`;
    })
    .join("\n");

  return (
    `📊 Moderator Leaderboard (Last ${days} Days)\n\n` +
    `┌────────────────────┬───────┬────────┬─────────┬──────────┐\n` +
    `│ Moderator          │ Claims│ Accepts│ Rejects │ Avg Time │\n` +
    `├────────────────────┼───────┼────────┼─────────┼──────────┤\n` +
    `${rows}\n` +
    `└────────────────────┴───────┴────────┴─────────┴──────────┘`
  );
}
```

### User Drill-Down Mode (`/modstats mode:user user:@Alice days:90`)

**Per-Moderator KPIs**:

- Total actions (claims, accepts, rejects)
- Acceptance rate (percentage)
- Median response time (50th percentile)
- P95 response time (95th percentile, SLA compliance)
- Activity sparkline (claims per day, last 7 days)

**SQL Query** (median/P95 calculation):

```sql
-- Note: SQLite lacks PERCENTILE_CONT; calculate in JavaScript
SELECT
  (julianday(al.timestamp) - julianday(ra.claimed_at)) * 24 as response_hours
FROM action_log al
JOIN review_action ra ON al.app_id = ra.id
WHERE al.moderator_id = ?
  AND al.action IN ('accept', 'reject')
  AND al.timestamp > datetime('now', '-90 days')
ORDER BY response_hours ASC;
```

**Percentile Calculation** (TypeScript):

```typescript
function calculatePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * p) - 1;
  return sorted[index];
}

const responseTimes = db
  .prepare(`...`)
  .all(userId)
  .map((r) => r.response_hours);
const median = calculatePercentile(responseTimes, 0.5);
const p95 = calculatePercentile(responseTimes, 0.95);
```

**Activity Sparkline** (ASCII):

```typescript
function generateSparkline(userId: string): string {
  const activity = db
    .prepare(
      `
    SELECT DATE(timestamp) as date, COUNT(*) as count
    FROM action_log
    WHERE moderator_id = ?
      AND action = 'claim'
      AND timestamp > datetime('now', '-7 days')
    GROUP BY DATE(timestamp)
    ORDER BY date ASC
  `
    )
    .all(userId);

  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const counts = days.map((day) => {
    const match = activity.find((a) => new Date(a.date).getDay() === days.indexOf(day) + 1);
    return match?.count || 0;
  });

  const maxCount = Math.max(...counts);
  return counts
    .map((count, i) => {
      const bars = "█".repeat(Math.ceil((count / maxCount) * 10));
      return `${days[i]} ${bars} ${count}`;
    })
    .join("\n");
}
```

**Output Example**:

```
👤 Moderator Stats: Alice#1234

Total Actions: 87
Acceptance Rate: 71.2%
Median Response Time: 15.3h
P95 Response Time: 28.7h

Activity (Claims, Last 7 Days):
Mon ████████ 8
Tue ██████ 6
Wed ████████████ 12
Thu ██████ 6
Fri ████ 4
Sat ██ 2
Sun ████ 4
```

## SLA Buckets and Reporting

### Response Time Buckets

| Bucket    | Range  | SLA Status | Color Code |
| --------- | ------ | ---------- | ---------- |
| Excellent | <6h    | ✅ Green   | 0x2ecc71   |
| Good      | 6–24h  | ✅ Green   | 0x2ecc71   |
| Fair      | 24–48h | ⚠️ Yellow  | 0xf1c40f   |
| Poor      | >48h   | ❌ Red     | 0xe74c3c   |

**Query**:

```sql
SELECT
  CASE
    WHEN response_hours < 6 THEN 'Excellent'
    WHEN response_hours < 24 THEN 'Good'
    WHEN response_hours < 48 THEN 'Fair'
    ELSE 'Poor'
  END as bucket,
  COUNT(*) as count
FROM (
  SELECT
    (julianday(al.timestamp) - julianday(ra.claimed_at)) * 24 as response_hours
  FROM action_log al
  JOIN review_action ra ON al.app_id = ra.id
  WHERE al.action IN ('accept', 'reject')
)
GROUP BY bucket;
```

## Actionable Recommendations

### Immediate Fixes

1. **Add `logging_channel_id` column**: Migrate configs table to support DB-stored logging channel.
2. **Fix env fallback**: Ensure `LOGGING_CHANNEL` env var is read when DB config missing.
3. **Verify card emission**: Add integration tests for all action types → validate embed posted.
4. **Permission validation**: Check `SendMessages` + `EmbedLinks` on startup; alert if missing.

### Analytics Enhancements

1. **Export to CSV**: Add `/modstats export` command (same as `/analytics-export`).
2. **Percentile support**: Pre-calculate P50/P95 in daily batch job (store in aggregates table).
3. **Heatmap visualization**: Generate ASCII heatmap (hour-of-day × day-of-week claim density).
4. **Trend analysis**: Compare current period vs. previous period (e.g., "Response time improved 12%").

### Monitoring and Alerts

1. **SLA breach alerts**: Post to admin channel when any moderator exceeds 48h response time.
2. **Daily digest**: Automated daily summary (pending queue depth, avg response time, top performers).
3. **Anomaly detection**: Alert on sudden drop in accept rate or spike in reject rate.

### Privacy and Retention

1. **Anonymize old logs**: After 1 year, redact user_id/moderator_id (keep aggregates only).
2. **GDPR compliance**: Implement `/data-delete` to purge user's action logs on request.
3. **Access control**: Restrict `/analytics-export` to owners only (includes raw user IDs).

---

## See Also

### Related Guides
- [Gate Review Flow](gate-review-flow.md) — Application workflow that generates logs
- [Modmail System](modmail-system.md) — Ticket lifecycle logging
- [ADMIN-GUIDE.md](../ADMIN-GUIDE.md) — Admin guide for stats management

### Reference Documentation
- [BOT-HANDBOOK.md](../../BOT-HANDBOOK.md) — Complete command reference
- [Database Schema](database-schema.md) — Full schema documentation
- [PERMS-MATRIX.md](../../PERMS-MATRIX.md) — Permission reference

### Navigation
- [Staff Documentation Index](../INDEX.md) — Find any document quickly
- [Troubleshooting](../operations/troubleshooting.md) — Common issues and fixes
