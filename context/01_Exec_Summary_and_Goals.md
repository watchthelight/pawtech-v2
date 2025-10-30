---
title: "Executive Summary and Goals"
slug: "01_Exec_Summary_and_Goals"
status: "active"
last_reviewed: "2025-10-30"
owner: "Pawtropolis Tech / Platform"
audience: "Moderators • Engineers • Operators"
source_of_truth: ["code", "README.md", "package.json"]
related:
  - "02_System_Architecture_Overview"
  - "08_Deployment_Config_and_Env"
summary: "High-level overview of Pawtropolis Tech Gatekeeper's purpose, core features, and operational goals. This document provides stakeholders with the 'why' behind the platform and key success metrics."
---

## Purpose & Outcomes

- **Transparent community verification**: Replace opaque DM-based screening with structured, auditable application workflows
- **Reviewer accountability**: Track all moderation actions with full audit trails and performance metrics
- **Applicant experience**: Provide clear feedback, draft recovery, and modmail communication channels
- **Risk mitigation**: Automated avatar scanning and permanent rejection capabilities
- **Operational excellence**: Zero-downtime deployments, structured logging, error tracking, and health monitoring

## Scope & Boundaries

### In Scope
- Discord slash commands for application submission and review
- Interactive modal forms with multi-page flows
- Modmail system for private staff-applicant communication
- Avatar NSFW/risk analysis using ONNX models and Google Vision API
- Reviewer performance tracking and leaderboards
- Database integrity checks and recovery procedures
- Web dashboard for OAuth-authenticated admin access

### Out of Scope
- General-purpose moderation tools (mutes, bans, warnings outside application context)
- Public-facing community features (leveling, economy, games)
- Cross-server federation or shared ban lists
- Real-time voice/video moderation

## Current State

**Repository**: [github.com/watchthelight/pawtech-v2](https://github.com/watchthelight/pawtech-v2)

**Tech Stack**:
- **Runtime**: Node.js 20+ with TypeScript 5.5.4
- **Discord**: discord.js v14.16.3
- **Database**: better-sqlite3 (synchronous SQLite)
- **Web**: Fastify 5.6.1 with OAuth2 + session management
- **Observability**: Sentry 10.20.0 + Pino structured logging
- **Deployment**: PM2 process manager on Ubuntu 22.04

**Key Files**:
- Entry point: [src/index.ts](../src/index.ts)
- Package manifest: [package.json](../package.json)
- Environment template: [.env.example](../.env.example)
- License: [LICENSE](../LICENSE) (ANW-1.0)

## Key Flows

### 1. Application Submission
1. User clicks "Apply" button in gate channel
2. Bot presents interactive modal with questions
3. Draft saved after each page completion
4. Final submission triggers review card post in review channel
5. Avatar scan runs asynchronously (ONNX + Google Vision API)

### 2. Review & Decision
1. Moderator claims application (exclusive lock)
2. Review embed shows Q&A, timestamps, account age, avatar risk
3. Actions: Approve → assign role + delete review card
4. Reject → send DM with reason, optionally permanent ban
5. Modmail → open private thread for clarification

### 3. Modmail Communication
1. Moderator clicks "Modmail" button on review card
2. Bot creates private thread, adds applicant + staff
3. Messages relay bidirectionally
4. Thread auto-closes on application resolution
5. Transcript saved as .txt file in log channel

## Commands & Snippets

```bash
# Start development server with hot reload
npm run dev

# Deploy commands to Discord
npm run deploy:cmds

# Run full quality checks (lint, format, typecheck, test)
npm run check

# Build for production
npm run build

# Start production server (requires .env)
npm start
```

### Key Slash Commands
- `/apply` - Start application (only in gate channel, unverified role required)
- `/review` - View recent applications and statistics
- `/modstats` - Show reviewer performance leaderboard
- `/config` - Manage guild settings (roles, channels, questions)
- `/database` - Admin tools for integrity checks and recovery
- `/sample reviewcard` - Preview embed formatting (testing)

## Interfaces & Data

### Discord Events Consumed
- `ClientReady` - Bot initialization, schema migrations, web server startup
- `InteractionCreate` - Slash commands, buttons, modals
- `MessageCreate` - Modmail relay, dad mode easter egg
- `GuildMemberAdd` - Auto-welcome message with banner

### External APIs
- **Discord REST API**: User info, role management, message posting
- **Google Cloud Vision API**: Safe search detection for avatars
- **Sentry**: Error tracking and performance monitoring

### Data Storage
- **Primary DB**: `data/data.db` (SQLite with WAL mode)
- **Backups**: `data/backups/` (automatic hourly snapshots)
- **Assets**: `assets/` (banner images, ONNX models)
- **Website**: `website/` (static HTML/CSS/JS served by Fastify)

## Ops & Recovery

### Health Checks
```bash
# Web server health endpoint
curl https://pawtropolis.tech/health

# PM2 status
pm2 status pawtropolis

# Check database integrity
npm run database -- check
```

### Failure Modes
1. **Database corruption**: Use `scripts/recover-db.ps1` for interactive recovery
2. **Command deployment failure**: Re-run `npm run deploy:cmds` with `--force`
3. **Web server down**: Check PM2 logs, verify port 3000 not in use
4. **Discord rate limits**: Sentry alerts fire, automatic exponential backoff

## Security & Privacy

### Secrets Management
- All tokens stored in `.env` (never committed to git)
- Session secrets minimum 32 characters
- OAuth2 client credentials rotate quarterly
- Sentry DSN restricted to production environment

### Least Privilege
- Bot requires minimal permissions: Manage Roles, Manage Messages, Send Messages
- Reviewer role must be explicitly configured via `/config`
- Gate channel and review channel are permission-gated
- Modmail threads use private thread permissions (staff-only)

### Audit Trail
- All moderation actions logged to `action_log` table with timestamps
- Application history tracked in `review_action` table
- Modmail transcripts archived with participant IDs
- Database backups retained for 30 days

## FAQ / Gotchas

**Q: Can I run multiple bot instances?**
A: No. SQLite is single-writer, and PM2 handles process restarts. Use clustering for web server only.

**Q: How do I reset modstats?**
A: Run `/modstats reset` with password from `MODSTATS_RESET_PASSWORD` env var.

**Q: What happens if a user leaves during review?**
A: Review card shows "Left server" status. Moderators can still reject (permanent ban available).

**Q: How do I change application questions?**
A: Use `/config questions` to add/edit/reorder questions. Requires Manage Guild permission.

**Q: Why are avatar scans sometimes 0% risk?**
A: Google Vision API has ~75% accuracy on NSFW content. Low scores don't guarantee safety.

**Q: Can I restore a deleted application?**
A: No. Applications are soft-deleted. Use database backups if critical data loss occurs.

## Changelog

### 2025-10-30
- **Created**: Initial structured context document
- **Added**: Front-matter with metadata, related docs, and summary
- **Documented**: All 10 standard sections per project requirements
- **Cross-linked**: Related architecture and deployment docs
- **Verified**: All file paths and commands against current repository state
