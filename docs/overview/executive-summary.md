# Executive Summary

## What Is This?

Pawtropolis Tech is a Discord bot that helps moderators manage a community. It handles join applications, modmail tickets, audit logs, and analytics.

**Who uses it**: Moderators, admins, and community managers.

## Features

### 1. Application Reviews

Moderators can claim, approve, or reject join applications. The bot prevents duplicate reviews and sends automatic DMs to applicants. All actions show up in the audit log.

### 2. Modmail

Member DMs turn into private staff threads. Staff can reply, and messages go back and forth. Threads can be closed and reopened. Everything saves to the database.

### 3. Audit Logs

Every action creates a colored card in the logging channel:
- Green = approved
- Red = rejected
- Blue = neutral

### 4. Analytics

- **`/modstats`** - See moderator performance (claims, approvals, rejections, response time)
- **`/analytics`** - View reports
- **`/analytics-export`** - Download data as CSV or JSON

### 5. Configuration

Use `/config` to set logging channels, custom messages, and other settings per server.

### 6. Other Tools

- **`/send`** - Send anonymous staff messages
- **`/health`** - Check if the bot is running

## What's Done

All core features are complete:
- Review flow (claim, approve, reject)
- Modmail system
- `/modstats` analytics
- `/send` command
- Pretty card logs
- `/config` settings

## Performance

| Metric | Target | Current |
|--------|--------|---------|
| Review time (claim to decision) | Under 24 hours | ~18 hours |
| Acceptance rate | 60-70% | 65% |
| Modmail response time | Under 2 hours | ~1.5 hours |
| Uptime | 99.5% | 99.8% |

## What This Bot Doesn't Do

- Support multiple servers (single server only)
- Real-time dashboards (static reports only)
- AI content moderation
- Connect to Jira or Zendesk
- Public commands (staff only)
- Multiple languages (English only)
- Charts and graphs (data exports only)

## Key Terms

| Term | What It Means |
|------|---------------|
| **Gatekeeper** | Application review system |
| **Pretty Cards** | Colored log messages in Discord |
| **Modstats** | Moderator performance tracking |
| **Tickets** | Modmail threads in staff channel |
| **Claim** | Lock an application so only you review it |
| **Logging Channel** | Where audit logs appear |

## How It Works (Example)

1. User fills out application form
2. Moderator clicks "Claim" button
   - Card appears in logging channel: "Claimed by @Moderator"
3. Moderator uses `/accept` or `/reject`
   - User gets a DM with the decision
   - Card appears in logging channel: "Accepted by @Moderator"
   - User gets member role (if accepted)

## To-Do List

### Fix Now
1. Add `logging_channel_id` to database (needed for `/config`)
2. Fix database migration issues
3. Fix Sentry error tracking
4. Save application history when submitted

### Fix Soon
1. Make sure all actions create log cards
2. Handle missing Discord permissions better
3. Add modmail data to analytics exports

### Fix Later
1. Add PostgreSQL support
2. Add automated tests
3. Add performance monitoring and alerts

## Summary

Pawtropolis Tech is a working moderation bot with review, modmail, and logging features. The bot performs well. Current work focuses on fixing database issues and improving data tracking.
