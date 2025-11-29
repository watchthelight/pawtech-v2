# Feature: 24-Hour Unclaimed Application Alert

## Overview
Automatically ping the Gatekeeper role when an application has been unclaimed or unactioned for 24 hours.

## Behavior
1. Scheduled job runs periodically (every 30 minutes or hourly)
2. Checks for applications where:
   - Status is `submitted` (pending)
   - Not currently claimed
   - Submitted more than 24 hours ago
   - No alert has been sent yet for this app
3. Sends alert to review channel pinging Gatekeeper role
4. Records that alert was sent (prevent spam)

## Alert Message
```
@Gatekeeper

⚠️ **Application Pending 24+ Hours**

The following application(s) have been waiting for review:

• #ABC123 from @user • Submitted 26 hours ago
• #DEF456 from @user2 • Submitted 32 hours ago

Please claim and review these applications.
```

## Database Changes
```sql
-- Add column to track alert status
ALTER TABLE application ADD COLUMN stale_alert_sent INTEGER DEFAULT 0;
ALTER TABLE application ADD COLUMN stale_alert_sent_at TEXT;
```

## Implementation

### Scheduler
```typescript
// src/scheduler/staleApplicationCheck.ts
export async function checkStaleApplications() {
  const cutoff = Date.now() / 1000 - (24 * 60 * 60); // 24 hours ago

  const staleApps = db.prepare(`
    SELECT a.id, a.user_id, a.submitted_at, a.guild_id, g.review_channel_id
    FROM application a
    JOIN guild_config g ON g.guild_id = a.guild_id
    LEFT JOIN review_claim rc ON rc.app_id = a.id
    WHERE a.status = 'submitted'
      AND rc.app_id IS NULL
      AND a.stale_alert_sent = 0
      AND a.submitted_at < datetime(?, 'unixepoch')
  `).all(cutoff);

  // Group by guild, send one alert per guild
  // Mark apps as alerted
}
```

### Registration
- Add to `src/scheduler/index.ts`
- Run every 30 minutes via setInterval or cron

## Configuration
- Alert threshold: 24 hours (could make configurable per guild)
- Role to ping: Gatekeeper role from guild_config

## Edge Cases
- App gets claimed after alert sent but before action: No problem, alert already sent
- App gets rejected/approved: Alert not needed, status changed
- Multiple stale apps: Batch into single message (max 10 per alert)

## Effort Estimate
Medium (3-4 hours)
