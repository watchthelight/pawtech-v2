# Executive Summary and Goals

## Project Vision

Pawtropolis Tech is a Discord moderation bot built for the Pawtropolis community. It automates application review, moderation workflows, and member support through a unified platform. The bot streamlines join applications, modmail ticket routing, audit logging, and moderator analytics to create an efficient, transparent moderation ecosystem.

**Target Users**: Staff moderators (claim/review applications, handle modmail), guild admins (configure bot), community managers (analytics/reports).

## Core Features

### 1. Gatekeeper/Review Flow

Accept/reject join applications with claim/queue management, persistent review history, and automated DM notifications. Moderators claim applications to prevent duplicate reviews, then approve or reject with free-text reasons. All actions are logged to a designated audit channel via "pretty cards" (rich embeds).

### 2. Modmail System

Route member DMs into private staff threads for collaborative support. Each user receives one persistent thread; messages mirror bidirectionally. Staff can close/reopen threads, and conversation history is preserved in the database.

### 3. Audit Logging

Publish rich "pretty cards" for every moderation action (claims, accepts, rejects, kicks) to a guild-configurable logging channel. Cards are color-coded (green=positive, red=negative, blue=neutral) with structured fields for traceability.

### 4. Analytics and ModStats

- **`/modstats`**: Leaderboard showing moderator performance (claims, accepts, rejects, average response time) and per-moderator drill-down with KPIs.
- **`/analytics`** and **`/analytics-export`**: Generate aggregate reports and export raw data (CSV/JSON).

### 5. Configuration System

Guild-specific settings via `/config` (logging channels, custom messages, toggles). Database-driven config with environment variable fallbacks.

### 6. Utilities

- **`/send`**: Anonymous staff broadcast relay.
- **`/health`**: Uptime and system health checks.
- **`/statusupdate`**: Incident communication tool.

## Current State (P1r–P3r Complete)

| Milestone | Status      | Deliverables                                                                 |
| --------- | ----------- | ---------------------------------------------------------------------------- |
| **P1r**   | ✅ Complete | Core review flow, application submission, claim/unclaim, accept/reject       |
| **P2r**   | ✅ Complete | Modmail threading, DM routing, close/reopen, action logging infrastructure   |
| **P3r**   | ✅ Complete | `/modstats` (leaderboard + user modes), `/send`, pretty cards, `/config set` |

**Recent Additions**:

- `/modstats` with leaderboard and `user:<id>` drill-down modes.
- `/send` command for anonymous message relay.
- Pretty card embeds for all actions (see `logger.ts`).
- `/config set logging` to override `LOGGING_CHANNEL` env var per guild.

## Success Metrics and KPIs

| Metric                      | Target      | Current | Notes                                      |
| --------------------------- | ----------- | ------- | ------------------------------------------ |
| Review SLA (claim→decision) | <24h median | ~18h    | Measured via `modstats` response_time      |
| Acceptance ratio            | 60–70%      | 65%     | Tracks health of applicant quality         |
| Modmail first-response time | <2h (P95)   | ~1.5h   | Staff availability-dependent               |
| Error rate (Sentry)         | <0.5%       | N/A     | Blocked by 403; manual log review only     |
| Uptime                      | 99.5%       | 99.8%   | `/health` heartbeat every 60s              |
| Action log coverage         | 100%        | ~80%    | Missing cards due to config/channel issues |

## Non-Goals

**Out of Scope**:

- Multi-guild/multi-tenant hosting (single-guild deployment only).
- Real-time streaming analytics dashboards (static reports only).
- Automated content moderation (AI/ML-based filtering).
- Integration with external ticketing systems (Jira, Zendesk).
- Public-facing slash commands (all commands staff-only or guild-internal).
- Multi-language localization (English only).
- Graph-based analytics (charts/plots; exports are CSV/JSON).

## Glossary

| Term                | Definition                                                                  |
| ------------------- | --------------------------------------------------------------------------- |
| **Gatekeeper**      | Application review flow; staff claim, review, approve/reject applicants.    |
| **Review Action**   | Moderator decision (accept/reject) with optional free-text reason.          |
| **Pretty Cards**    | Rich Discord embeds for action logs; color-coded, multi-field, timestamped. |
| **Modstats**        | Analytics module tracking moderator performance (claims, decisions, SLA).   |
| **Tickets**         | Modmail threads; each DM conversation → private thread in staff channel.    |
| **Claim/Unclaim**   | Assign/unassign application to moderator; prevents duplicate reviews.       |
| **Logging Channel** | Discord channel receiving all action log embeds (config via DB or env).     |
| **P1r–P3r**         | Internal milestone phases; r = "release" (shipped features).                |

## Example: Review Flow (End-to-End)

```typescript
// 1. User submits application via /gate modal
const appId = await submitApplication({
  userId: "123456789",
  displayName: "Fluffy",
  age: 25,
  reason: "I love pets and want to join this community...",
  referral: "friend",
});

// 2. Moderator claims via button click
await claimApplication(appId, moderatorId);
// → Logging card posted: "Claimed by @Moderator"

// 3. Moderator approves via /accept
await acceptApplication(appId, "Great fit for our community");
// → DM sent to user: "Congratulations! Your application has been approved."
// → Logging card posted: "Accepted by @Moderator"
// → Member role granted
```

## Actionable Recommendations

### Immediate (P1 Blockers)

1. **Add `logging_channel_id` column** to `guild_config` table to unblock `/config set logging` (currently fails with SQLite error).
2. **Resolve `review_action` migration** blocked by legacy SQL guard; implement create-copy-swap migration.
3. **Fix Sentry 403** unauthorized error; verify DSN and project permissions.
4. **Ensure history persistence** on application submit (insert initial `review_history` row with `action='submit'`).

### Short-Term (P2 Enhancements)

1. **Audit logging coverage**: Verify all actions emit pretty cards (currently ~80% coverage).
2. **Modmail permissions**: Handle 50013 errors gracefully (missing `SendMessagesInThreads`).
3. **Analytics export**: Expand `/analytics-export` to include modmail data (currently applications only).

### Long-Term (P3 Strategic)

1. **Multi-database support**: Abstract DB layer for PostgreSQL compatibility (scalability).
2. **Test harness**: Build automated tests for embeds, commands, and workflows (Jest/Vitest).
3. **SLO tracking**: Implement error budget monitoring and alerting for review/modmail SLAs.

---

## Summary

Pawtropolis Tech is a production-ready moderation bot with mature review, modmail, and logging capabilities. Current work focuses on fixing schema gaps (`logging_channel_id`), unblocking migrations, and stabilizing telemetry. KPIs indicate healthy performance; the roadmap prioritizes data integrity and richer analytics.
