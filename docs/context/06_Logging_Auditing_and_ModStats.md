# 06 — Logging, Auditing, and ModStats

**Last Updated:** 2025-10-22
**Status:** Production-ready with automated metrics engine

## Summary

- **Action Logging:** Every moderation action logged to database + Discord channel with pretty embeds
- **Logging Channel:** Resolution priority: Database > ENV > null (with JSON fallback)
- **Permission Validation:** SendMessages + EmbedLinks required, warns on failure
- **Mod Metrics:** Automated calculation every 15 minutes with 5-minute cache TTL
- **Percentiles:** Nearest-rank algorithm for p50/p95 response times (deterministic)
- **Analytics:** Join→Submit ratio tracking with day/week/30-day/year aggregation windows

---

## Table of Contents

- [Action Logging System](#action-logging-system)
- [Logging Channel Resolution](#logging-channel-resolution)
- [Permission Validation](#permission-validation)
- [JSON Fallback Logging](#json-fallback-logging)
- [Mod Metrics Engine](#mod-metrics-engine)
- [Response Time Calculation](#response-time-calculation)
- [Join→Submit Ratio Analytics](#joinsubmit-ratio-analytics)
- [Metrics Caching](#metrics-caching)

---

## Action Logging System

### Logged Actions

| Action          | Moderator Required | Target User | Reason Field |
| --------------- | ------------------ | ----------- | ------------ |
| `app_submitted` | No                 | Applicant   | No           |
| `claim`         | Yes                | Applicant   | No           |
| `approve`       | Yes                | Applicant   | Optional     |
| `reject`        | Yes                | Applicant   | Required     |
| `kick`          | Yes                | Applicant   | Required     |
| `modmail_open`  | Optional           | Ticket User | No           |
| `modmail_close` | Yes                | Ticket User | Optional     |

### Database Storage

```sql
INSERT INTO action_log (
  action_id,
  guild_id,
  action,
  moderator_id,
  target_user_id,
  reason,
  timestamp
) VALUES (?, ?, ?, ?, ?, ?, ?);
```

**Example Row:**

```json
{
  "action_id": "01HQXY9Z8KTMQ5Z5Z5Z5Z5Z5Z5",
  "guild_id": "896070888594759740",
  "action": "approve",
  "moderator_id": "123456789012345678",
  "target_user_id": "987654321098765432",
  "reason": "Great answers, account looks legitimate",
  "timestamp": 1729565415000
}
```

### Discord Channel Logging

**Pretty Card Format:**

```
┌─────────────────────────────────────────────┐
│ 🟢 Application Approved                    │
├─────────────────────────────────────────────┤
│ Moderator: @Alice#1234                      │
│ Applicant: @Bob#5678                        │
│ Reason: Great answers, account legitimate   │
│ Response Time: 8 minutes                    │
│ Timestamp: 2025-10-22 03:45:15 UTC         │
└─────────────────────────────────────────────┘
```

**Embed Color Mapping:**

- `app_submitted`: Blue (`#3498db`)
- `claim`: Green (`#2ecc71`)
- `approve`: Green (`#2ecc71`)
- `reject`: Yellow (`#f1c40f`)
- `kick` / `perm_reject`: Red (`#e74c3c`)
- `modmail_open`: Purple (`#9b59b6`)
- `modmail_close`: Gray (`#95a5a6`)

---

## Logging Channel Resolution

### Priority Cascade

```javascript
function getLoggingChannel(guildId: string): TextChannel | null {
  // 1. Check database (guild_config.logging_channel_id)
  const dbChannelId = db.prepare(
    'SELECT logging_channel_id FROM guild_config WHERE guild_id = ?'
  ).get(guildId)?.logging_channel_id;

  if (dbChannelId) {
    const channel = guild.channels.cache.get(dbChannelId);
    if (channel?.isTextBased()) return channel;
  }

  // 2. Fall back to environment variable
  const envChannelId = process.env.LOGGING_CHANNEL_ID;
  if (envChannelId) {
    const channel = guild.channels.cache.get(envChannelId);
    if (channel?.isTextBased()) return channel;
  }

  // 3. Return null → triggers JSON fallback
  return null;
}
```

**Configuration Methods:**

1. **Admin Panel:** Config page → Logging Channel input → validates + saves to DB
2. **Slash Command:** `/config set logging channel:#logs` → validates + saves to DB
3. **Environment Variable:** Set `LOGGING_CHANNEL_ID=...` in `.env` (deprecated, use DB)

---

## Permission Validation

### Required Permissions

- `ViewChannel` — Bot must see target channel
- `SendMessages` — Post log embeds
- `EmbedLinks` — Format rich embeds (required for color-coded cards)

### Validation Flow

```javascript
async function checkLoggingChannelHealth(
  guildId: string,
  channelId: string
): Promise<{ logging_channel_ok: boolean; logging_perms_ok: boolean }> {
  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);

    if (!channel || channel.type !== ChannelType.GuildText) {
      return { logging_channel_ok: false, logging_perms_ok: false };
    }

    const botMember = await guild.members.fetchMe();
    const permissions = channel.permissionsFor(botMember);

    const hasRequiredPerms =
      permissions?.has(PermissionFlagsBits.SendMessages) &&
      permissions?.has(PermissionFlagsBits.EmbedLinks);

    return {
      logging_channel_ok: true,
      logging_perms_ok: hasRequiredPerms || false
    };
  } catch (err) {
    logger.error({ err, guildId, channelId }, 'Logging channel health check failed');
    return { logging_channel_ok: false, logging_perms_ok: false };
  }
}
```

### Startup Permission Warnings

On bot ready, validates logging channel:

```
⚠️ Logging Channel Warning

Channel: #verification-logs (ID: 1430015254053654599)
Issue: Missing EmbedLinks permission

Action logs will fall back to JSON file until permissions are fixed.
Please grant the bot "Embed Links" permission in channel settings.
```

---

## JSON Fallback Logging

### When Fallback Triggers

- Logging channel not configured (DB + ENV both null)
- Channel deleted or inaccessible
- Bot lacks SendMessages permission
- Bot lacks EmbedLinks permission

### Fallback File Format

**Location:** `data/action_log_fallback.jsonl`
**Format:** JSON Lines (one object per line)

```jsonl
{"timestamp":"2025-10-22T03:45:15.123Z","action":"approve","moderator_id":"123456789012345678","target_user_id":"987654321098765432","reason":"Great answers","guild_id":"896070888594759740"}
{"timestamp":"2025-10-22T03:50:22.456Z","action":"reject","moderator_id":"234567890123456789","target_user_id":"876543210987654321","reason":"Account too new","guild_id":"896070888594759740"}
```

**Recovery:**

- Manually import JSONL into database using migration script
- Parsing script: `scripts/import-fallback-logs.ts`

**Monitoring:**

- File size check in health endpoint (`/health`)
- Alerts if file exceeds 10 MB (indicates sustained fallback)

---

## Mod Metrics Engine

### Architecture (PR5)

**Module:** `src/features/modPerformance.ts`
**Scheduler:** `src/scheduler/modMetricsScheduler.ts`
**Database:** `mod_metrics` table (migration 002)

### Schema

```sql
CREATE TABLE mod_metrics (
  moderator_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  total_claims INTEGER DEFAULT 0,
  total_accepts INTEGER DEFAULT 0,
  total_rejects INTEGER DEFAULT 0,
  total_kicks INTEGER DEFAULT 0,
  modmail_opens INTEGER DEFAULT 0,
  response_time_p50_ms INTEGER,
  response_time_p95_ms INTEGER,
  updated_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (moderator_id, guild_id)
);

CREATE INDEX idx_mod_metrics_guild_accepts
  ON mod_metrics(guild_id, total_accepts DESC);
```

### Calculation Flow

```javascript
async function recalcModMetrics(guildId: string): Promise<number> {
  const moderators = new Set<string>();

  // 1. Query all actions for guild
  const actions = db.prepare(`
    SELECT moderator_id, action, timestamp, target_user_id
    FROM action_log
    WHERE guild_id = ? AND moderator_id IS NOT NULL
    ORDER BY timestamp ASC
  `).all(guildId);

  // 2. Group by moderator
  for (const action of actions) {
    moderators.add(action.moderator_id);
  }

  // 3. For each moderator, calculate metrics
  for (const modId of moderators) {
    const modActions = actions.filter(a => a.moderator_id === modId);

    const counts = {
      total_claims: modActions.filter(a => a.action === 'claim').length,
      total_accepts: modActions.filter(a => a.action === 'approve').length,
      total_rejects: modActions.filter(a => a.action === 'reject').length,
      total_kicks: modActions.filter(a => a.action === 'kick').length,
      modmail_opens: modActions.filter(a => a.action === 'modmail_open').length
    };

    // 4. Calculate response time percentiles
    const responseTimes = calculateResponseTimes(modActions);
    const p50 = percentile(responseTimes, 50); // Median
    const p95 = percentile(responseTimes, 95); // 95th percentile

    // 5. Upsert mod_metrics table
    db.prepare(`
      INSERT INTO mod_metrics (moderator_id, guild_id, total_claims, total_accepts, total_rejects, total_kicks, modmail_opens, response_time_p50_ms, response_time_p95_ms, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(moderator_id, guild_id) DO UPDATE SET
        total_claims = excluded.total_claims,
        total_accepts = excluded.total_accepts,
        total_rejects = excluded.total_rejects,
        total_kicks = excluded.total_kicks,
        modmail_opens = excluded.modmail_opens,
        response_time_p50_ms = excluded.response_time_p50_ms,
        response_time_p95_ms = excluded.response_time_p95_ms,
        updated_at = unixepoch()
    `).run(modId, guildId, counts.total_claims, counts.total_accepts, counts.total_rejects, counts.total_kicks, counts.modmail_opens, p50, p95);
  }

  return moderators.size;
}
```

### Scheduler Configuration

**Interval:** 15 minutes (configurable via `MOD_METRICS_INTERVAL_MS`)
**Startup:** Runs immediately on bot ready
**Graceful Shutdown:** Clears interval on SIGTERM

```javascript
export function startModMetricsScheduler(client: Client): NodeJS.Timeout {
  const interval = setInterval(async () => {
    await refreshAllGuildMetrics(client);
  }, 15 * 60 * 1000); // 15 minutes

  logger.info({ intervalMinutes: 15 }, '[metrics] scheduler starting');
  return interval;
}

export function stopModMetricsScheduler(interval: NodeJS.Timeout): void {
  clearInterval(interval);
  logger.info('[metrics] scheduler stopped');
}
```

---

## Response Time Calculation

### Formula

```
Response Time = Decision Timestamp - Application Submission Timestamp
```

**Example:**

- Application submitted: 2025-10-22 03:00:00 UTC
- Moderator approves: 2025-10-22 03:08:15 UTC
- Response time: 8 minutes 15 seconds (495,000 ms)

### Nearest-Rank Percentile Algorithm

**Why:** Deterministic, no interpolation required, matches PostgreSQL's `percentile_cont` behavior

**Implementation:**

```javascript
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;

  // Sort values ascending
  const sorted = values.slice().sort((a, b) => a - b);

  // Calculate rank (1-indexed)
  const rank = Math.ceil((p / 100) * sorted.length);

  // Return value at rank (convert to 0-indexed)
  return sorted[rank - 1];
}
```

**Example:**

```javascript
const responseTimes = [120000, 300000, 480000, 720000, 1800000]; // 2m, 5m, 8m, 12m, 30m

percentile(responseTimes, 50); // p50 = 480000 (8 minutes)
percentile(responseTimes, 95); // p95 = 1800000 (30 minutes)
```

---

## Join→Submit Ratio Analytics

### Definition

**Formula:**

```
Join→Submit Ratio = (Applications Submitted / Server Joins) × 100
```

**Purpose:** Measure effectiveness of verification funnel

### Aggregation Windows

| Window            | SQL Query                                   |
| ----------------- | ------------------------------------------- |
| **Last 24 hours** | `WHERE timestamp >= unixepoch() - 86400`    |
| **Last 7 days**   | `WHERE timestamp >= unixepoch() - 604800`   |
| **Last 30 days**  | `WHERE timestamp >= unixepoch() - 2592000`  |
| **Last year**     | `WHERE timestamp >= unixepoch() - 31536000` |

### Database Queries

**Application Submissions:**

```sql
SELECT COUNT(*) AS submit_count
FROM action_log
WHERE guild_id = ?
  AND action = 'app_submitted'
  AND timestamp >= ?; -- Window start
```

**Server Joins:**

```sql
-- Note: Currently tracked manually or via guild member add events
-- Future: Add action_log.action = 'member_join' for consistency
SELECT COUNT(*) AS join_count
FROM guild_member_events
WHERE guild_id = ?
  AND event_type = 'member_add'
  AND timestamp >= ?;
```

### Visualization (Dashboard)

**Default:** 30-day window with line graph
**Dropdown Options:**

- 1 day (hourly data points)
- 7 days (daily data points)
- 30 days (weekly data points, default)
- 1 year (monthly data points)

**Graph Features:**

- X-axis: Time (downsampled to 7-day spacing for readability)
- Y-axis: Join→Submit Ratio (percentage)
- Smoothed series: 3-point moving average
- Tooltip: Shows exact join/submit counts + ratio
- Color-coded: Green (> 60%), Yellow (40-60%), Red (< 40%)

**Flat Line at 0:**
If no data available for selected window, shows horizontal line at 0% with message: "No data available for this time period"

---

## Metrics Caching

### In-Memory Cache

**Storage:** JavaScript Map with TTL tracking
**Structure:**

```javascript
const metricsCache = new Map<string, { metrics: ModMetrics[]; timestamp: number }>();
```

**TTL:** 5 minutes (configurable via `METRICS_CACHE_TTL_MS` env var)

### Cache Flow

```javascript
export async function getModMetrics(guildId: string, moderatorId?: string): Promise<ModMetrics[]> {
  const cacheKey = `${guildId}:${moderatorId || 'all'}`;
  const cached = metricsCache.get(cacheKey);

  // Check cache validity
  if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
    logger.debug({ cacheKey }, '[metrics] served from cache');
    return cached.metrics;
  }

  // Cache miss or expired → query database
  const metrics = db.prepare(`
    SELECT * FROM mod_metrics
    WHERE guild_id = ?
      ${moderatorId ? 'AND moderator_id = ?' : ''}
    ORDER BY total_accepts DESC
  `).all(guildId, moderatorId);

  // Store in cache
  metricsCache.set(cacheKey, { metrics, timestamp: Date.now() });
  logger.debug({ cacheKey, count: metrics.length }, '[metrics] cached fresh data');

  return metrics;
}
```

### Cache Invalidation

**Automatic:**

- TTL expiry (5 minutes)
- Scheduler refresh (15 minutes) → clears all cache

**Manual:**

- `/resetdata` command → clears cache immediately
- Bot restart → cache lost (ephemeral storage)

---

## Changelog

**Since last revision:**

- Added PR4 logging channel resolution priority (Database > ENV > null)
- Documented permission validation (SendMessages + EmbedLinks) with health checks
- Added JSON fallback logging for missing/invalid channels
- Documented PR5 mod metrics engine architecture and scheduler
- Added nearest-rank percentile algorithm implementation details
- Included Join→Submit ratio analytics with aggregation windows
- Documented 5-minute cache TTL with env configurability
- Added startup permission warnings and recovery procedures
- Included database schema for `mod_metrics` table with composite PK
