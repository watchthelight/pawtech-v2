# 01 — Executive Summary and Goals

**Last Updated:** 2025-10-22
**Status:** Production-ready (PR6 complete)

## Summary

- **What:** Transparent, auditable Discord moderation toolkit with application review, modmail, and performance analytics
- **Why:** Community managers need visibility into moderator activity, response times, and review pipeline health
- **How:** Discord.js bot + Fastify web panel + SQLite with comprehensive audit logging and metrics engine
- **Current State:** All core features deployed; OAuth2-protected admin panel live; 165/165 tests passing

---

## Value Proposition

Pawtropolis delivers a **transparent moderation pipeline** that transforms opaque Discord moderation into an accountable, data-driven process:

- **Auditable Review Flow:** Every gate application decision (`approve`, `reject`, `kick`) is logged with timestamps, moderator identity, and optional reason text
- **Performance Analytics:** Automated metrics tracking moderator response times (p50/p95 percentiles), claim/approval rates, and workload distribution
- **Web Control Panel:** OAuth2-protected dashboard for viewing logs, exporting analytics, and managing server configuration
- **Join→Submit Insights:** Track conversion funnel from server join to application submission to identify drop-off points

Built for communities that value **transparency, accountability, and continuous improvement** in their moderation operations.

---

## Top KPIs

| Metric                      | Description                                                        | Target                      |
| --------------------------- | ------------------------------------------------------------------ | --------------------------- |
| **Review Response P50**     | Median time from application submission to moderator decision      | < 30 minutes                |
| **Join→Submit Ratio**       | Percentage of new joins who complete verification application      | > 60%                       |
| **Approvals per Moderator** | Average approved applications per active moderator (30-day window) | Balanced distribution       |
| **Action Throughput**       | Total moderation actions logged per day                            | Trending upward with growth |
| **Modmail Response Time**   | Time from ticket open to first moderator reply                     | < 1 hour                    |

---

## Goals

### Core Objectives (Achieved ✅)

1. **Application Review System** — Gatekeeper workflow with claim/decide/audit pipeline
2. **Modmail Ticketing** — Private thread-based support system with action logging
3. **Comprehensive Audit Logs** — Every action logged with moderator identity, timestamps, and optional reasoning
4. **Performance Metrics** — Automated calculation of moderator stats (claims, approvals, response times) with 15-minute refresh
5. **Web Admin Panel** — OAuth2-protected dashboard for viewing logs, metrics, and configuration
6. **Banner Sync System** — Automatic synchronization of Discord server banner to bot profile and website

### Secondary Goals (In Progress 🚧)

7. **Queue Health Monitoring** — Alerts for stuck claims, SLA breaches, and reviewer burnout (PR7)
8. **Advanced Analytics** — Time-to-first-touch, reviewer efficiency scoring, predictive workload modeling (PR8)
9. **Modmail Enhancements** — Rich embeds, attachment handling, canned responses, tag system (PR9)
10. **Observability Polish** — Structured logging, distributed tracing, Grafana dashboards (PR10)

---

## What's Next

### PR7: Queue Health & Monitoring

- Real-time queue depth tracking
- Stuck claim detection (> 2 hours without decision)
- SLA breach alerting (configurable thresholds)
- Reviewer burnout indicators (consecutive decisions without break)

### PR8: Modmail Enhancements

- Rich embed support for ticket replies
- Attachment forwarding between DMs and threads
- Canned response templates
- Tag system for ticket categorization

### PR9: Observability & Polish

- Structured JSON logging with correlation IDs
- OpenTelemetry integration for distributed tracing
- Grafana dashboard templates
- Prometheus metrics export

---

## Project Scope

### In Scope

- Discord bot commands for moderation workflows
- SQLite database with migration system
- Fastify web server with OAuth2 authentication
- Admin dashboard SPA (vanilla JS)
- Automated metrics calculation and caching
- CSV export for analytics data
- Password-protected configuration changes
- Dynamic banner synchronization

### Out of Scope

- Public-facing website content (separate marketing site)
- Multi-guild support (single guild per bot instance)
- Real-time WebSocket updates (dashboard uses polling)
- Mobile app (responsive web UI only)

---

## Success Criteria

**Achieved:**

- ✅ Zero unaudited moderation actions
- ✅ Sub-5-minute metrics refresh latency
- ✅ 100% test coverage for critical paths (gate flow, metrics engine, auth)
- ✅ OAuth2 authentication with role-based access control
- ✅ Production deployment with Apache reverse proxy
- ✅ Password protection for sensitive configuration changes
- ✅ Automatic banner sync from Discord server to bot and website

**Target:**

- 🎯 < 1% failed permission checks on logging channel
- 🎯 < 100ms p95 response time for API endpoints
- 🎯 Zero data loss during metrics epoch resets
- 🎯 < 5 seconds dashboard initial load time

---

## Changelog

**Since last revision:**

- Added PR4 (Logging Channel Integration), PR5 (Mod Performance Engine), PR6 (Web Control Panel) deliverables
- Documented OAuth2 authentication flow and admin role requirements
- Added Join→Submit ratio as primary KPI
- Expanded roadmap with PR7-PR10 detailed objectives
- Clarified value proposition and transparency benefits
- Updated test counts (145 → 165 passing tests)
- Added security posture and deployment status
- Documented banner sync system (bot profile + website)
- Added password protection for config changes using `RESET_PASSWORD`
