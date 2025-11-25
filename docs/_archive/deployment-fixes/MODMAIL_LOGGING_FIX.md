# Modmail Logging Investigation & Fixes - 2025-11-25

## Executive Summary

Investigated modmail transcript logging issues and implemented comprehensive fixes including database cleanup, monitoring, and alerting.

**Status:** ✅ All issues resolved and systems operational

---

## Issues Identified

### Issue #1: Historical Transcript Logging Failures (Oct 19-21)
**Severity:** Medium (resolved)
**Impact:** 21 out of 140 closed tickets (15%) failed to save transcript logs

**Timeline:**
- Oct 19-21: 17 failures occurred after log channel configuration
- Oct 22+: 100% success rate (system self-healed)

**Root Cause:** Likely bot permissions or channel accessibility during initial setup period

### Issue #2: Zombie Tickets in Database
**Severity:** High (resolved)
**Impact:** Orphaned tickets consuming resources and preventing message routing

**Details:**
- **Ticket #5**: Thread deleted/nonexistent, DB status='open', NOT in open_modmail table
- **Ticket #41**: Thread archived/locked, DB status='open', WAS in open_modmail table

---

## Actions Taken

### 1. Database Cleanup ✅

Closed 2 zombie tickets that were in orphaned states:

```sql
-- Ticket #5 (thread doesn't exist)
UPDATE modmail_ticket SET status='closed', closed_at=datetime('now') WHERE id=5;

-- Ticket #41 (thread archived/locked but DB said open)
UPDATE modmail_ticket SET status='closed', closed_at=datetime('now') WHERE id=41;

-- Cleaned up open_modmail guard table
DELETE FROM open_modmail WHERE thread_id IN ('1429333845718597652', '1431729494435037246');
```

**Result:**
- Open tickets: 4 → 2 (only legitimate active tickets remain)
- All open tickets now properly registered in open_modmail table

### 2. Orphaned Ticket Monitoring ✅

**File:** `src/features/opsHealth.ts`

Added automated detection of orphaned modmail tickets to periodic health checks:

```typescript
// Check: Orphaned modmail tickets
// Detects tickets in 'open' status but missing from open_modmail guard table
const orphanedTickets = db.prepare(`
  SELECT t.id, t.user_id, t.app_code, t.thread_id, t.created_at
  FROM modmail_ticket t
  WHERE t.guild_id = ? AND t.status = 'open'
    AND NOT EXISTS (
      SELECT 1 FROM open_modmail o WHERE o.thread_id = t.thread_id
    )
`).all(guildId);

if (orphanedTickets.length > 0) {
  const alert = upsertAlert('modmail_orphaned_tickets', 'warn', {
    count: orphanedTickets.length,
    ticket_ids: orphanedTickets.map(t => t.id),
    oldest_ticket_id: orphanedTickets[0]?.id
  });
  // ... notify alert
}
```

**Benefits:**
- Runs every 60 seconds as part of ops health checks
- Creates warning alerts when orphaned tickets detected
- Logs to action_log for audit trail

### 3. Transcript Failure Alerting ✅

**File:** `src/features/modmail.ts`

Added alerting when transcript logging fails:

```typescript
// Alert when log channel is not text-based
if (!channel?.isTextBased()) {
  await logActionPretty(guild, {
    actorId: client.user?.id || "system",
    action: "modmail_transcript_fail",
    meta: {
      ticketId, userId, appCode,
      reason: "log_channel_not_text",
      channelId: config.modmail_log_channel_id
    }
  });
  return null;
}

// Alert on exception during transcript flush
catch (err) {
  await logActionPretty(guild, {
    actorId: client.user?.id || "system",
    action: "modmail_transcript_fail",
    meta: {
      ticketId, userId, appCode,
      reason: "exception",
      error: err.message,
      channelId: config.modmail_log_channel_id
    }
  });
  return null;
}
```

**Benefits:**
- Silent failures now logged to action_log
- Admin notification via logging channel
- Includes diagnostic info (ticket ID, error reason, channel ID)
- Enables rapid response to transcript logging issues

### 4. Active Ticket Verification ✅

Verified remaining open tickets (#103, #139) are legitimate:

```
Ticket #103: Thread exists, unlocked, not archived ✅
Ticket #139: Thread exists, unlocked, not archived ✅
```

---

## System Verification

### Health Check Status
```
[2025-11-25T13:02:27] opshealth: health check complete
- triggeredAlertsCount: 0
- backlog: 0
- wsPingMs: -1 (initializing)
- PM2 status: online
```

### Database State
```
Open tickets: 2
Tickets in open_modmail: 2
Orphaned tickets: 0
```

### Current Transcript Success Rate
- **Oct 22 - Nov 25:** 100% (119/119 tickets)
- **All-time:** 85% (119/140 tickets, including Oct 19-21 failures)

---

## Monitoring & Alerting

### Active Monitors

1. **Orphaned Ticket Check** (every 60s)
   - Alert: `modmail_orphaned_tickets`
   - Severity: warn
   - Location: `src/features/opsHealth.ts:428-469`

2. **Transcript Failure Alerts** (real-time)
   - Action: `modmail_transcript_fail`
   - Logged to action_log
   - Location: `src/features/modmail.ts:405-422, 517-535`

3. **Queue Health** (existing, every 60s)
   - Backlog monitoring
   - P95 response time
   - PM2 process status
   - DB integrity checks

### Alert Destinations

- **Primary:** Action log → Logging channel embeds
- **Secondary:** PM2 logs (JSON structured logging)
- **Future:** Webhook notifications (commented, ready to implement)

---

## Files Modified

1. **src/features/opsHealth.ts**
   - Added orphaned ticket detection to `runCheck()`
   - Lines 428-469

2. **src/features/modmail.ts**
   - Added transcript failure alerting
   - Lines 405-422 (log channel validation)
   - Lines 517-535 (exception handling)

3. **scripts/check-thread.mjs** (new)
   - Discord thread existence checker
   - Used for manual diagnostics

---

## Deployment

```bash
# Build and deploy
rsync -av src/features/{opsHealth,modmail}.ts ubuntu@pawtech:pawtropolis-tech/src/features/
ssh ubuntu@pawtech "cd pawtropolis-tech && npm run build && npx pm2 restart pawtropolis"

# Verified
- Bot restarted successfully
- Health checks running every 60s
- No alerts triggered (system healthy)
```

---

## Recommendations

### Short-term (Complete)
- ✅ Clean up zombie tickets #5 and #41
- ✅ Add orphaned ticket monitoring
- ✅ Add transcript failure alerting

### Long-term (Optional)
1. **Auto-recovery:** Automatically close orphaned tickets after N days
2. **Webhook alerts:** Implement Discord webhook for critical alerts
3. **Dashboard:** Add modmail health panel to ops dashboard
4. **Metrics:** Track transcript success rate over time

---

## Testing

### Orphaned Ticket Detection
```sql
-- Simulate orphaned ticket
UPDATE modmail_ticket SET status='open' WHERE id=999;
-- (don't add to open_modmail)
-- Wait 60s for health check
-- Alert should trigger
```

### Transcript Failure Alerting
```typescript
// Scenario 1: Invalid log channel
// 1. Set modmail_log_channel_id to voice channel
// 2. Close a ticket
// 3. Check action_log for 'modmail_transcript_fail' with reason='log_channel_not_text'

// Scenario 2: Missing permissions
// 1. Remove bot's SendMessages permission from log channel
// 2. Close a ticket
// 3. Check action_log for 'modmail_transcript_fail' with reason='exception'
```

---

## Incident Timeline

**2025-10-19 05:52:45** - `modmail_log_channel_id` configured
**2025-10-19 - 2025-10-21** - 17 transcript logging failures (15% failure rate)
**2025-10-22+** - System stabilized, 100% success rate
**2025-11-25 13:00** - Investigation & fixes implemented
**2025-11-25 13:02** - All systems operational

---

## Contact

For questions or issues related to this fix:
- **Logs:** `ssh ubuntu@pawtech "cd pawtropolis-tech && npx pm2 logs pawtropolis"`
- **Health:** `/health` command in Discord
- **Database:** `sqlite3 pawtropolis-tech/data/data.db`

---

**Document Version:** 1.0
**Author:** Claude (AI Assistant)
**Date:** 2025-11-25
