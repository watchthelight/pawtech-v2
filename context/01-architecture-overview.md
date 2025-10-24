## Architecture Overview

Pawtropolis Tech Gatekeeper is a Discord.js v14 bot providing moderation-focused community verification workflows. Built with TypeScript + Node.js 20, it uses SQLite for persistence, Fastify for web APIs, and Sentry for observability.

---

## System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         Discord Gateway                         │
│              (Events: interactions, messages, members)          │
└──────────────────┬──────────────────────────────────────────────┘
                   │
         ┌─────────▼─────────┐
         │   src/index.ts    │  ← Bot entry point
         │  (Event Router)   │
         └──┬────────┬───────┘
            │        │
    ┌───────▼──┐  ┌─▼────────────┐
    │Commands  │  │ Interactions │
    │Registry  │  │   Router     │
    └───┬──────┘  └───┬──────────┘
        │             │
   ┌────▼─────────────▼─────┐
   │   Feature Modules      │
   │  ┌──────────────────┐  │
   │  │ gate.ts          │  │  Application flow
   │  │ review.ts        │  │  Approval/rejection
   │  │ modmail.ts       │  │  Staff-user DM bridge
   │  │ avatarScan.ts    │  │  ONNX risk detection
   │  │ modPerformance.ts│  │  Metrics & analytics
   │  └──────────────────┘  │
   └─────────┬──────────────┘
             │
      ┌──────▼──────┐
      │ SQLite DB   │
      │ (better-    │
      │  sqlite3)   │
      └─────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Fastify Web Server                          │
│  ┌────────────────┐  ┌──────────────┐  ┌──────────────────┐     │
│  │ Discord OAuth2 │  │ REST APIs    │  │ Static Website   │     │
│  │ /auth/*        │  │ /api/*       │  │ website/         │     │
│  └────────────────┘  └──────────────┘  └──────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Boot Sequence

1. **`main()` in [src/index.ts](../src/index.ts)** L1034-1048
   - Validates required env vars (`DISCORD_TOKEN`, `CLIENT_ID`)
   - Logs into Discord Gateway

2. **`ClientReady` event handler** L144-345
   - Runs schema migrations via [src/db/ensure.ts](../src/db/ensure.ts)
   - Retrofits modmail thread permissions
   - Validates logging channel access
   - Starts Fastify web server (port 3000)
   - Starts mod metrics scheduler (15min intervals)
   - Syncs slash commands to all guilds

3. **Registers interaction handlers** L435-960
   - Slash commands → `commands` Collection
   - Button clicks → regex-based router
   - Modal submits → pattern matching via [src/lib/modalPatterns.ts](../src/lib/modalPatterns.ts)

---

## Runtime Architecture

### Processes
- **Single-process Node.js app** (no workers)
- **PM2 managed** in production (see `start.ps1`, `deploy.ps1`)
- **Graceful shutdown** on SIGTERM/SIGINT (closes DB, flushes Sentry)

### Ports
- **3000** (default): Fastify web server (`DASHBOARD_PORT`)
- No exposed Discord WebSocket (client library handles)

### Schedulers
- **Mod metrics refresh**: Every 15 minutes ([src/scheduler/modMetricsScheduler.ts](../src/scheduler/modMetricsScheduler.ts))
- **Banner sync**: On bot ready ([src/features/bannerSync.ts](../src/features/bannerSync.ts))

### Queues
- **Avatar scanning**: Async, non-blocking ONNX inference (no formal queue, inline Promise)
- **No message queues** (synchronous event handlers)

---

## Critical Files Reference

| File | Purpose |
|------|---------|
| [src/index.ts](../src/index.ts) | Bot entry point, event router, interaction dispatcher |
| [src/db/db.ts](../src/db/db.ts) | SQLite connection, PRAGMAs, schema bootstrap |
| [src/db/ensure.ts](../src/db/ensure.ts) | Idempotent schema migrations run on startup |
| [src/features/gate.ts](../src/features/gate.ts) | Application form modal flow, draft persistence |
| [src/features/review.ts](../src/features/review.ts) | Approve/reject/kick actions, review card rendering |
| [src/features/modmail.ts](../src/features/modmail.ts) | Private thread DM bridge, transcript logging |
| [src/features/avatarScan.ts](../src/features/avatarScan.ts) | ONNX-based NSFW detection, edge score heuristics |
| [src/web/server.ts](../src/web/server.ts) | Fastify app factory, OAuth2 + API + static serving |
| [src/commands/buildCommands.ts](../src/commands/buildCommands.ts) | Slash command definitions for Discord registration |
| [src/lib/cmdWrap.ts](../src/lib/cmdWrap.ts) | Command wrapper for error handling, deferred replies |

---

## Data Flow: Application Lifecycle

```
User clicks "Start Verification"
  ↓
gate.ts: handleStartButton → create/load draft → show modal
  ↓
User submits modal
  ↓
gate.ts: handleGateModalSubmit → persist answers → mark submitted
  ↓
gate.ts: ensureReviewMessage → post review card to staff channel
  ↓
avatarScan.ts: scanAvatar (async, non-blocking) → ONNX inference
  ↓
Staff clicks "Approve"
  ↓
review.ts: handleReviewButton → claim check → approveTx
  ↓
review.ts: approveFlow → assign role, send DM, close modmail
  ↓
logger.ts: logActionPretty → post to logging channel
  ↓
DB: mark status='approved', insert review_action row
```

---

## External Integrations

- **Discord Gateway**: All bot interactions (Gateway Intents: Guilds, DirectMessages, GuildMembers, Messages)
- **Discord REST API**: Slash command registration, OAuth2
- **ONNX Runtime**: Avatar NSFW detection (model: local file)
- **Google Lens**: Reverse image search URLs (no API calls)
- **Sentry.io**: Error tracking, performance monitoring (optional)

---

## Configuration Sources

1. **Environment variables** (`.env` via dotenvx)
2. **SQLite `guild_config` table** (per-guild settings)
3. **SQLite `guild_question` table** (application form questions)
4. **Hard-coded constants** (`src/config.ts`, feature files)

See [06-config-and-environments.md](06-config-and-environments.md) for details.

---

## Key Design Decisions

### Why SQLite?
- **Zero ops overhead**: No separate database server
- **Transactional safety**: ACID guarantees for claim locks, permanent rejections
- **Portable backups**: Single `.db` file

### Why better-sqlite3?
- **Synchronous API**: Simpler error handling than async wrappers
- **Performance**: Faster than node-sqlite3 for bot workloads

### Why Fastify over Express?
- **TypeScript-first**: Better type inference
- **Performance**: Faster routing, lower overhead
- **Plugin ecosystem**: Easy OAuth2, sessions, CORS

### Why Discord.js v14?
- **Maintained**: Active community, regular updates
- **Type-safe**: Full TypeScript support
- **Gateway v10**: Latest Discord features (threads, modals, buttons)

---

## Observability

- **Structured logging**: Pino JSON logs to stdout ([src/lib/logger.ts](../src/lib/logger.ts))
- **Trace IDs**: Per-interaction tracing via [src/lib/reqctx.ts](../src/lib/reqctx.ts)
- **Sentry breadcrumbs**: Captures interaction flow, SQL queries, errors
- **Action logs**: Database audit trail in `action_log` table + pretty embeds to Discord

---

## Deployment Model

- **Target platform**: Windows Server (PowerShell deployment scripts)
- **Process manager**: PM2 (`start.ps1` boots `pm2 start`)
- **Deployment**: SCP tarball + remote PowerShell via `deploy.ps1`
- **Config**: `.env` file on server (not in repo)

See [07-build-and-ci.md](07-build-and-ci.md) for build details.
