# 10 — Roadmap, Open Issues, and Tasks

**Last Updated:** 2025-10-22
**Status:** PR6 complete, planning PR7-PR10

## Summary

- **Completed:** PR1-PR6 (Application review, modmail, logging, metrics, web panel, banner sync, password protection)
- **In Progress:** Dashboard polish and UI refinements
- **Next Up:** PR7 (Queue Health & Monitoring), PR8 (Modmail Enhancements)
- **Backlog:** PR9 (Advanced Analytics), PR10 (Observability)

---

## Table of Contents

- [Completed Work](#completed-work)
- [In Progress](#in-progress)
- [Roadmap](#roadmap)
- [Known Issues](#known-issues)
- [Backlog](#backlog)

---

## Completed Work

### ✅ PR1: Core Application Review System

**Status:** Complete
**Shipped:** 2024-Q4

**Features:**

- Gate verification flow (modal with 5 questions)
- Application submission and storage
- Review queue with claim/decide workflow
- `/accept`, `/reject`, `/kick` commands
- DM notifications to applicants
- Verified role assignment on approval

**Links:**

- See: [04_Gate_and_Review_Flow.md](./04_Gate_and_Review_Flow.md)

---

### ✅ PR2: Modmail System

**Status:** Complete
**Shipped:** 2024-Q4

**Features:**

- DM → Private thread mapping
- Bidirectional message forwarding
- Ticket lifecycle (open, active, close)
- Multiple moderators per ticket
- Thread archival on close

**Links:**

- See: [05_Modmail_System.md](./05_Modmail_System.md)

---

### ✅ PR3: Avatar Risk Scanning

**Status:** Complete
**Shipped:** 2024-Q4

**Features:**

- Profile picture risk scoring (NSFW detection)
- Risk indicators on review cards (🟢 Low, 🟡 Medium, 🔴 High)
- Manual override for false positives
- Caching to reduce API costs

**Links:**

- Code: `src/features/avatarScan.ts`, `src/features/avatarRisk.ts`

---

### ✅ PR4: Logging Channel Integration + Dashboard

**Status:** Complete
**Shipped:** 2025-Q1

**Features:**

- Logging channel resolution priority: DB > ENV > null
- `/config get|set logging` subcommands
- Permission validation (SendMessages + EmbedLinks)
- JSON fallback logging when channel unavailable
- Health checks at startup (warns on permission issues)
- Color taxonomy for action badges

**Schema Changes:**

- Fixed `guild_config.updated_at` (now TEXT ISO 8601, was INTEGER)
- Removed deprecated `updated_at_s` column

**Test Results:** 145/145 passing

**Links:**

- See: [06_Logging_Auditing_and_ModStats.md#logging-channel-resolution](./06_Logging_Auditing_and_ModStats.md#logging-channel-resolution)
- See: [03_Slash_Commands_and_UX.md#config-get-logging--config-set-logging](./03_Slash_Commands_and_UX.md#config-get-logging--config-set-logging)

---

### ✅ PR5: Mod Performance Engine

**Status:** Complete
**Shipped:** 2025-Q1

**Features:**

- `mod_metrics` table with composite PK (moderator_id, guild_id)
- Automated metrics calculation: claims, approves, rejects, kicks, modmail opens
- Response time percentiles (p50, p95) using nearest-rank algorithm (deterministic)
- `/modstats` command (personal stats)
- `/modstats leaderboard` (top 10 by accepts)
- `/modstats export` (CSV download)
- In-memory caching with 5-minute TTL (env-tunable)
- Scheduler: Refresh every 15 minutes with graceful shutdown

**Schema Changes:**

- Migration 002: Created `mod_metrics` table
- Index on `(guild_id, total_accepts DESC)` for leaderboard queries

**Test Results:** 165/165 passing (after test isolation fixes)

**Links:**

- See: [06_Logging_Auditing_and_ModStats.md#mod-metrics-engine](./06_Logging_Auditing_and_ModStats.md#mod-metrics-engine)
- See: [07_Database_Schema_and_Migrations.md#mod-metrics-table](./07_Database_Schema_and_Migrations.md#mod-metrics-table)

---

### ✅ PR6: Web Control Panel (OAuth2 + Fastify)

**Status:** Complete
**Shipped:** 2025-Q1

**Features:**

- Fastify web server (replaced old HTTP dashboard)
- Discord OAuth2 authentication flow
- Session management with signed cookies
- Role-based access control (`ADMIN_ROLE_ID`)
- Protected API routes:
  - `GET /api/logs` (filters: guild, moderator, action, limit)
  - `GET /api/metrics` (leaderboard or moderator view)
  - `GET/POST /api/config` (guild configuration)
  - `GET /api/guild`, `/api/users/resolve`, `/api/roles/resolve`
- Admin dashboard SPA (vanilla JS):
  - Tabs: Dashboard, Logs, Metrics, Config
  - Discord-style rendered avatars + usernames
  - Color-coded action badges
  - Graphs (30-day default, week/day/year dropdown)
  - Smoothed series with downsampled ticks (7-day spacing)
  - Response time slices (p50/p95), activity charts
  - CSV export functionality
- Config page:
  - Gate message preview (read-only)
  - Welcome message editor with preview
  - Role pills with colors/emojis
  - Logging channel editor with health strip
  - Join→Submit ratio metric + graph
- Apache reverse proxy:
  - `/auth/*` → `:3000`
  - `/api/*` → `:3000`
  - Static site served from `/var/www/pawtropolis/website`
  - SPA fallback for `/admin/*`

**Environment Variables:**

- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`
- `DASHBOARD_REDIRECT_URI`, `ADMIN_ROLE_ID`
- `FASTIFY_SESSION_SECRET`, `DASHBOARD_PORT`

**Links:**

- See: [02_System_Architecture_Overview.md#fastify-web-server](./02_System_Architecture_Overview.md#fastify-web-server)
- See: [08_Deployment_Config_and_Env.md#apache-configuration](./08_Deployment_Config_and_Env.md#apache-configuration)

---

### ✅ PR6.5: Banner Sync System

**Status:** Complete
**Shipped:** 2025-Q2

**Features:**

- Automatic banner sync from Discord server to bot profile
- Event-driven updates via `guildUpdate` event
- 10-minute rate limiting (prevents API abuse)
- 6-hour periodic fallback check
- Public API endpoint: `GET /api/banner` (no auth required)
- Website homepage dynamically loads banner from API
- Open Graph meta tag updates for social media embeds
- In-memory caching with change detection (banner hash comparison)

**Links:**

- See: [02_System_Architecture_Overview.md#banner-sync-system](./02_System_Architecture_Overview.md#banner-sync-system)
- Code: `src/features/bannerSync.ts`, `src/web/api/banner.ts`
- Frontend: `website/index.html` (dynamic banner loading script)

---

### ✅ PR6.6: Password-Protected Config Changes

**Status:** Complete
**Shipped:** 2025-Q2

**Features:**

- Password verification for config saves (uses `RESET_PASSWORD` from `.env`)
- Beautiful modal UI with animations (glassmorphism + backdrop blur)
- Timing-safe password comparison (`crypto.timingSafeEqual()`)
- Same password as `/gate reset` and `/resetdata` for consistency
- User-friendly error messages (incorrect password vs. missing password)
- Audit logging for all password verification attempts

**Security:**

- Password never sent in cleartext (HTTPS enforced)
- No autocomplete on password field
- Session-based authentication still required (password is second factor)

**Links:**

- See: [03_Slash_Commands_and_UX.md#config-get-logging--config-set-logging](./03_Slash_Commands_and_UX.md#config-get-logging--config-set-logging)
- Code: `src/web/api/config.ts` (password verification), `website/admin/admin.js` (modal UI)

---

### ✅ PR6.7: New Command - `/resetdata`

**Status:** Complete
**Shipped:** 2025-Q2

**Features:**

- Reset analytics epoch and clear metrics cache
- Password-protected (requires `RESET_PASSWORD`)
- Clears `mod_metrics` table
- Resets epoch timestamp in `guild_config`
- Audit logging for all reset attempts (success + failures)

**Links:**

- See: [03_Slash_Commands_and_UX.md#resetdata-password](./03_Slash_Commands_and_UX.md#resetdata-password)
- Code: `src/commands/resetdata.ts`

---

## In Progress

### 🚧 Dashboard UI Polish

**Target:** 2025-Q2

**Tasks:**

- [ ] Chart tooltips (hover to see exact counts)
- [ ] Export from graphs (download chart as PNG)
- [ ] Accessibility audit (keyboard navigation, ARIA labels)
- [ ] Mobile responsive improvements
- [ ] Dark mode toggle (currently locked to dark)
- [ ] Loading skeletons for data fetching

---

## Roadmap

### 🎯 PR7: Queue Health & Monitoring

**Target:** 2025-Q2

**Goals:**

- Real-time queue depth tracking
- Stuck claim detection (> 2 hours without decision)
- SLA breach alerting (configurable thresholds)
- Reviewer burnout indicators (consecutive decisions without break)
- Dashboard health widget (queue depth, average wait time, oldest pending)

**Tasks:**

- [ ] Add `queue_health` table (snapshot queue state every 5 minutes)
- [ ] Implement stuck claim detection (cron job or scheduler)
- [ ] Create SLA configuration (per-guild thresholds)
- [ ] Add alert notifications (Discord DM to admins or webhook)
- [ ] Build queue health dashboard widget
- [ ] Add burnout scoring algorithm (consecutive actions, time since break)

**Related Issues:**

- Moderators reporting "forgot I had a claim" → auto-unclaim after timeout
- Long wait times during off-peak hours → need visibility

---

### 🎯 PR8: Modmail Enhancements

**Target:** 2025-Q2

**Goals:**

- Rich embed support for ticket replies
- Attachment forwarding between DMs and threads
- Canned response templates
- Tag system for ticket categorization
- Ticket search and filtering

**Tasks:**

- [ ] Implement embed serialization (Discord DM → thread)
- [ ] Add attachment proxy (forward files bidirectionally)
- [ ] Create canned response storage (`modmail_templates` table)
- [ ] Build tag system (tags: `billing`, `support`, `report`)
- [ ] Add ticket search API (`GET /api/modmail?search=...`)
- [ ] Dashboard: Modmail tab with filters and search

**Related Issues:**

- Moderators manually typing common responses → need templates
- Difficult to find old tickets → need search
- No way to categorize tickets → need tags

---

### 🎯 PR9: Advanced Analytics

**Target:** 2025-Q3

**Goals:**

- Time-to-first-touch metric (submission → first moderator view)
- Reviewer efficiency scoring
- Predictive workload modeling (forecast queue depth)
- Cohort analysis (approval rates by join source)
- Retention tracking (approved users still active after 30 days)

**Tasks:**

- [ ] Add `action_log.action = 'view'` for card views (currently not tracked)
- [ ] Calculate time-to-first-touch percentiles
- [ ] Design efficiency score algorithm (weighted: speed + accuracy + volume)
- [ ] Implement ML model for queue depth forecasting (ARIMA or Prophet)
- [ ] Add join source tracking (invite link → UTM params)
- [ ] Build retention cohort analysis (SQL + visualization)

**Related Issues:**

- No visibility into how long applications sit unclaimed
- Hard to identify "best" moderators (need composite score)
- Can't predict staffing needs during events

---

### 🎯 PR10: Observability & Polish

**Target:** 2025-Q3

**Goals:**

- Structured JSON logging with correlation IDs
- OpenTelemetry integration for distributed tracing
- Grafana dashboard templates
- Prometheus metrics export
- Error rate alerting

**Tasks:**

- [ ] Replace Pino with structured logger (add correlation IDs)
- [ ] Instrument code with OpenTelemetry spans
- [ ] Export metrics to Prometheus (action counts, response times, error rates)
- [ ] Create Grafana dashboards (system health, business metrics)
- [ ] Add alerting rules (error rate > 5%, p95 > 1 hour, queue depth > 50)
- [ ] Document observability setup in runbook

**Related Issues:**

- Hard to debug cross-service issues (need tracing)
- No proactive alerting (only reactive monitoring)
- Metrics scattered across logs and database

---

## Known Issues

### Role Resolver Failure States

**Severity:** Medium
**Impact:** Dashboard may show "Unknown Role" for deleted roles

**Symptoms:**

- Mod role deleted from Discord
- Dashboard still tries to resolve role by ID
- Displays "Invalid role ID" or "Unknown Role"

**Workaround:**

- Admin panel: Config → Remove deleted role from mod_role_ids
- Or: Manually edit `guild_config.mod_role_ids` in database

**Fix Plan:**

- PR7: Add role validation on fetch (skip deleted roles)
- Cache role deletions to avoid repeated API calls

---

### Sparse Data Graphs Show Misleading Trends

**Severity:** Low
**Impact:** Graphs with few data points show exaggerated spikes/drops

**Symptoms:**

- Join→Submit ratio graph with 2-3 data points
- Line connects points with steep slopes (looks volatile)
- Actual trend may be flat or gradual

**Workaround:**

- Dashboard: Use longer time window (30 days instead of 7 days)
- Or: Add disclaimer text: "Data insufficient, use longer window"

**Fix Plan:**

- PR7: Show confidence intervals on graphs
- Add minimum data point threshold (e.g., "Need 10+ days for accurate trend")

---

### Fallback JSON Logs Not Automatically Imported

**Severity:** Medium
**Impact:** Actions logged to JSON during channel downtime not visible in dashboard

**Symptoms:**

- Logging channel down (permissions issue, channel deleted)
- Actions written to `data/action_log_fallback.jsonl`
- Dashboard shows gap in action timeline

**Workaround:**

- Manual import: `npm run import:fallback-logs`
- Or: Use SQL to insert from JSONL file

**Fix Plan:**

- PR7: Auto-detect fallback log growth, prompt admin to import
- Add `/admin/import-logs` page with one-click import

---

### Test Flakiness on CI (Race Conditions)

**Severity:** Low
**Impact:** Occasionally failing tests in GitHub Actions

**Symptoms:**

- Tests pass locally but fail in CI
- Random failures (not reproducible)
- Usually cache-related or timing-related

**Workaround:**

- Run tests serially: `vitest --threads=false`
- Clear caches in `afterEach` hooks
- Use unique IDs per test

**Fix Plan:**

- PR7: Refactor tests to use in-memory database per test
- Add test isolation best practices to contributing guide

---

## Backlog

### `/gate questions edit` Command

**Priority:** Low
**Effort:** Medium

**Description:**
Allow admins to edit verification questions via slash command (currently requires code changes)

**Tasks:**

- [ ] Create `gate_questions` table (question text, order, required flag)
- [ ] Build `/gate questions add|edit|remove` subcommands
- [ ] Update modal generation to read from database
- [ ] Add admin panel UI for question management

---

### Multi-Guild Support

**Priority:** Low
**Effort:** High

**Description:**
Support single bot instance managing multiple guilds (currently one guild per instance)

**Tasks:**

- [ ] Refactor guild_id to be required on all queries (no default)
- [ ] Add guild picker on dashboard
- [ ] Update OAuth2 flow to support multi-guild authorization
- [ ] Test with 2-3 guilds in parallel

---

### Webhook Integration for External Logging

**Priority:** Low
**Effort:** Low

**Description:**
Send action logs to external webhook (Slack, Discord webhook, custom endpoint)

**Tasks:**

- [ ] Add `guild_config.webhook_url` column
- [ ] Build webhook payload formatter (JSON)
- [ ] Add retry logic for failed webhooks
- [ ] Dashboard: Webhook configuration page

---

### Application Export (GDPR Compliance)

**Priority:** Medium
**Effort:** Low

**Description:**
Allow users to request export of their application data (GDPR right to data portability)

**Tasks:**

- [ ] Add `/export-mydata` user command
- [ ] Generate JSON with application answers, timestamps, decision
- [ ] Send as DM attachment
- [ ] Log export requests for audit trail

---

## Changelog

**Since last revision:**

- Marked PR4, PR5, PR6 as complete with detailed summaries
- Added PR6.5 (Banner Sync System) to completed work
- Added PR6.6 (Password-Protected Config Changes) to completed work
- Added PR6.7 (New Command: `/resetdata`) to completed work
- Expanded PR7 roadmap (Queue Health & Monitoring) with tasks and related issues
- Expanded PR8 roadmap (Modmail Enhancements) with canned responses and tags
- Expanded PR9 roadmap (Advanced Analytics) with time-to-first-touch and efficiency scoring
- Expanded PR10 roadmap (Observability) with OpenTelemetry and Grafana
- Added known issues section (role resolver failures, sparse data graphs, fallback log import)
- Added backlog items (multi-guild support, webhook integration, GDPR export)
- Linked to relevant context docs for each completed PR
