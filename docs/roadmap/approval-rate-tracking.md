# Feature: Approval Rate Tracking

## Overview
Track and display server-wide approval/rejection rates over time to monitor moderation standards.

## Command
```
/analytics approval-rate [days:30]
```

## Displayed Metrics

### Current Period
- Total decisions (approvals + rejections + kicks + perm_rejects)
- Approval count & percentage
- Rejection count & percentage
- Kick count & percentage
- Perm reject count & percentage

### Trend Indicator
- Compare to previous period (e.g., last 30 days vs 30 days before that)
- Show if approval rate is increasing/decreasing/stable

## Embed Design
```
📊 Approval Rate Analytics (Last 30 Days)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Overall Stats**
Total Decisions: 150

✅ Approved: 95 (63.3%)
❌ Rejected: 45 (30.0%)
🚫 Kicked: 8 (5.3%)
⛔ Perm Rejected: 2 (1.3%)

**Trend** (vs previous 30 days)
Approval rate: 63.3% → was 58.2% (+5.1%) ↑

**Top Rejection Reasons**
1. Account too new (40%)
2. Incomplete answers (25%)
3. Left server (20%)
4. Other (15%)
```

## Database Queries
```sql
-- Approval rate for period
SELECT
  COUNT(*) FILTER (WHERE action = 'approve') as approvals,
  COUNT(*) FILTER (WHERE action = 'reject') as rejections,
  COUNT(*) FILTER (WHERE action = 'kick') as kicks,
  COUNT(*) FILTER (WHERE action = 'perm_reject') as perm_rejects,
  COUNT(*) as total
FROM review_action
WHERE guild_id = ?
  AND action IN ('approve', 'reject', 'kick', 'perm_reject')
  AND created_at > ?

-- Top rejection reasons
SELECT
  resolution_reason,
  COUNT(*) as count
FROM application
WHERE guild_id = ?
  AND status IN ('rejected', 'kicked')
  AND resolved_at > ?
GROUP BY resolution_reason
ORDER BY count DESC
LIMIT 5
```

## Implementation Files
- `src/commands/analytics.ts` - Add subcommand or new command
- `src/features/analytics/approvalRate.ts` - Query logic

## Optional Enhancements
- Per-moderator approval rates (identify outliers)
- Daily/weekly breakdown chart (ASCII or image)
- Export to CSV

## Effort Estimate
Medium (3-4 hours)
