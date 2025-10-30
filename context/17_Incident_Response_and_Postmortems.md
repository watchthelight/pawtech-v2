---
title: "Incident Response and Postmortems"
slug: "17_Incident_Response_and_Postmortems"
status: "active"
last_reviewed: "2025-10-30"
owner: "Pawtropolis Tech / Operations"
audience: "SRE • Operators • Engineering Leadership"
source_of_truth: ["PM2 logs", "Sentry", "action_log table"]
related:
  - "09_Troubleshooting_and_Runbook"
  - "11_Runtime_Database_Recovery_Guide"
  - "15_Website_Status_and_Health_Monitoring"
summary: "Incident severity levels (SEV0-SEV3), communication templates, timeline capture procedures, evidence gathering, and PM2/logs/database snapshot workflows."
---

## Purpose & Outcomes

Establish incident response procedures:
- Severity level definitions (SEV0-SEV3)
- Incident communication protocols
- Evidence collection procedures
- Timeline capture methods
- Postmortem template and best practices

## Scope & Boundaries

### In Scope
- Incident severity classification
- Communication templates (Discord, email)
- PM2 log capture procedures
- Database snapshot procedures
- Sentry error investigation
- Postmortem documentation
- Root cause analysis (RCA)

### Out of Scope
- Legal/compliance incident reporting
- Security breach procedures (requires separate protocol)
- External vendor coordination
- Insurance claims

## Current State

**Incident Tracking**: Manual (GitHub Issues + Discord)
**Log Storage**: PM2 logs + Sentry
**Communication Channel**: Discord `#incidents` channel (if configured)
**Postmortem Location**: `docs/postmortems/` (not in repo currently)

## Key Flows

### Incident Response Flow
```
1. Incident detected (alert, user report, monitoring)
2. Assess severity (SEV0-SEV3)
3. Notify stakeholders
4. Begin triage
5. Capture timeline
6. Implement fix
7. Verify resolution
8. Write postmortem
9. Schedule retrospective
```

### Evidence Collection Flow
```
1. Capture PM2 logs
2. Export Sentry errors
3. Snapshot database
4. Record timeline events
5. Screenshot user reports
6. Document configuration state
```

## Commands & Snippets

### Severity Levels

#### SEV0: Critical Outage
**Definition**: Bot completely offline, all users unable to use system
**Examples**:
- Bot process crashed and won't restart
- Database corruption with no backup
- Discord API outage (external)

**Response Time**: Immediate (5 minutes)
**Communication**: Post in Discord every 15 minutes until resolved

**Template**:
```
🚨 INCIDENT ALERT - SEV0

Status: Bot Offline
Impact: All users unable to access system
Started: 2025-10-30 12:00 UTC
ETA: Investigating

Updates: Will post every 15 minutes

Incident Lead: @Admin
```

#### SEV1: Major Degradation
**Definition**: Core functionality impaired, workarounds available
**Examples**:
- `/accept` command failing (can manually assign roles)
- Database slow queries (>5s response time)
- OAuth2 login broken (can still use slash commands)

**Response Time**: 30 minutes
**Communication**: Post in Discord every 30 minutes

**Template**:
```
⚠️ INCIDENT ALERT - SEV1

Status: /accept Command Failing
Impact: Reviewers must manually assign roles
Workaround: Use Discord role selector
Started: 2025-10-30 12:00 UTC

Incident Lead: @Moderator
```

#### SEV2: Minor Degradation
**Definition**: Non-critical feature broken, minimal user impact
**Examples**:
- `/modstats` not updating (cache stale)
- Dashboard graphs not loading
- Avatar scanning disabled

**Response Time**: 2 hours
**Communication**: Post in Discord once at start, once at resolution

#### SEV3: Cosmetic Issue
**Definition**: UI bugs, typos, non-functional impact
**Examples**:
- Embed color incorrect
- Typo in command description
- Dashboard formatting issue

**Response Time**: Best effort
**Communication**: GitHub issue, no immediate notification

### Evidence Collection Commands

#### Capture PM2 Logs
```bash
# Capture last 500 lines to file
pm2 logs pawtropolis --lines 500 --nostream > incident-logs-$(date +%Y%m%d-%H%M%S).log

# Capture error logs only
pm2 logs pawtropolis --err --lines 500 --nostream > incident-errors-$(date +%Y%m%d-%H%M%S).log

# Capture logs with timestamps
pm2 logs pawtropolis --lines 500 --timestamp > incident-logs-timestamped.log
```

#### Export Sentry Errors
```bash
# Navigate to Sentry dashboard
# https://sentry.io/organizations/pawtropolis/issues/

# Export as JSON (via UI):
# 1. Click issue
# 2. Click "..." menu
# 3. Select "Export to JSON"
# 4. Save as incident-sentry-<issue-id>.json
```

#### Snapshot Database
```bash
# Create timestamped backup
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p data/incidents/
cp data/data.db data/incidents/data.db.incident-$TIMESTAMP

# Capture row counts
sqlite3 data/data.db <<EOF > data/incidents/row-counts-$TIMESTAMP.txt
SELECT 'application', COUNT(*) FROM application
UNION ALL SELECT 'review_action', COUNT(*) FROM review_action
UNION ALL SELECT 'action_log', COUNT(*) FROM action_log
UNION ALL SELECT 'mod_metrics', COUNT(*) FROM mod_metrics;
EOF
```

#### Capture Timeline Events
```bash
# Create timeline file
cat > data/incidents/timeline-$TIMESTAMP.txt <<EOF
INCIDENT TIMELINE

Incident ID: INC-$(date +%Y%m%d-%H%M)
Severity: SEV1
Started: $(date -Iseconds)

Timeline:
12:00 - User reported /accept failing
12:02 - Confirmed issue, bot logs show database lock
12:05 - Restarted bot (pm2 restart)
12:07 - Issue persists, investigating database
12:10 - Identified long-running query blocking writes
12:12 - Killed query process
12:15 - Verified /accept working
12:20 - Monitoring for recurrence

Resolution: Killed blocking query, added query timeout
Root Cause: Missing index on review_action table
EOF
```

### Communication Templates

#### Initial Notification (SEV0/SEV1)
```
🚨 INCIDENT ALERT - [SEVERITY]

**Status:** [Brief description]
**Impact:** [Who is affected and how]
**Started:** [Timestamp UTC]
**ETA:** [Investigating | X minutes | X hours]

**Workaround:** [If available]

**Incident Lead:** @[Name]
**Updates:** Every [15 | 30 | 60] minutes

---
Next update: [Time]
```

#### Status Update
```
📊 INCIDENT UPDATE - [SEVERITY]

**Status:** [In Progress | Resolved | Mitigated]
**Progress:** [What has been done]
**Next Steps:** [What will be done]

**ETA:** [Updated estimate]

---
Next update: [Time]
```

#### Resolution Notification
```
✅ INCIDENT RESOLVED - [SEVERITY]

**Status:** Resolved
**Duration:** [Total time]
**Root Cause:** [Brief explanation]

**Actions Taken:**
- [Action 1]
- [Action 2]

**Postmortem:** Will be published within 48 hours

**Incident Lead:** @[Name]
```

### Postmortem Template

```markdown
# Postmortem: [Incident Title]

**Date:** 2025-10-30
**Incident ID:** INC-20251030-1200
**Severity:** SEV1
**Duration:** 45 minutes
**Author:** @Admin

## Summary

[2-3 sentence summary of what happened]

## Impact

- **Users Affected:** [Number or "All"]
- **Services Impacted:** [List affected services]
- **Data Loss:** [None | Details if applicable]

## Timeline (UTC)

| Time | Event |
|------|-------|
| 12:00 | User reported /accept failing |
| 12:02 | Incident confirmed, SEV1 declared |
| 12:05 | Bot restarted (no effect) |
| 12:10 | Identified blocking query |
| 12:12 | Killed query process |
| 12:15 | Verified resolution |
| 12:20 | Monitoring period began |
| 12:45 | Incident closed |

## Root Cause Analysis

**Immediate Cause:** Long-running query on `review_action` table locked database

**Contributing Factors:**
- Missing index on `review_action(app_id, created_at)`
- No query timeout configured in SQLite
- No monitoring for long-running queries

**Root Cause:** Database schema optimization missed during initial deployment

## Resolution

**Immediate Fix:**
1. Killed blocking query process
2. Restarted bot to clear locks

**Long-Term Fix:**
1. Added index: `CREATE INDEX idx_review_action_app_id_time ON review_action(app_id, created_at)`
2. Configured SQLite busy timeout: 5000ms
3. Added monitoring for query duration in Sentry

## Lessons Learned

**What Went Well:**
- Quick detection (2 minutes from report to confirmation)
- Clear communication with users
- Effective workaround (manual role assignment)

**What Went Wrong:**
- Missing index caused initial performance issue
- No automated alerting for database locks
- No query timeout caused complete blocking

**Action Items:**
- [ ] Add database query duration monitoring (@Admin, by 2025-11-15)
- [ ] Audit all tables for missing indexes (@Engineer, by 2025-11-30)
- [ ] Document query optimization best practices (@Docs, by 2025-12-15)
- [ ] Set up automated alerting for DB locks (@SRE, by 2025-11-30)
```

## Interfaces & Data

### Incident Metadata
```typescript
interface Incident {
  id: string;  // INC-YYYYMMDD-HHMM
  severity: 'SEV0' | 'SEV1' | 'SEV2' | 'SEV3';
  title: string;
  started: string;  // ISO 8601
  resolved: string | null;
  duration_minutes: number | null;
  root_cause: string;
  affected_users: number | 'all';
  postmortem_url: string | null;
}
```

## Ops & Recovery

### Incident Triage Checklist

```
□ Assess severity (SEV0-SEV3)
□ Notify stakeholders
□ Assign incident lead
□ Create incident channel (if SEV0/SEV1)
□ Begin timeline capture
□ Capture PM2 logs
□ Snapshot database
□ Check Sentry for errors
□ Implement immediate fix
□ Verify resolution
□ Monitor for recurrence (30 min)
□ Write postmortem
□ Schedule retrospective
```

### Escalation Path

1. **SEV0**: Notify all admins immediately (Discord @mentions)
2. **SEV1**: Notify on-call admin within 30 minutes
3. **SEV2**: Notify during business hours
4. **SEV3**: Create GitHub issue, no escalation

## Security & Privacy

- Redact user IDs in public postmortems
- Store incident logs in secure location
- Limit access to incident snapshots (SSH key required)

## FAQ / Gotchas

**Q: When should I declare an incident?**
A: Whenever core functionality is impaired (SEV0/SEV1). If unsure, err on the side of declaring.

**Q: Who can declare SEV0?**
A: Any admin or on-call engineer.

**Q: How long should postmortem take?**
A: Publish within 48 hours of resolution.

**Q: What if incident recurs?**
A: Reopen same incident ID, update timeline, escalate severity if needed.

## Changelog

- 2025-10-30: Initial creation with incident response procedures
