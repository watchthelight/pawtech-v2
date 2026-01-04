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

- **`/stats leaderboard`** - See moderator rankings
- **`/stats user`** - Individual moderator performance (claims, approvals, rejections, response time)
- **`/stats activity`** - View server activity heatmap
- **`/stats export`** - Download data as CSV

### 5. Configuration

Use `/config` to set logging channels, custom messages, and other settings per server.

### 6. Other Tools

- **`/send`** - Send anonymous staff messages
- **`/health`** - Check if the bot is running

## What's Done

All core features are complete:
- Review flow (claim, approve, reject)
- Modmail system
- `/stats` analytics (leaderboard, user stats, activity heatmap)
- `/send` command
- Pretty card logs
- `/config` settings
- Event tracking (movie nights, game nights)
- AI image detection (`/isitreal`)
- Avatar NSFW scanning (`/audit nsfw`)
- Permission system with role hierarchy

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

## Summary

Pawtropolis Tech is a production-ready moderation bot with review, modmail, analytics, and event tracking features. The bot is actively maintained with regular security updates and feature improvements. See the [CHANGELOG](../CHANGELOG.md) for recent updates.
